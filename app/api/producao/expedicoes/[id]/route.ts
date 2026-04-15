import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

const statusSchema = z.object({
  status: z.enum(["pendente", "em_producao", "finalizado"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const parsed = statusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Status invalido" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const { status } = parsed.data;

  // Update expedition status
  const { data: expedition, error } = await supabase
    .from("expedicoes")
    .update({ status })
    .eq("id", params.id)
    .select("*, lotes_producao(*)")
    .single();

  if (error || !expedition) {
    return NextResponse.json(
      { error: "Expedicao nao encontrada" },
      { status: 404 }
    );
  }

  // When operator marks as finalizado, update pedidos to produzido
  if (status === "finalizado" && expedition.lote_id) {
    const { data: itens } = await supabase
      .from("itens_producao")
      .select("pedido_id")
      .eq("lote_id", expedition.lote_id);

    if (itens?.length) {
      const pedidoIds = Array.from(new Set(itens.map((i) => i.pedido_id)));
      await supabase
        .from("pedidos")
        .update({ status: "produzido" })
        .in("id", pedidoIds);
    }

    await supabase.from("eventos").insert({
      lote_id: expedition.lote_id,
      tipo: "status_change",
      descricao: `Producao finalizada pelo operador`,
      ator: authResult.id,
    });
  }

  return NextResponse.json({ expedition });
}
