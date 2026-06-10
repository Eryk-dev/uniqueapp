/**
 * Polling fallback — cobre janelas em que os webhooks do Tiny não chegam
 * (Tiny não dispara, app fora do ar, dedup bloqueou reprocesso, etc).
 *
 * Dois alvos, espelhando os dois webhooks:
 *   1. Pedidos APROVADOS (situacao=3) dos canais Shopify conhecidos que ainda
 *      não existem em `pedidos` → ingestão (fallback do webhook tiny-pedido).
 *   2. NFs de pedidos em `aguardando_nf` com autorizada=false → consulta
 *      situação na API; 6 (Autorizada) ou 7 (Emitida Danfe) → marca autorizada
 *      (fallback do webhook nf-autorizada).
 *
 * Agendamento: startTinyPolling() via instrumentation.ts (setInterval no
 * processo do Next standalone — instância única). Trigger manual:
 * GET/POST /api/worker/poll.
 *
 * Env:
 *   TINY_POLL_ENABLED      'true'/'false' — default: 'true' em produção, 'false' em dev
 *   TINY_POLL_INTERVAL_MS  default 300000 (5 min)
 */

import { createServerClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logger';
import { listOrders, fetchNF, TinyPedidoListItem } from '@/lib/tiny/client';
import {
  ingestPedidoAprovado,
  marcarNFAutorizada,
  ECOMMERCE_MAP,
  SITUACAO_APROVADA,
} from '@/lib/tiny/ingest';

// Janela de busca: pedidos CRIADOS nos últimos N dias. Pedido aprovado mais de
// N dias depois de criado fica fora do radar (raro — pagamento expira antes).
const LOOKBACK_DIAS = 7;
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // hard cap de páginas por ciclo (2000 pedidos)
const NF_BATCH = 50; // NFs pendentes verificadas por ciclo
const IN_CHUNK = 200; // tamanho do chunk pro .in() do PostgREST

// 6 = Autorizada, 7 = Emitida Danfe (pós-autorização). Rejeitada/Cancelada/
// Denegada ficam como estão — mesmo comportamento de hoje (sem webhook, nada
// acontece; tratamento é manual).
const NF_SITUACAO_AUTORIZADA = new Set([6, 7]);

export interface PollPedidosStats {
  candidatos: number;
  faltantes: number;
  ingeridos: number;
  ignorados: number;
  erros: number;
}

export interface PollNFsStats {
  verificadas: number;
  autorizadas: number;
  erros: number;
}

export interface PollStats {
  pedidos: PollPedidosStats;
  nfs: PollNFsStats;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fmtData(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Pedidos aprovados ──────────────────────────────────────────────────────

export async function pollPedidosAprovados(): Promise<PollPedidosStats> {
  const stats: PollPedidosStats = { candidatos: 0, faltantes: 0, ingeridos: 0, ignorados: 0, erros: 0 };
  const supabase = createServerClient();

  const agora = new Date();
  const dataInicial = fmtData(new Date(agora.getTime() - LOOKBACK_DIAS * 86_400_000));
  const dataFinal = fmtData(agora);

  // 1. Lista pedidos aprovados recentes, filtrando os canais que ingerimos
  //    (clones fiscais e outros canais não têm ecommerce.id mapeado).
  const candidatos: TinyPedidoListItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { itens, paginacao } = await listOrders({
      situacao: SITUACAO_APROVADA,
      dataInicial,
      dataFinal,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    candidatos.push(...itens.filter((i) => i.id && ECOMMERCE_MAP[i.ecommerce?.id ?? 0]));

    // Para quando a página vem incompleta; usa o total só quando presente
    // (paginacao pode vir ausente — nesse caso segue até página curta).
    if (itens.length < PAGE_SIZE) break;
    const total = paginacao?.total;
    if (total != null && (page + 1) * PAGE_SIZE >= total) break;
  }
  stats.candidatos = candidatos.length;
  if (!candidatos.length) return stats;

  // 2. Remove os que já existem no DB (qualquer status — reprocesso de
  //    erro_fiscal continua sendo papel do webhook/operador, não do poller).
  const existentes = new Set<number>();
  for (const ids of chunk(candidatos.map((c) => c.id), IN_CHUNK)) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('tiny_pedido_id')
      .in('tiny_pedido_id', ids);
    if (error) throw new Error(`Check de existencia em pedidos falhou: ${error.message}`);
    data?.forEach((r) => existentes.add(Number(r.tiny_pedido_id)));
  }

  const faltantes = candidatos.filter((c) => !existentes.has(c.id));
  stats.faltantes = faltantes.length;

  // 3. Ingere um a um pelo mesmo caminho do webhook (fetchOrder + gates).
  for (const cand of faltantes) {
    try {
      const result = await ingestPedidoAprovado({ tinyPedidoId: cand.id, origem: 'polling' });
      if (result.outcome === 'ingerido') {
        stats.ingeridos++;
        console.log(`[poll:tiny] Pedido ${cand.id} (#${cand.numeroPedido}) ingerido via polling — webhook nao tinha chegado`);
      } else if (result.outcome === 'ignorado') {
        stats.ignorados++;
      } else {
        stats.erros++;
      }
    } catch (err) {
      stats.erros++;
      await logError({
        source: 'poller',
        category: 'external_api',
        message: `Polling: ingestao do pedido ${cand.id} falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
        error: err,
        tiny_pedido_id: cand.id,
      });
    }
  }

  return stats;
}

// ─── NFs autorizadas ────────────────────────────────────────────────────────

export async function pollNotasAutorizadas(): Promise<PollNFsStats> {
  const stats: PollNFsStats = { verificadas: 0, autorizadas: 0, erros: 0 };
  const supabase = createServerClient();

  const { data: pendentes, error } = await supabase
    .from('notas_fiscais')
    .select('id, pedido_id, tiny_nf_id, numero_nf, pedidos!inner(status)')
    .eq('autorizada', false)
    .eq('pedidos.status', 'aguardando_nf')
    .not('tiny_nf_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(NF_BATCH);

  if (error) throw new Error(`Busca de NFs pendentes falhou: ${error.message}`);
  if (!pendentes?.length) return stats;

  for (const nf of pendentes) {
    stats.verificadas++;
    try {
      const remote = await fetchNF(nf.tiny_nf_id);
      // Spec da API declara situacao como string com enum numerico — coage.
      const situacao = remote.situacao == null ? null : Number(remote.situacao);
      if (situacao != null && NF_SITUACAO_AUTORIZADA.has(situacao)) {
        const marcou = await marcarNFAutorizada({
          nf: { id: nf.id, pedido_id: nf.pedido_id, tiny_nf_id: nf.tiny_nf_id, numero_nf: nf.numero_nf },
          numero: remote.numero,
          origem: 'polling',
        });
        if (marcou) {
          stats.autorizadas++;
          console.log(`[poll:tiny] NF ${nf.tiny_nf_id} autorizada detectada via polling (situacao ${situacao})`);
        }
      }
    } catch (err) {
      stats.erros++;
      await logError({
        source: 'poller',
        category: 'external_api',
        message: `Polling: verificacao da NF ${nf.tiny_nf_id} falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
        error: err,
        pedido_id: nf.pedido_id,
      });
    }
  }

  return stats;
}

// ─── Ciclo + agendador ──────────────────────────────────────────────────────

let _polling = false;

/** Roda um ciclo completo. Retorna null se já há ciclo em andamento. */
export async function runPollCycle(): Promise<PollStats | null> {
  if (_polling) return null;
  _polling = true;

  try {
    const pedidos = await pollPedidosAprovados().catch(async (err) => {
      await logError({
        source: 'poller',
        category: 'external_api',
        message: `Polling de pedidos aprovados falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
        error: err,
      });
      return { candidatos: 0, faltantes: 0, ingeridos: 0, ignorados: 0, erros: 1 } as PollPedidosStats;
    });

    const nfs = await pollNotasAutorizadas().catch(async (err) => {
      await logError({
        source: 'poller',
        category: 'external_api',
        message: `Polling de NFs falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
        error: err,
      });
      return { verificadas: 0, autorizadas: 0, erros: 1 } as PollNFsStats;
    });

    if (pedidos.ingeridos || nfs.autorizadas || pedidos.erros || nfs.erros) {
      console.log(
        `[poll:tiny] ciclo: pedidos ${pedidos.ingeridos}/${pedidos.faltantes} ingeridos (${pedidos.candidatos} candidatos, ${pedidos.erros} erros) | NFs ${nfs.autorizadas}/${nfs.verificadas} autorizadas (${nfs.erros} erros)`
      );
    }

    return { pedidos, nfs };
  } finally {
    _polling = false;
  }
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
let _timer: NodeJS.Timeout | null = null;

/** Inicia o agendador (idempotente). Chamado pelo instrumentation.ts no boot. */
export function startTinyPolling(): void {
  if (_timer) return;

  const enabled =
    process.env.TINY_POLL_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
  if (enabled !== 'true') {
    console.log('[poll:tiny] desabilitado (TINY_POLL_ENABLED != true)');
    return;
  }

  const intervalMs = Number(process.env.TINY_POLL_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  console.log(`[poll:tiny] fallback de polling agendado a cada ${Math.round(intervalMs / 1000)}s`);

  _timer = setInterval(() => {
    runPollCycle().catch((err) => {
      console.error('[poll:tiny] ciclo falhou:', err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  _timer.unref?.();

  // Primeiro ciclo 30s após o boot (deixa o app subir antes de bater no Tiny).
  const first = setTimeout(() => {
    runPollCycle().catch((err) => {
      console.error('[poll:tiny] ciclo inicial falhou:', err instanceof Error ? err.message : err);
    });
  }, 30_000);
  first.unref?.();
}
