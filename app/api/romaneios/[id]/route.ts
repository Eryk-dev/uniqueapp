import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { buscarRastreio } from "@/lib/romaneio";

type ItemRomaneio = {
  tiny_nf_id: number;
  numero_nf: number | null;
  numero_pedido: number | null;
  nome_cliente: string | null;
  linha_produto: string | null;
  numero_expedicao: number | null;
  cidade: string | null;
  uf: string | null;
  codigo_rastreio: string | null;
  url_rastreio: string | null;
  pedido_id: string | null;
  expedicao_id: string | null;
};

/**
 * Tenta preencher rastreio que ficou faltando no fechamento — caso do
 * romaneio gerado antes de o Tiny materializar a etiqueta. Persiste o
 * que achar, entao a proxima reimpressao ja sai sem chamada nenhuma.
 * Best-effort: falha nao impede a reimpressao.
 */
async function completarRastreio(
  itens: ItemRomaneio[],
  supabase: ReturnType<typeof createServerClient>
): Promise<void> {
  const faltando = itens.filter((i) => !i.codigo_rastreio && i.expedicao_id);
  if (faltando.length === 0) return;

  const expedicaoIds = Array.from(new Set(faltando.map((i) => i.expedicao_id!)));
  const { data: expedicoes } = await supabase
    .from("expedicoes")
    .select("tiny_agrupamento_id")
    .in("id", expedicaoIds);

  const rastreioPorNf = await buscarRastreio(expedicoes ?? []);
  if (rastreioPorNf.size === 0) return;

  await Promise.all(
    faltando.map(async (item) => {
      const r = rastreioPorNf.get(item.tiny_nf_id);
      if (!r?.codigo) return;

      item.codigo_rastreio = r.codigo;
      item.url_rastreio = r.url;
      await supabase
        .from("romaneio_itens")
        .update({ codigo_rastreio: r.codigo, url_rastreio: r.url })
        .eq("tiny_nf_id", item.tiny_nf_id);
    })
  );
}

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

  const { data, error } = await supabase
    .from("romaneio_itens")
    .select(
      "tiny_nf_id, numero_nf, numero_pedido, nome_cliente, linha_produto, numero_expedicao, cidade, uf, codigo_rastreio, url_rastreio, pedido_id, expedicao_id"
    )
    .eq("romaneio_id", id)
    .order("numero_nf", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const itens = (data ?? []).map((i) => ({
    ...i,
    tiny_nf_id: Number(i.tiny_nf_id),
  })) as ItemRomaneio[];

  await completarRastreio(itens, supabase);

  return NextResponse.json({ romaneio, itens });
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
