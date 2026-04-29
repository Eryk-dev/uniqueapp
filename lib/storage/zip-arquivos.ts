import JSZip from "jszip";
import { createServerClient, createStorageClient } from "@/lib/supabase/server";

/**
 * Empacota todos os arquivos de um lote por tipo num ZIP.
 * Retorna { buffer, count } ou null se nao houver arquivos.
 */
export async function buildLoteZip(
  loteId: string,
  tipo: "svg" | "png"
): Promise<{ buffer: Buffer; count: number } | null> {
  const supabase = createServerClient();
  const storage = createStorageClient();

  const { data: arquivos } = await supabase
    .from("arquivos")
    .select("storage_bucket, storage_path, nome_arquivo")
    .eq("lote_id", loteId)
    .eq("tipo", tipo)
    .order("nome_arquivo");

  if (!arquivos || arquivos.length === 0) return null;

  const zip = new JSZip();
  for (const a of arquivos) {
    const { data, error } = await storage.storage
      .from(a.storage_bucket)
      .download(a.storage_path);
    if (error || !data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    zip.file(a.nome_arquivo, buf);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer, count: arquivos.length };
}
