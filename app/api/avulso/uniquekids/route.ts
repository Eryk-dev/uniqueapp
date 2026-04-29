import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { createProductionBatch } from '@/lib/production/batch';

const schema = z.object({
  molde: z.string().min(1),
  fonte: z.string().min(1),
  nomes: z
    .array(
      z.object({
        cliente: z.string().min(1),
        nome: z.string().min(1),
      })
    )
    .min(1)
    .max(60),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados invalidos', detalhes: parsed.error.format() },
        { status: 400 }
      );
    }

    const { molde, fonte, nomes } = parsed.data;
    const supabase = createServerClient();
    const pedidoIds: string[] = [];

    for (const entry of nomes) {
      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos')
        .insert({
          tiny_pedido_id: Date.now() + Math.floor(Math.random() * 1_000_000),
          numero: 0,
          data_pedido: new Date().toISOString().split('T')[0],
          nome_ecommerce: 'Avulso',
          linha_produto: 'uniquekids',
          status: 'pronto_producao',
          nome_cliente: entry.cliente,
          is_avulso: true,
        })
        .select()
        .single();

      if (pedidoError || !pedido) {
        return NextResponse.json(
          { error: pedidoError?.message ?? 'Falha ao criar pedido' },
          { status: 500 }
        );
      }

      await supabase.from('itens_producao').insert({
        pedido_id: pedido.id,
        modelo: 'UniqueKids Avulso',
        molde,
        fonte,
        personalizacao: entry.nome,
        has_personalizacao: molde !== 'PD' && fonte !== 'TD',
      });

      pedidoIds.push(pedido.id);
    }

    const { loteId } = await createProductionBatch(pedidoIds, authResult.id);

    await supabase.from('expedicoes').insert({
      lote_id: loteId,
      forma_frete: 'Avulso',
      nf_ids: [],
      status: 'pendente',
    });

    await new Promise((r) => setTimeout(r, 800));

    const { data: arquivos } = await supabase
      .from('arquivos')
      .select('id, tipo, nome_arquivo')
      .eq('lote_id', loteId);

    return NextResponse.json({
      lote_id: loteId,
      total_pedidos: pedidoIds.length,
      arquivos: (arquivos ?? []).map((a) => ({
        id: a.id,
        tipo: a.tipo,
        nome: a.nome_arquivo,
        url: `/api/arquivos/${a.id}/download`,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
