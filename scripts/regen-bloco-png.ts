/**
 * Regenera um PNG de chapa de bloco que ficou orfão no `arquivos` (DB tem linha,
 * Storage não tem o blob — tipicamente upload falhou por exceder file_size_limit).
 *
 * Uso:
 *   npx tsx scripts/regen-bloco-png.ts <lote_id> [chapa_num] [timestamp]
 *
 * - lote_id: obrigatório
 * - chapa_num: 1-based; se omitido, sobe TODAS as chapas do lote (com upsert)
 * - timestamp: formato "YYYY-MM-DDTHHMM" (slice 0..15 do ISO sem `:` e `.`).
 *              Se omitido, usa agora. Use o timestamp original se quiser que o path
 *              bata com o registro existente em `arquivos`.
 *
 * Exemplo (regerar a chapa 1 do lote 6b44e8df-... com timestamp original):
 *   npx tsx scripts/regen-bloco-png.ts 6b44e8df-ff2b-47df-a0ed-164ca7cc9526 1 2026-04-27T1430
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Carrega env preferindo .env.local (Next.js convention) com fallback pra .env
const envPath = [".env.local", ".env"]
  .map((f) => resolve(__dirname, "..", f))
  .find((p) => existsSync(p));
if (envPath) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

import { createClient } from "@supabase/supabase-js";
import { packFotos, type FotoToPlace } from "../lib/generation/bloco";
import { renderBlocoPngs } from "../lib/generation/bloco-png";

const BUCKET_BLOCO_FOTOS = "bloco-fotos";
const BUCKET_UNIQUEBOX = "uniquebox-files";

function makeTimestampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
}

function deriveStoragePrefixFromTimestamp(loteId: string, ts: string): string {
  // ts esperado: "YYYY-MM-DDTHHMM"
  const month = ts.slice(0, 7); // "2026-04"
  const day = ts.slice(8, 10); // "27"
  if (!/^\d{4}-\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    throw new Error(`Timestamp inválido para derivar prefix: ${ts}`);
  }
  return `${month}/${day}/${loteId}`;
}

async function main() {
  const [, , loteIdArg, chapaArg, tsArg] = process.argv;
  if (!loteIdArg) {
    console.error("Usage: regen-bloco-png.ts <lote_id> [chapa_num] [timestamp]");
    process.exit(1);
  }
  const loteId = loteIdArg;
  const chapaFilter = chapaArg ? parseInt(chapaArg, 10) : null;
  const timestamp = tsArg ?? makeTimestampNow();
  const storagePrefix = deriveStoragePrefixFromTimestamp(loteId, timestamp);

  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stUrl = process.env.STORAGE_SUPABASE_URL ?? dbUrl;
  const stKey = process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY ?? dbKey;
  if (!dbUrl || !dbKey || !stUrl || !stKey) {
    throw new Error("Faltam env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY e/ou STORAGE_*");
  }

  const db = createClient(dbUrl, dbKey, { db: { schema: "unique_app" } });
  const storage = createClient(stUrl, stKey);

  console.log(`Lote: ${loteId}`);
  console.log(`Storage prefix: ${storagePrefix}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Chapa filter: ${chapaFilter ?? "todas"}`);
  console.log("");

  // 1. Carregar fotos do lote (mesmo query que loadFotosForLote em batch-processor)
  const { data: items, error: qErr } = await db
    .from("itens_producao")
    .select(
      `id, pedido_id,
       fotos_bloco (id, posicao, storage_path, status),
       pedidos!inner (id, numero, tiny_pedido_id, nome_cliente, forma_frete, notas_fiscais(tiny_nf_id))`
    )
    .eq("lote_id", loteId)
    .ilike("modelo", "%bloco%");

  if (qErr) throw new Error(`Query lote: ${qErr.message}`);
  if (!items?.length) {
    throw new Error(`Nenhum item de bloco encontrado pra lote ${loteId}`);
  }

  const fotos: FotoToPlace[] = [];
  for (const item of items) {
    const pedidoArr = Array.isArray(item.pedidos) ? item.pedidos : [item.pedidos];
    const pedido = pedidoArr[0] as
      | { notas_fiscais?: Array<{ tiny_nf_id: number }> }
      | undefined;
    const nfId = pedido?.notas_fiscais?.[0]?.tiny_nf_id ?? 0;

    const fbArr = (item.fotos_bloco ?? []) as Array<{
      id: string;
      posicao: number;
      storage_path: string | null;
      status: string;
    }>;
    for (const f of fbArr) {
      if (f.status !== "baixada" || !f.storage_path) continue;
      const { data: pub } = storage.storage
        .from(BUCKET_BLOCO_FOTOS)
        .getPublicUrl(f.storage_path);
      fotos.push({
        foto_id: f.id,
        item_id: item.id as string,
        pedido_id: item.pedido_id as string,
        nf_id: nfId,
        posicao: f.posicao,
        public_url: pub.publicUrl,
      });
    }
  }

  if (fotos.length === 0) {
    throw new Error(`Lote ${loteId} sem fotos com status='baixada'`);
  }

  // Mesma ordenação que batch-processor.loadFotosForLote
  fotos.sort(
    (a, b) =>
      a.nf_id - b.nf_id ||
      a.pedido_id.localeCompare(b.pedido_id) ||
      a.posicao - b.posicao
  );

  console.log(`${fotos.length} fotos carregadas`);

  // 2. Packs e render
  const packed = packFotos(fotos);
  console.log(`Renderizando PNGs (sharp)...`);
  const { pngs } = await renderBlocoPngs(packed, timestamp);
  console.log(`${pngs.length} chapa(s) renderizada(s)`);

  // 3. Upload + update arquivos
  for (const png of pngs) {
    const chapaNum = png.chapa_index + 1;
    if (chapaFilter !== null && chapaNum !== chapaFilter) {
      console.log(`SKIP chapa ${chapaNum} (filter=${chapaFilter})`);
      continue;
    }
    const path = `${storagePrefix}/${png.filename}`;
    const sizeMb = (png.content.length / 1024 / 1024).toFixed(2);
    console.log(`Uploading ${path} (${sizeMb} MB)...`);

    const { error: upErr } = await storage.storage
      .from(BUCKET_UNIQUEBOX)
      .upload(path, png.content, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.error(`  upload FAIL: ${upErr.message}`);
      continue;
    }

    const { error: updErr, count } = await db
      .from("arquivos")
      .update(
        { tamanho_bytes: png.content.length },
        { count: "exact" }
      )
      .eq("lote_id", loteId)
      .eq("storage_path", path);
    if (updErr) {
      console.error(`  arquivos update FAIL: ${updErr.message}`);
    } else {
      console.log(`  OK upload + ${count ?? 0} arquivos row(s) atualizada(s)`);
    }
  }

  console.log("\nFeito.");
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
