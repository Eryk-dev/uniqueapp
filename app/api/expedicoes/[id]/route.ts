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
      // Count items per pedido
      const itemCounts: Record<string, number> = {};
      for (const i of itens) {
        itemCounts[i.pedido_id] = (itemCounts[i.pedido_id] ?? 0) + 1;
      }
      const pedidoIds = Object.keys(itemCounts);

      const { data: pedidos } = await supabase
        .from("pedidos")
        .select("*, notas_fiscais(tiny_nf_id, tiny_pedido_clone_id, autorizada)")
        .in("id", pedidoIds)
        .order("numero", { ascending: false });

      orders = (pedidos ?? [])
        .filter((p) => p.forma_frete === expedition.forma_frete)
        .map((p) => {
          const nf = Array.isArray(p.notas_fiscais) ? p.notas_fiscais[0] : p.notas_fiscais;
          return {
            ...p,
            itens_count: itemCounts[p.id] ?? 0,
            duplicado: !!nf?.tiny_pedido_clone_id,
            nf_emitida: !!nf?.tiny_nf_id,
            nf_autorizada: !!nf?.autorizada,
          };
        });
    }
  }

  // Fetch files linked to this lote
  let arquivos: Record<string, unknown>[] = [];
  if (expedition.lote_id) {
    const { data: files } = await supabase
      .from("arquivos")
      .select("*")
      .eq("lote_id", expedition.lote_id)
      .order("created_at");
    arquivos = files ?? [];
  }

  return NextResponse.json({ expedition, orders, arquivos });
}
