import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { buildLoteZip } from "@/lib/storage/zip-arquivos";

/**
 * GET /api/expedicoes/[id]/uv
 * Devolve um ZIP com todos os PNGs do lote (impressao UV).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: expedition } = await supabase
    .from("expedicoes")
    .select("lote_id, numero_expedicao")
    .eq("id", id)
    .single();

  if (!expedition?.lote_id) {
    return NextResponse.json({ error: "Expedicao sem lote" }, { status: 404 });
  }

  const result = await buildLoteZip(expedition.lote_id, "png");
  if (!result) {
    return NextResponse.json({ error: "Nenhum PNG no lote" }, { status: 404 });
  }

  const filename = expedition.numero_expedicao
    ? `uv-${expedition.numero_expedicao}.zip`
    : `uv-${id}.zip`;

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
