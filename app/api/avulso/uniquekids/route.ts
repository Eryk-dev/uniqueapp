import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { createProductionBatch } from '@/lib/production/batch';

const schema = z.object({
  cliente: z.string().min(1),
  nome: z.string().min(1),
  molde: z.string().min(1),
  fonte: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 });
    }

    const { cliente, nome, molde, fonte } = parsed.data;
    const supabase = createServerClient();

    // Create avulso order
    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({
        tiny_pedido_id: Date.now(),
        numero: 0,
        data_pedido: new Date().toISOString().split('T')[0],
        nome_ecommerce: 'Avulso',
        linha_produto: 'uniquekids',
        status: 'pronto_producao',
        nome_cliente: cliente,
        is_avulso: true,
      })
      .select()
      .single();

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // Create production item
    await supabase.from('itens_producao').insert({
      pedido_id: pedido.id,
      modelo: 'UniqueKids Avulso',
      molde,
      fonte,
      personalizacao: nome,
      has_personalizacao: molde !== 'PD' && fonte !== 'TD',
    });

    // Trigger production
    const { loteId } = await createProductionBatch([pedido.id], authResult.id);

    await new Promise((r) => setTimeout(r, 500));

    const { data: arquivos } = await supabase
      .from('arquivos')
      .select('*')
      .eq('lote_id', loteId);

    return NextResponse.json({
      pedido_id: pedido.id,
      lote_id: loteId,
      arquivos: (arquivos ?? []).map((a) => ({
        tipo: a.tipo,
        url: `/api/arquivos/${a.id}/download`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
