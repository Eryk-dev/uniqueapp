import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAgrupamentoLabels } from "@/lib/tiny/client";

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
    .select("tiny_agrupamento_id")
    .eq("id", id)
    .single();

  if (!expedition?.tiny_agrupamento_id) {
    return NextResponse.json(
      { error: "Expedicao sem agrupamento no Tiny" },
      { status: 404 }
    );
  }

  try {
    const result = await fetchAgrupamentoLabels(expedition.tiny_agrupamento_id);
    return NextResponse.json({ urls: result.urls ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar etiquetas";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
