// scripts/regen-folha-conferencia.ts
/**
 * Regera os artefatos de saida (PDF de conferencia + PNG da chapa de bloco)
 * de uma expedicao ja gerada, sem mexer em status do lote/itens nem criar
 * novas linhas em `arquivos`. Util quando o estado do banco mudou apos a
 * geracao original (ex: fotos_bloco backfill) e a folha precisa refletir
 * o estado atual.
 *
 * Estrategia:
 *  - Reaproveita as funcoes do batch-processor (loadFotosForLote,
 *    buildNfPos/nfPosOf, formatDataGeracaoBR, getStoragePath) — o output
 *    fica byte-equivalente ao gerador normal.
 *  - Upload com upsert=true nos paths existentes em `arquivos`.
 *  - UPDATE em arquivos.tamanho_bytes (nao INSERT) — sem duplicacao.
 *  - Nao gera SVG do box (UB325 puro nao personaliza o molde) e nao
 *    insere evento — mantem operacao silenciosa.
 *
 * Uso:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   STORAGE_SUPABASE_URL=... STORAGE_SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/regen-folha-conferencia.ts <numero_expedicao> [<numero_expedicao> ...]
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Carrega env (preferindo .env.local) — necessario quando o script eh
// chamado sem env vars explicitas. Variaveis ja seteadas no shell tem prioridade.
const envPath = ['.env.local', '.env']
  .map((f) => resolve(__dirname, '..', f))
  .find((p) => existsSync(p));
if (envPath) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) {
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

import { createClient } from '@supabase/supabase-js';
import { generateUniqueBoxPdf, hasPersonalization, formatPlateMessage } from '../lib/generation/uniquebox';
import { generateConferenciaUnificada, slotLabel, type UnifiedRow } from '../lib/generation/conferencia-unificada';
import { generateBlocoPdf } from '../lib/generation/bloco-pdf';
import { packFotos } from '../lib/generation/bloco';
import { renderBlocoPngs } from '../lib/generation/bloco-png';
import {
  buildNfPos,
  nfPosOf,
  formatDataGeracaoBR,
  loadFotosForLote,
} from '../lib/generation/batch-processor';

const BUCKET = 'uniquebox-files';

async function regenerateOne(numeroExpedicao: number) {
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const stUrl = process.env.STORAGE_SUPABASE_URL ?? dbUrl;
  const stKey = process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY ?? dbKey;

  const db = createClient(dbUrl, dbKey, { db: { schema: 'unique_app' } });
  const storage = createClient(stUrl, stKey);

  console.log(`\n=== Exp ${numeroExpedicao} ===`);

  // 1. Carrega expedicao
  const { data: exp, error: expErr } = await db
    .from('expedicoes')
    .select('id, lote_id, numero_expedicao, nf_ids, created_at')
    .eq('numero_expedicao', numeroExpedicao)
    .single();
  if (expErr || !exp) throw new Error(`Expedicao ${numeroExpedicao} nao encontrada: ${expErr?.message}`);

  const loteId = exp.lote_id as string;
  console.log(`  lote_id: ${loteId}`);

  // 2. Carrega itens do lote (mesmo filtro que processUniqueBoxBatch)
  const { data: rawItems } = await db
    .from('itens_producao')
    .select('*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id, kits)')
    .eq('lote_id', loteId);

  const items = (rawItems ?? []).filter(
    (i: Record<string, unknown>) =>
      (i as { pedidos?: { linha_produto?: string } }).pedidos?.linha_produto === 'uniquebox'
  );
  if (!items.length) throw new Error(`Lote ${loteId}: nenhum item uniquebox`);
  console.log(`  ${items.length} item(ns) uniquebox`);

  // 3. Monta messages no formato esperado pelos geradores
  const nfOrder = (exp.nf_ids as Array<number | string> | null) ?? [];
  const nfPos = buildNfPos(nfOrder);
  const posOfNf = (id: number | string | null | undefined) => nfPosOf(nfPos, id);

  const pedidoKits = new Map<string, string[]>();
  for (const item of items as Array<Record<string, unknown>>) {
    const pedidoId = item.pedido_id as string;
    const pedido = item.pedidos as { kits?: string[] | null } | undefined;
    const kits = pedido?.kits ?? [];
    if (kits.length > 0 && !pedidoKits.has(pedidoId)) pedidoKits.set(pedidoId, kits);
  }

  const messages = (items as Array<Record<string, unknown>>).map((item) => {
    const pedido = item.pedidos as Record<string, unknown> | undefined;
    return {
      mensagem: (item.personalizacao as string) ?? '',
      cliente: (pedido?.nome_cliente as string) ?? '',
      modelo: (item.modelo as string) ?? '',
      idNF: item.tiny_nf_id as number,
      notaFiscal: item.numero_nf as number,
      formaEnvio: (pedido?.forma_frete as string) ?? '',
      pedidoId: pedido?.tiny_pedido_id as number,
      idFormaFrete: pedido?.id_forma_frete as number,
      _item_id: item.id as string,
      _pedido_id: item.pedido_id as string,
    };
  });
  messages.sort((a, b) => posOfNf(a.idNF) - posOfNf(b.idNF));

  const boxItemIds = new Set(
    (items as Array<Record<string, unknown>>)
      .filter((i) => !String(i.modelo ?? '').toLowerCase().includes('bloco'))
      .map((i) => i.id as string)
  );
  const boxMessages = messages.filter((m) => boxItemIds.has(m._item_id ?? ''));

  const numeroExpRef = String(numeroExpedicao);
  const dataGeracao = formatDataGeracaoBR(exp.created_at as string);

  // 4. Carrega fotos do bloco + thumbnails
  const fotos = await loadFotosForLote(loteId, nfOrder);
  console.log(`  ${fotos.length} foto(s) carregada(s)`);

  // 5. Renderiza PNG da chapa (so se houver bloco P puro — mesmo filtro do batch-processor)
  const blocoSizes = new Set<'P' | 'M' | 'G'>();
  for (const it of items as Array<{ tamanho_bloco?: string | null; modelo?: string | null }>) {
    if (it.tamanho_bloco === 'P' || it.tamanho_bloco === 'M' || it.tamanho_bloco === 'G') blocoSizes.add(it.tamanho_bloco);
    else if ((it.modelo ?? '').toLowerCase().includes('bloco')) blocoSizes.add('P');
  }
  const skipChapaPng = blocoSizes.size > 0 && !(blocoSizes.size === 1 && blocoSizes.has('P'));

  // Timestamp pro PNG — usa o created_at da expedicao, pra bater com o
  // timestamp embutido no PNG original (caso o gerador embuta no metadata).
  const timestamp = new Date(exp.created_at as string).toISOString().replace(/[:.]/g, '').slice(0, 15);

  type BlocoMapaEntry = {
    foto_id: string;
    item_id: string;
    pedido_id: string;
    nf_id: number;
    posicao: number;
    chapa_index: number;
    slot_index: number;
    public_url: string;
  };
  let blocoMapa: BlocoMapaEntry[] = [];
  const thumbnails = new Map<string, Buffer>();

  if (fotos.length > 0) {
    const packed = packFotos(
      fotos.map((f) => ({
        foto_id: f.foto_id,
        item_id: f.item_id,
        pedido_id: f.pedido_id,
        nf_id: f.nf_id,
        posicao: f.posicao,
        public_url: f.public_url,
      }))
    );

    if (!skipChapaPng) {
      const { pngs, mapa, failures } = await renderBlocoPngs(packed, timestamp);
      blocoMapa = mapa as BlocoMapaEntry[];
      if (failures.length > 0) {
        console.warn(`  WARN ${failures.length} foto(s) falharam no render — slots vazios`);
      }

      // Upload PNGs sobrescrevendo o existente
      for (let i = 0; i < pngs.length; i++) {
        const png = pngs[i]!;
        const sufixo = pngs.length > 1 ? `-${i + 1}` : '';
        const pngFilename = `bloco-${numeroExpRef}${sufixo}.png`;
        // Procura o arquivo existente pra reusar o storage_path (preserva
        // o prefix de data, mesmo que `timestamp` derive mes/dia diferente).
        const { data: existing } = await db
          .from('arquivos')
          .select('id, storage_path')
          .eq('lote_id', loteId)
          .eq('tipo', 'png')
          .eq('nome_arquivo', pngFilename)
          .maybeSingle();
        if (!existing) {
          throw new Error(`  arquivos sem linha pra ${pngFilename} (lote ${loteId}) — abort`);
        }
        const path = existing.storage_path as string;
        const sizeMb = (png.content.length / 1024 / 1024).toFixed(2);
        console.log(`  Uploading ${path} (${sizeMb} MB)`);
        const { error: upErr } = await storage.storage
          .from(BUCKET)
          .upload(path, png.content, { contentType: 'image/png', upsert: true });
        if (upErr) throw new Error(`  upload PNG falhou: ${upErr.message}`);
        await db
          .from('arquivos')
          .update({ tamanho_bytes: png.content.length })
          .eq('id', existing.id);
        console.log(`  OK bloco ${i + 1}/${pngs.length}`);
      }
    } else {
      // Sem chapa fisica — constroi mapa linear (1 chapa por pedido) so pra
      // preservar a estrutura por pedido na conferencia (mesma logica do batch-processor)
      type PackedFotoEntry = (typeof packed)[number];
      const byPedido = new Map<string, PackedFotoEntry[]>();
      for (const p of packed) {
        if (!byPedido.has(p.pedido_id)) byPedido.set(p.pedido_id, []);
        byPedido.get(p.pedido_id)!.push(p);
      }
      let chapaIdx = 0;
      const linearMapa: BlocoMapaEntry[] = [];
      for (const [, its] of Array.from(byPedido)) {
        its.forEach((p, slotIdx) => {
          linearMapa.push({
            foto_id: p.foto_id,
            item_id: p.item_id,
            pedido_id: p.pedido_id,
            nf_id: p.nf_id,
            posicao: p.posicao,
            chapa_index: chapaIdx,
            slot_index: slotIdx,
            public_url: p.public_url,
          });
        });
        chapaIdx++;
      }
      blocoMapa = linearMapa;
    }

    // Thumbs pro PDF
    for (const f of fotos) {
      try {
        const res = await fetch(f.public_url);
        if (res.ok) thumbnails.set(f.foto_id, Buffer.from(await res.arrayBuffer()));
      } catch {
        // opcional
      }
    }
  }

  // 6. PDF de conferencia (mesma logica do batch-processor)
  const temBloco = fotos.length > 0;
  const temBox = boxMessages.length > 0;
  let pdfBuffer: Buffer;

  if (temBloco && temBox) {
    const unifiedRows: UnifiedRow[] = [];
    const blocoSorted = [...blocoMapa].sort(
      (a, b) => a.chapa_index - b.chapa_index || a.slot_index - b.slot_index
    );
    for (const item of blocoSorted) {
      const f = fotos.find((x) => x.foto_id === item.foto_id);
      if (!f) continue;
      unifiedRows.push({
        pedidoId: item.pedido_id,
        numeroPedido: f.numero_pedido ?? '',
        cliente: f.nome_cliente,
        tipo: 'Bloco',
        detalhe: `Chapa ${item.chapa_index + 1} / ${slotLabel(item.slot_index)} / Foto ${item.posicao}`,
        modelo: '',
        numeroNf: f.numero_nf ?? '',
        formaFrete: f.forma_frete,
        tinyPedidoId: f.tiny_pedido_id,
        tinyNfId: f.tiny_nf_id,
        thumbBuffer: thumbnails.get(item.foto_id),
        chapaIndex: item.chapa_index,
        tamanhoBloco: f.tamanho_bloco,
      });
    }
    const numeroPedidoPorPedidoId = new Map<string, number | null>();
    for (const f of fotos) {
      if (f.numero_pedido != null) numeroPedidoPorPedidoId.set(f.pedido_id, f.numero_pedido);
    }
    for (const msg of boxMessages) {
      const pedidoId = msg._pedido_id ?? '';
      unifiedRows.push({
        pedidoId,
        numeroPedido: numeroPedidoPorPedidoId.get(pedidoId) ?? '',
        cliente: msg.cliente ?? '',
        tipo: 'Box',
        detalhe: formatPlateMessage(msg.mensagem).replace(/\n/g, ' | '),
        modelo: msg.modelo ?? '',
        numeroNf: msg.notaFiscal ?? '',
        formaFrete: msg.formaEnvio ?? '',
        tinyPedidoId: typeof msg.pedidoId === 'number' ? msg.pedidoId : null,
        tinyNfId: msg.idNF ?? null,
        personalizada: hasPersonalization(msg.mensagem),
      });
    }
    pdfBuffer = await generateConferenciaUnificada({
      rows: unifiedRows,
      nfOrder,
      pedidoKits,
      numeroExpedicao: numeroExpRef,
      dataGeracao,
    });
  } else if (temBloco) {
    pdfBuffer = await generateBlocoPdf({
      mapa: blocoMapa,
      extraInfo: new Map(
        fotos.map((f) => [
          f.foto_id,
          {
            nome_cliente: f.nome_cliente,
            numero_pedido: f.numero_pedido ?? 0,
            numero_nf: f.numero_nf,
            tiny_nf_id: f.tiny_nf_id,
            forma_frete: f.forma_frete,
            tiny_pedido_id: f.tiny_pedido_id,
            thumbnail_bytes: thumbnails.get(f.foto_id) ?? Buffer.alloc(0),
            tamanho_bloco: f.tamanho_bloco,
          },
        ])
      ),
      pedidoKits,
      numeroExpedicao: numeroExpRef,
      dataGeracao,
    });
  } else {
    pdfBuffer = await generateUniqueBoxPdf(boxMessages, pedidoKits, numeroExpRef, dataGeracao);
  }

  // Upload PDF sobrescrevendo
  const pdfFilename = `conferencia-${numeroExpRef}.pdf`;
  const { data: existingPdf } = await db
    .from('arquivos')
    .select('id, storage_path')
    .eq('lote_id', loteId)
    .eq('tipo', 'pdf')
    .eq('nome_arquivo', pdfFilename)
    .maybeSingle();
  if (!existingPdf) {
    throw new Error(`  arquivos sem linha pra ${pdfFilename} (lote ${loteId}) — abort`);
  }
  const pdfPath = existingPdf.storage_path as string;
  const sizeKb = (pdfBuffer.length / 1024).toFixed(1);
  console.log(`  Uploading ${pdfPath} (${sizeKb} KB)`);
  const { error: pdfUpErr } = await storage.storage
    .from(BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (pdfUpErr) throw new Error(`  upload PDF falhou: ${pdfUpErr.message}`);
  await db
    .from('arquivos')
    .update({ tamanho_bytes: pdfBuffer.length })
    .eq('id', existingPdf.id);
  console.log(`  OK PDF`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: regen-folha-conferencia.ts <numero_expedicao> [<numero_expedicao> ...]');
    process.exit(1);
  }
  for (const a of args) {
    const num = parseInt(a, 10);
    if (!Number.isFinite(num)) {
      console.error(`Argumento invalido: ${a}`);
      process.exit(1);
    }
    await regenerateOne(num);
  }
  console.log('\nFeito.');
}

main().catch((err) => {
  console.error('Erro:', err);
  process.exit(1);
});
