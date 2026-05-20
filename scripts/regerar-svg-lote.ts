// scripts/regerar-svg-lote.ts
//
// Regenera o(s) SVG(s) UniqueBox de um lote ja gerado e faz upload pro Storage.
// Usado pra recuperar arquivos cuja linha em `arquivos` foi inserida mas o
// upload pro Storage falhou silenciosamente (caso da exp 4632, 2026-05-20).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   STORAGE_SUPABASE_URL=... STORAGE_SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/regerar-svg-lote.ts <lote_id>
//
// O script lê itens_producao do lote, reconstrói as messages na mesma ordem do
// batch-processor (nfOrder das etiquetas Tiny) e regenera o SVG via
// generateUniqueBoxSvgs. Faz upload no storage_path que ja existe em `arquivos`.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { generateUniqueBoxSvgs, type UniqueBoxMessage } from '../lib/generation/uniquebox';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!v) throw new Error(`Missing env: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  return v;
}

function buildNfPos(order: Array<number | string>): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < order.length; i++) {
    const n = Number(order[i]);
    if (Number.isFinite(n)) m.set(n, i);
  }
  return m;
}

async function main() {
  const loteId = process.argv[2];
  if (!loteId) {
    console.error('Uso: npx tsx scripts/regerar-svg-lote.ts <lote_id>');
    process.exit(2);
  }

  const dbUrl = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const dbKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const storageUrl = process.env.STORAGE_SUPABASE_URL ?? dbUrl;
  const storageKey = process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY ?? dbKey;

  const db = createClient(dbUrl, dbKey, { db: { schema: 'unique_app' } });
  const storage = createClient(storageUrl, storageKey);

  // 1. Lê itens do lote (mesma query do batch-processor)
  const { data: rawItems, error: itemsErr } = await db
    .from('itens_producao')
    .select(
      '*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id, kits)'
    )
    .eq('lote_id', loteId);
  if (itemsErr) throw itemsErr;

  const items = (rawItems ?? []).filter(
    (i: Record<string, unknown>) =>
      (i as { pedidos?: { linha_produto?: string } }).pedidos?.linha_produto === 'uniquebox'
  );
  if (items.length === 0) {
    console.error(`Nenhum item uniquebox encontrado no lote ${loteId}`);
    process.exit(3);
  }

  // 2. nfOrder da expedicao
  const { data: exp } = await db
    .from('expedicoes')
    .select('nf_ids, numero_expedicao')
    .eq('lote_id', loteId)
    .single();
  const nfOrder = (exp?.nf_ids as Array<number | string> | null) ?? [];
  const nfPos = buildNfPos(nfOrder);
  const posOfNf = (id: number | string | null | undefined) => {
    const n = Number(id);
    return Number.isFinite(n) ? nfPos.get(n) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  };

  // 3. Build messages na mesma ordem
  const messages: UniqueBoxMessage[] = items.map((item: Record<string, unknown>) => {
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

  // 4. Filtra so itens box (sem "bloco" no modelo)
  const boxItemIds = new Set(
    items
      .filter((i: Record<string, unknown>) =>
        !String(i.modelo ?? '').toLowerCase().includes('bloco')
      )
      .map((i: Record<string, unknown>) => i.id as string)
  );
  const boxMessages = messages.filter((m) => boxItemIds.has(m._item_id ?? ''));

  console.log(`Lote ${loteId}: ${items.length} itens, ${boxMessages.length} box messages`);

  // 5. Gera SVGs
  const svgs = generateUniqueBoxSvgs(boxMessages);
  if (svgs.length === 0) {
    console.error('Nenhuma mensagem personalizada — nada a regenerar');
    process.exit(0);
  }

  // 6. Para cada SVG, encontra a linha `arquivos` correspondente (por
  //    storage_path) e faz upload (upsert pra sobrescrever se ja houver).
  const { data: arquivos } = await db
    .from('arquivos')
    .select('id, nome_arquivo, storage_path, storage_bucket, tamanho_bytes')
    .eq('lote_id', loteId)
    .eq('tipo', 'svg')
    .order('nome_arquivo');

  const svgArquivos = (arquivos ?? []).filter((a) => /^box-.*\.svg$/i.test(a.nome_arquivo ?? ''));

  if (svgArquivos.length !== svgs.length) {
    console.warn(
      `WARN: ${svgs.length} SVG(s) gerado(s) mas ${svgArquivos.length} linha(s) em arquivos. Vou subir pareando pela ordem.`
    );
  }

  for (let i = 0; i < svgs.length; i++) {
    const svgContent = svgs[i]!;
    const arq = svgArquivos[i];
    if (!arq) {
      console.error(`Sem linha em \`arquivos\` pra SVG #${i + 1} — pulando upload`);
      continue;
    }
    const buf = Buffer.from(svgContent, 'utf-8');

    const { error: upErr } = await storage.storage
      .from(arq.storage_bucket as string)
      .upload(arq.storage_path as string, buf, {
        contentType: 'image/svg+xml',
        upsert: true,
      });
    if (upErr) {
      console.error(`Upload falhou (${arq.storage_path}): ${upErr.message}`);
      process.exit(4);
    }

    // Atualiza tamanho_bytes (pode ter mudado)
    if (arq.tamanho_bytes !== buf.length) {
      await db.from('arquivos').update({ tamanho_bytes: buf.length }).eq('id', arq.id);
    }

    console.log(`OK: ${arq.nome_arquivo} (${buf.length} bytes) -> ${arq.storage_bucket}/${arq.storage_path}`);
  }

  // Log de auditoria
  await db.from('eventos').insert({
    lote_id: loteId,
    tipo: 'manutencao',
    descricao: `SVG UniqueBox regenerado via script (${svgs.length} arquivo${svgs.length > 1 ? 's' : ''})`,
    dados: { exp: exp?.numero_expedicao ?? null, arquivos: svgArquivos.map((a) => a.nome_arquivo) },
    ator: 'sistema',
  });

  console.log('Pronto.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
