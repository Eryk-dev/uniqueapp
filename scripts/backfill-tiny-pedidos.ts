// scripts/backfill-tiny-pedidos.ts
//
// Reentrega os webhooks de pedido que o Tiny NAO mandou (webhook parou às 06:36
// de 2026-06-09 após rebuild do EasyPanel). Lista os pedidos no Tiny num
// intervalo, cruza com o que ja existe no app, e pros faltantes POSTa no endpoint
// REAL de producao /api/webhooks/tiny-pedido — usando o codigo de producao
// (fetchOrder + gates de situacao/ecommerce + upsert + enqueue + kickWorker).
// Idempotente (dedup_key tiny-pedido-<id>): rodar 2x nao duplica.
//
// Uso:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/backfill-tiny-pedidos.ts <dataInicial> <dataFinal> [run|dry] [maxPost]
//   ex (dry): npx tsx scripts/backfill-tiny-pedidos.ts 2026-06-09 2026-06-09 dry
//   ex (1):   npx tsx scripts/backfill-tiny-pedidos.ts 2026-06-09 2026-06-09 run 1

import { getValidToken } from '../lib/tiny/oauth';
import { createServerClient } from '../lib/supabase/server';

const TINY_BASE = 'https://api.tiny.com.br/public-api/v3';
const WEBHOOK_URL = 'https://extrator-mp-appunique.gnnc3f.easypanel.host/api/webhooks/tiny-pedido';

const dataInicial = process.argv[2] ?? '2026-06-09';
const dataFinal = process.argv[3] ?? dataInicial;
const mode = process.argv[4] ?? 'dry';
const maxPost = process.argv[5] ? parseInt(process.argv[5], 10) : Infinity;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listPage(token: string, offset: number) {
  const url = `${TINY_BASE}/pedidos?dataInicialOcorrencia=${dataInicial}&dataFinalOcorrencia=${dataFinal}&limit=30&offset=${offset}`;
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json() as Promise<{ itens?: Array<Record<string, unknown>> }>;
    lastErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    // "levou muito tempo" e' timeout transitorio do Tiny — espera e tenta de novo
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`GET /pedidos offset=${offset} falhou apos retries — ${lastErr}`);
}

// dataCriacao do Tiny pode vir YYYY-MM-DD; o handler espera DD/MM/YYYY
function toBrDate(d: unknown): string | undefined {
  const s = String(d ?? '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || undefined;
}

async function main() {
  const token = await getValidToken();
  const supabase = createServerClient();

  // 1. lista tudo do Tiny no intervalo (paginado)
  const tiny: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await listPage(token, offset);
    const itens = page.itens ?? [];
    tiny.push(...itens);
    if (itens.length < 30) break;
    await sleep(500);
  }
  console.log(`Tiny: ${tiny.length} pedidos entre ${dataInicial} e ${dataFinal}`);
  if (!tiny.length) return;

  // 2. cruza com app por numero
  const numeros = tiny.map((o) => Number(o.numeroPedido ?? o.numero ?? 0)).filter(Boolean);
  const minNum = Math.min(...numeros);
  const { data: noApp } = await supabase.from('pedidos').select('numero').gte('numero', minNum);
  const noAppSet = new Set((noApp ?? []).map((p) => Number(p.numero)));

  // So' reentrega o GAP REAL: pedidos com numero ACIMA do ultimo que entrou no
  // app. Abaixo disso, "faltantes" sao pedidos antigos nao-ingeridos de proposito
  // (nao-Shopify, cancelados, ecommerce desconhecido) — nao mexer.
  const { data: maxRow } = await supabase
    .from('pedidos')
    .select('numero')
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  const appMax = Number(maxRow?.numero ?? 0);

  const faltantes = tiny
    .filter((o) => !noAppSet.has(Number(o.numeroPedido ?? o.numero ?? 0)))
    .filter((o) => Number(o.numeroPedido ?? o.numero ?? 0) > appMax)
    .sort((a, b) => Number(a.numeroPedido) - Number(b.numeroPedido));
  console.log(`Ultimo numero no app: ${appMax}. Faltando ACIMA disso (gap real): ${faltantes.length}`);

  // breakdown por situacao (codigo do list do Tiny): 0=Aberta 3=Aprovada
  // 4=PreparandoEnvio 1=Faturada 7=ProntoEnvio 5=Enviada 6=Entregue 2=Cancelada
  const SIT: Record<string, string> = { '0': 'Aberta', '3': 'Aprovada', '4': 'PreparandoEnvio', '1': 'Faturada', '7': 'ProntoEnvio', '5': 'Enviada', '6': 'Entregue', '2': 'Cancelada', '8': 'DadosIncompletos', '9': 'NaoEntregue' };
  const porSit = new Map<string, number>();
  for (const o of faltantes) {
    const s = String(o.situacao ?? '?');
    porSit.set(s, (porSit.get(s) ?? 0) + 1);
  }
  console.log('por situacao:');
  for (const [s, n] of Array.from(porSit).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s} (${SIT[s] ?? '?'}): ${n}`);
  }
  console.log('numeros faltando:', faltantes.map((o) => o.numeroPedido).join(', '));

  if (mode !== 'run') {
    console.log('\n[DRY] nada postado. Rode com "run" pra reentregar os webhooks.');
    return;
  }

  // 3. reentrega webhooks (POST no endpoint real de producao)
  const alvo = faltantes.slice(0, maxPost);
  console.log(`\n[RUN] reentregando ${alvo.length} webhook(s)...`);
  let ok = 0, ign = 0, err = 0;
  for (const o of alvo) {
    const body = {
      tipo: 'atualizacao_pedido',
      dados: {
        id: Number(o.id),
        numero: Number(o.numeroPedido ?? o.numero),
        data: toBrDate(o.dataCriacao),
        nomeEcommerce: 'Shopify',
      },
    };
    try {
      // Limpa log/dedup anterior desse id (ex: webhook ignorado por nomeEcommerce
      // vazio em 06:36) — senao o dedup_key bloqueia a reentrega. Seguro: esses
      // pedidos NAO estao no app, entao so existe o log ignorado.
      await supabase.from('webhook_logs').delete().eq('tiny_pedido_id', Number(o.id));

      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const tag = json.ignored ? 'ignorado' : res.ok ? 'ok' : `erro ${res.status}`;
      if (json.ignored) ign++; else if (res.ok) ok++; else err++;
      console.log(`  #${o.numeroPedido} (id ${o.id}) → ${tag}`);
    } catch (e) {
      err++;
      console.log(`  #${o.numeroPedido} (id ${o.id}) → EXCEPTION ${(e as Error).message}`);
    }
    await sleep(500); // respeita rate limit do Tiny (fetchOrder + setMarkers por pedido)
  }
  console.log(`\nResultado: ${ok} ok, ${ign} ignorados, ${err} erro.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FALHOU:', e); process.exit(1); });
