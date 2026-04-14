import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  // Fetch all expeditions with their order count
  const { data: expeditions, error } = await supabase
    .from("expedicoes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Also fetch "ready to ship" orders grouped by freight
  // These are produzido orders that don't have an expedition yet
  const { data: readyOrders } = await supabase
    .from("pedidos")
    .select("id, numero, nome_cliente, linha_produto, forma_frete, created_at")
    .eq("status", "produzido");

  // Group ready orders by forma_frete
  const pendingGroups: Record<
    string,
    {
      forma_frete: string;
      orders: typeof readyOrders;
      count: number;
    }
  > = {};

  for (const order of readyOrders ?? []) {
    const key = order.forma_frete || "Sem frete";
    if (!pendingGroups[key]) {
      pendingGroups[key] = { forma_frete: key, orders: [], count: 0 };
    }
    pendingGroups[key].orders!.push(order);
    pendingGroups[key].count++;
  }

  return NextResponse.json({
    expeditions: expeditions ?? [],
    pending_groups: Object.values(pendingGroups),
  });
}
