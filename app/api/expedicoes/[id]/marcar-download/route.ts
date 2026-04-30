import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

const schema = z.object({
  tipo: z.enum(["etiquetas-conferencia", "conferencia", "cnc", "uv"]),
});

/**
 * POST /api/expedicoes/[id]/marcar-download
 * Body: { tipo: 'etiquetas-conferencia' | 'conferencia' | 'cnc' | 'uv' }
 *
 * - 'etiquetas-conferencia': marca etiquetas_baixadas_em E conferencia_baixada_em.
 *   Se a expedicao esta 'pendente', move pra 'em_producao'.
 * - 'conferencia': marca apenas conferencia_baixada_em. Usado em expedicoes avulso
 *   (sem etiqueta do Tiny). Se 'pendente', move pra 'em_producao'.
 * - 'cnc': marca cnc_baixado_em.
 * - 'uv': marca uv_baixado_em.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "tipo invalido" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: expedition } = await supabase
    .from("expedicoes")
    .select("status, lote_id")
    .eq("id", id)
    .single();

  if (!expedition) {
    return NextResponse.json({ error: "Expedicao nao encontrada" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const update: Record<string, string> = {};

  if (parsed.data.tipo === "etiquetas-conferencia") {
    update.etiquetas_baixadas_em = now;
    update.conferencia_baixada_em = now;
    if (expedition.status === "pendente") {
      update.status = "em_producao";
    }
  } else if (parsed.data.tipo === "conferencia") {
    update.conferencia_baixada_em = now;
    if (expedition.status === "pendente") {
      update.status = "em_producao";
    }
  } else if (parsed.data.tipo === "cnc") {
    update.cnc_baixado_em = now;
  } else if (parsed.data.tipo === "uv") {
    update.uv_baixado_em = now;
  }

  const { error } = await supabase
    .from("expedicoes")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (expedition.lote_id) {
    await supabase.from("eventos").insert({
      lote_id: expedition.lote_id,
      tipo: "status_change",
      descricao: `Download marcado: ${parsed.data.tipo}${update.status ? ` (status -> ${update.status})` : ""}`,
      ator: authResult.id,
    });
  }

  return NextResponse.json({ ok: true, ...update });
}
