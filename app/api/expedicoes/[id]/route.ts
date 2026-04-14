import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();

  // Fetch the expedition
  const { data: expedition, error } = await supabase
    .from("expedicoes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !expedition) {
    return NextResponse.json(
      { error: "Expedicao nao encontrada" },
      { status: 404 }
    );
  }

  // Fetch orders linked to this expedition's lote
  let orders: Record<string, unknown>[] = [];

  if (expedition.lote_id) {
    // Get pedido IDs from itens_producao that belong to this lote
    const { data: itens } = await supabase
      .from("itens_producao")
      .select("pedido_id")
      .eq("lote_id", expedition.lote_id);

    if (itens?.length) {
      const pedidoIds = Array.from(new Set(itens.map((i) => i.pedido_id)));

      const { data: pedidos } = await supabase
        .from("pedidos")
        .select("*")
        .in("id", pedidoIds)
        .order("numero", { ascending: false });

      // Filter to matching freight type
      orders = (pedidos ?? []).filter(
        (p) => p.forma_frete === expedition.forma_frete
      );
    }
  }

  return NextResponse.json({ expedition, orders });
}
