import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  const { data: expeditions, error } = await supabase
    .from("expedicoes")
    .select("*, lotes_producao(*)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Fetch files for all lotes in one query
  const loteIds = (expeditions ?? [])
    .map((e) => e.lote_id)
    .filter(Boolean) as string[];

  const filesMap: Record<string, Array<{ id: string; tipo: string; nome_arquivo: string; storage_path: string; storage_bucket: string; tamanho_bytes: number }>> = {};

  if (loteIds.length > 0) {
    const { data: files } = await supabase
      .from("arquivos")
      .select("id, lote_id, tipo, nome_arquivo, storage_path, storage_bucket, tamanho_bytes")
      .in("lote_id", loteIds);

    for (const f of files ?? []) {
      if (!filesMap[f.lote_id]) filesMap[f.lote_id] = [];
      filesMap[f.lote_id].push(f);
    }
  }

  // Group by expedition status (operator-controlled)
  const pendente: unknown[] = [];
  const em_producao: unknown[] = [];
  const finalizado: unknown[] = [];

  for (const exp of expeditions ?? []) {
    const enriched = { ...exp, arquivos: filesMap[exp.lote_id] ?? [] };

    switch (exp.status) {
      case "em_producao":
        em_producao.push(enriched);
        break;
      case "finalizado":
        finalizado.push(enriched);
        break;
      default:
        // 'pendente' and 'erro' go to first column
        pendente.push(enriched);
        break;
    }
  }

  return NextResponse.json({ pendente, em_producao, finalizado });
}
