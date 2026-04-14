import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const params = request.nextUrl.searchParams;
  const status = params.get('status');
  const linhaProduto = params.get('linha_produto');

  const supabase = createServerClient();

  let query = supabase
    .from('tarefas')
    .select('*, lotes_producao(linha_produto, total_itens, itens_sucesso, itens_erro)')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  let tarefas = data ?? [];

  // Filter by product line via lote join
  if (linhaProduto) {
    tarefas = tarefas.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.lotes_producao?.linha_produto === linhaProduto
    );
  }

  return NextResponse.json({ data: tarefas });
}
