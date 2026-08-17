import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

/**
 * GET /api/romaneios/[id]
 * Romaneio + itens (snapshot) — usado pra reimprimir a folha.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: romaneio } = await supabase
    .from("romaneios")
    .select("id, numero, transportadora, total_volumes, observacoes, created_at")
    .eq("id", id)
    .single();

  if (!romaneio) {
    return NextResponse.json({ error: "Romaneio nao encontrado" }, { status: 404 });
  }

  const { data: itens, error } = await supabase
    .from("romaneio_itens")
    .select(
      "tiny_nf_id, numero_nf, numero_pedido, nome_cliente, linha_produto, numero_expedicao, cidade, uf, pedido_id, expedicao_id"
    )
    .eq("romaneio_id", id)
    .order("numero_nf", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ romaneio, itens: itens ?? [] });
}

/**
 * DELETE /api/romaneios/[id]
 * Cancela o romaneio. Os itens caem por CASCADE e as NFs voltam pra lista
 * de pendentes (o UNIQUE em tiny_nf_id era o que as segurava).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: romaneio } = await supabase
    .from("romaneios")
    .select("id, numero, transportadora, total_volumes")
    .eq("id", id)
    .single();

  if (!romaneio) {
    return NextResponse.json({ error: "Romaneio nao encontrado" }, { status: 404 });
  }

  const { error } = await supabase.from("romaneios").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("eventos").insert({
    tipo: "romaneio_cancelado",
    descricao: `Romaneio ${romaneio.numero} — ${romaneio.transportadora} — cancelado (${romaneio.total_volumes} volumes voltaram pra pendentes)`,
    dados: { numero: romaneio.numero, transportadora: romaneio.transportadora },
    ator: user.username,
  });

  return NextResponse.json({ ok: true });
}
