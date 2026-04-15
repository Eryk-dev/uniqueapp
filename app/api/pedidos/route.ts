import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const linhaProduto = params.get('linha_produto');
  const formaFrete = params.get('forma_frete');
  const molde = params.get('molde');
  const busca = params.get('busca');
  const page = Math.max(1, parseInt(params.get('page') ?? '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(params.get('per_page') ?? '50')));

  const supabase = createServerClient();

  let query = supabase
    .from('pedidos')
    .select('*, itens_producao(count), notas_fiscais(tiny_pedido_clone_id, tiny_nf_id, autorizada)', { count: 'exact' });

  if (status) {
    const statuses = status.split(',');
    query = statuses.length > 1
      ? query.in('status', statuses)
      : query.eq('status', status);
  }
  if (linhaProduto) query = query.eq('linha_produto', linhaProduto);
  if (formaFrete) query = query.eq('forma_frete', formaFrete);
  if (busca) {
    query = query.or(`nome_cliente.ilike.%${busca}%,numero.eq.${parseInt(busca) || 0}`);
  }

  // Molde filter via join on itens_producao
  if (molde) {
    const { data: itemPedidoIds } = await supabase
      .from('itens_producao')
      .select('pedido_id')
      .eq('molde', molde);

    if (itemPedidoIds?.length) {
      query = query.in('id', itemPedidoIds.map((i) => i.pedido_id));
    } else {
      return NextResponse.json({
        data: [],
        pagination: { page, per_page: perPage, total: 0 },
      });
    }
  }

  const offset = (page - 1) * perPage;
  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('Pedidos query error:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const formatted = (data ?? []).map((p) => {
    const nf = Array.isArray(p.notas_fiscais)
      ? p.notas_fiscais[0]
      : p.notas_fiscais;

    return {
      id: p.id,
      tiny_pedido_id: p.tiny_pedido_id,
      numero: p.numero,
      nome_cliente: p.nome_cliente,
      linha_produto: p.linha_produto,
      status: p.status,
      forma_frete: p.forma_frete,
      created_at: p.created_at,
      itens_count: Array.isArray(p.itens_producao)
        ? p.itens_producao.length
        : (p.itens_producao as { count: number })?.count ?? 0,
      duplicado: !!nf?.tiny_pedido_clone_id,
      nf_emitida: !!nf?.tiny_nf_id,
      nf_autorizada: !!nf?.autorizada,
      tipo_personalizacao: null as string | null,
    };
  });

  // Classify uniquebox orders as 'bloco' or 'uniquebox' based on item personalization
  const uniqueboxIds = formatted
    .filter((p) => p.linha_produto === 'uniquebox')
    .map((p) => p.id);

  if (uniqueboxIds.length > 0) {
    const { data: blocoItems } = await supabase
      .from('itens_producao')
      .select('pedido_id')
      .in('pedido_id', uniqueboxIds)
      .ilike('modelo', '%bloco%');

    const { data: boxItems } = await supabase
      .from('itens_producao')
      .select('pedido_id')
      .in('pedido_id', uniqueboxIds)
      .not('modelo', 'ilike', '%bloco%');

    const blocoSet = new Set((blocoItems ?? []).map((i) => i.pedido_id));
    const boxSet = new Set((boxItems ?? []).map((i) => i.pedido_id));

    for (const p of formatted) {
      if (p.linha_produto === 'uniquebox') {
        const hasBloco = blocoSet.has(p.id);
        const hasBox = boxSet.has(p.id);
        if (hasBloco && hasBox) p.tipo_personalizacao = 'box_bloco';
        else if (hasBloco) p.tipo_personalizacao = 'bloco';
        else p.tipo_personalizacao = 'uniquebox';
      }
    }
  }

  return NextResponse.json({
    data: formatted,
    pagination: { page, per_page: perPage, total: count ?? 0 },
  });
}
