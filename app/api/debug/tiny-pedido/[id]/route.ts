import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { fetchOrder } from "@/lib/tiny/client";

/**
 * Debug: retorna JSON cru do fetchOrder pra um tiny_pedido_id.
 * Usado pra inspecionar campos como enderecoEntrega/cliente quando
 * o DANFE simplificado nao mostra dados esperados.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const tinyPedidoId = Number(id);
  if (!tinyPedidoId || Number.isNaN(tinyPedidoId)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  try {
    const pedido = await fetchOrder(tinyPedidoId);
    return NextResponse.json(pedido);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
