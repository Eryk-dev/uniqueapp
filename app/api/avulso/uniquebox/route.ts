import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { createProductionBatch } from '@/lib/production/batch';

const schema = z.object({
  cliente: z.string().min(1),
  linha1: z.string().optional().default(''),
  linha2: z.string().optional().default(''),
  linha3: z.string().optional().default(''),
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

    const { cliente, linha1, linha2, linha3 } = parsed.data;
    const personalizacao = [linha1, linha2, linha3].filter(Boolean).join('\n');

    const supabase = createServerClient();

    // Create avulso order
    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({
        tiny_pedido_id: Date.now(), // Unique placeholder
        numero: 0,
        data_pedido: new Date().toISOString().split('T')[0],
        nome_ecommerce: 'Avulso',
        linha_produto: 'uniquebox',
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
      modelo: 'UniqueBox Avulso',
      personalizacao,
      has_personalizacao: !!personalizacao,
    });

    // Trigger production
    const { loteId } = await createProductionBatch([pedido.id], authResult.id);

    // Wait briefly for files to be generated, then fetch
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
