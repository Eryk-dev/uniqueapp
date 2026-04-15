import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();
  const search = request.nextUrl.searchParams.get('search')?.trim() || '';

  let loteIds: string[] | null = null;

  if (search) {
    const isNumeric = /^\d+$/.test(search);
    const allLoteIds = new Set<string>();

    // Search pedidos by nome_cliente, id_pedido_ecommerce, numero
    let orFilters = `nome_cliente.ilike.%${search}%,id_pedido_ecommerce.ilike.%${search}%`;
    if (isNumeric) {
      orFilters += `,numero.eq.${parseInt(search)}`;
    }

    const { data: matchingPedidos } = await supabase
      .from('pedidos')
      .select('id')
      .or(orFilters);

    const pedidoIds = (matchingPedidos ?? []).map((p: { id: string }) => p.id);

    // Find lote_ids via itens_producao (matching pedidos or numero_nf)
    if (pedidoIds.length > 0 || isNumeric) {
      const parts: string[] = [];
      if (pedidoIds.length > 0) {
        parts.push(`pedido_id.in.(${pedidoIds.join(',')})`);
      }
      if (isNumeric) {
        parts.push(`numero_nf.eq.${parseInt(search)}`);
      }

      const { data: itens } = await supabase
        .from('itens_producao')
        .select('lote_id')
        .not('lote_id', 'is', null)
        .or(parts.join(','));

      for (const item of itens ?? []) {
        if (item.lote_id) allLoteIds.add(item.lote_id as string);
      }
    }

    // Also search arquivos by nome_arquivo
    const { data: matchingArquivos } = await supabase
      .from('arquivos')
      .select('lote_id')
      .ilike('nome_arquivo', `%${search}%`);

    for (const a of matchingArquivos ?? []) {
      allLoteIds.add(a.lote_id as string);
    }

    loteIds = Array.from(allLoteIds);
    if (loteIds.length === 0) {
      return NextResponse.json({ batches: [] });
    }
  }

  // Fetch lotes with enriched data
  let query = supabase
    .from('lotes_producao')
    .select(
      '*, arquivos(*), itens_producao(pedido_id, numero_nf, pedidos(nome_cliente, id_pedido_ecommerce, numero)), expedicoes(id)'
    )
    .order('created_at', { ascending: false });

  if (loteIds) {
    query = query.in('id', loteIds);
  }

  query = query.limit(50);

  const { data: lotes, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batches = (lotes ?? [] as any[])
    .filter((l) => Array.isArray(l.arquivos) && l.arquivos.length > 0)
    .map((l) => {
      // Deduplicate pedido info per batch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pedidoMap = new Map<string, any>();
      for (const item of l.itens_producao ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pedido = item.pedidos as any;
        if (!pedido || pedidoMap.has(item.pedido_id)) continue;
        pedidoMap.set(item.pedido_id, {
          nome_cliente: pedido.nome_cliente,
          id_pedido_ecommerce: pedido.id_pedido_ecommerce,
          numero: pedido.numero,
          numero_nf: item.numero_nf,
        });
      }

      return {
        id: l.id,
        linha_produto: l.linha_produto,
        status: l.status,
        created_at: l.created_at,
        total_itens: l.total_itens,
        itens_sucesso: l.itens_sucesso,
        itens_erro: l.itens_erro,
        arquivos: l.arquivos,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expedicao_id: (l.expedicoes as any)?.[0]?.id ?? null,
        pedidos: Array.from(pedidoMap.values()),
      };
    });

  return NextResponse.json({ batches });
}
