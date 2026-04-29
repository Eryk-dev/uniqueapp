import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient, createStorageClient } from "@/lib/supabase/server";
import { processUniqueBoxBatch, processUniqueKidsBatch } from "@/lib/generation";

/**
 * Reprocessa um lote: limpa arquivos antigos do Storage + tabela arquivos,
 * volta itens pra 'pendente', volta lote pra 'processando' e redispara
 * o processBatch correto (background, fire-and-forget).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ loteId: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { loteId } = await params;
  const supabase = createServerClient();
  const storage = createStorageClient();

  const { data: lote, error: loteError } = await supabase
    .from("lotes_producao")
    .select("id, linha_produto, status")
    .eq("id", loteId)
    .single();

  if (loteError || !lote) {
    return NextResponse.json({ error: "Lote nao encontrado" }, { status: 404 });
  }

  // 1. Apaga arquivos antigos do Storage e da tabela
  const { data: arquivos } = await supabase
    .from("arquivos")
    .select("id, storage_bucket, storage_path")
    .eq("lote_id", loteId);

  const byBucket = new Map<string, string[]>();
  for (const a of arquivos ?? []) {
    if (!byBucket.has(a.storage_bucket)) byBucket.set(a.storage_bucket, []);
    byBucket.get(a.storage_bucket)!.push(a.storage_path);
  }
  for (const [bucket, paths] of Array.from(byBucket)) {
    if (paths.length > 0) {
      await storage.storage.from(bucket).remove(paths);
    }
  }
  await supabase.from("arquivos").delete().eq("lote_id", loteId);

  // 2. Volta status dos itens e do lote
  await supabase
    .from("itens_producao")
    .update({ status: "pendente", erro_detalhe: null })
    .eq("lote_id", loteId);

  await supabase
    .from("lotes_producao")
    .update({ status: "processando", completed_at: null })
    .eq("id", loteId);

  await supabase.from("eventos").insert({
    lote_id: loteId,
    tipo: "status_change",
    descricao: `Reprocessamento disparado por ${authResult.id}`,
    ator: authResult.id,
  });

  // 3. Dispara processBatch em background
  const fn =
    lote.linha_produto === "uniquebox" ? processUniqueBoxBatch : processUniqueKidsBatch;

  fn(loteId).catch(async (err) => {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("lotes_producao")
      .update({ status: "erro_parcial", completed_at: new Date().toISOString() })
      .eq("id", loteId);
    await supabase.from("eventos").insert({
      lote_id: loteId,
      tipo: "erro",
      descricao: `Erro no reprocessamento: ${message}`,
      dados: { error: message },
      ator: "sistema",
    });
  });

  return NextResponse.json(
    { status: "processando", lote_id: loteId },
    { status: 202 }
  );
}
