import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();

  // Fetch pedido
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !pedido) {
    return NextResponse.json({ error: 'Pedido not found' }, { status: 404 });
  }

  // Fetch related data in parallel
  const [nfResult, itensResult, eventosResult, arquivosResult] = await Promise.all([
    supabase
      .from('notas_fiscais')
      .select('*')
      .eq('pedido_id', id)
      .maybeSingle(),
    supabase
      .from('itens_producao')
      .select('*')
      .eq('pedido_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('eventos')
      .select('*')
      .eq('pedido_id', id)
      .order('created_at', { ascending: true }),
    // Get arquivos via lote
    supabase
      .from('itens_producao')
      .select('lote_id')
      .eq('pedido_id', id)
      .not('lote_id', 'is', null)
      .limit(1),
  ]);

  // Fetch lote and files if exists
  let lote = null;
  let expedicao = null;
  let arquivos: unknown[] = [];

  const loteId = arquivosResult.data?.[0]?.lote_id;
  if (loteId) {
    const [loteResult, filesResult, expResult] = await Promise.all([
      supabase
        .from('lotes_producao')
        .select('*')
        .eq('id', loteId)
        .single(),
      supabase
        .from('arquivos')
        .select('*')
        .eq('lote_id', loteId)
        .order('created_at', { ascending: true }),
      supabase
        .from('expedicoes')
        .select('*')
        .eq('lote_id', loteId)
        .limit(1)
        .maybeSingle(),
    ]);
    lote = loteResult.data;
    arquivos = filesResult.data ?? [];
    expedicao = expResult.data;
  }

  return NextResponse.json({
    pedido,
    nota_fiscal: nfResult.data ?? null,
    itens: itensResult.data ?? [],
    lote,
    expedicao,
    arquivos,
    eventos: eventosResult.data ?? [],
  });
}
