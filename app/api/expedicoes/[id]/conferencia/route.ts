import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient, createStorageClient } from "@/lib/supabase/server";

/**
 * GET /api/expedicoes/[id]/conferencia
 * Devolve o PDF de conferencia do lote da expedicao.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();
  const storage = createStorageClient();

  const { data: expedition } = await supabase
    .from("expedicoes")
    .select("lote_id, numero_expedicao")
    .eq("id", id)
    .single();

  if (!expedition?.lote_id) {
    return NextResponse.json({ error: "Expedicao sem lote" }, { status: 404 });
  }

  const { data: arquivo } = await supabase
    .from("arquivos")
    .select("storage_bucket, storage_path, nome_arquivo")
    .eq("lote_id", expedition.lote_id)
    .eq("tipo", "pdf")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!arquivo) {
    return NextResponse.json({ error: "Conferencia nao gerada" }, { status: 404 });
  }

  const { data: file, error } = await storage.storage
    .from(arquivo.storage_bucket)
    .download(arquivo.storage_path);

  if (error || !file) {
    return NextResponse.json({ error: "Falha ao baixar do storage" }, { status: 500 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = expedition.numero_expedicao
    ? `conferencia-${expedition.numero_expedicao}.pdf`
    : arquivo.nome_arquivo;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
