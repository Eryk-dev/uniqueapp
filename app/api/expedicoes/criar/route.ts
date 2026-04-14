import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createExpeditionForGroup } from '@/lib/tiny/expedition';
import { createServerClient } from '@/lib/supabase/server';

const schema = z.object({
  forma_frete: z.string().min(1),
  pedido_ids: z.array(z.string().uuid()).min(1),
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

    const { forma_frete, pedido_ids } = parsed.data;
    const supabase = createServerClient();

    // Fetch produzido orders with their production items
    const { data: pedidos, error } = await supabase
      .from('pedidos')
      .select('id, tiny_pedido_id, id_forma_frete, id_transportador, itens_producao(lote_id)')
      .in('id', pedido_ids)
      .eq('status', 'produzido');

    if (error || !pedidos?.length) {
      return NextResponse.json(
        { error: 'Nenhum pedido produzido encontrado' },
        { status: 400 }
      );
    }

    // Derive lote_id from items
    const loteId = pedidos
      .flatMap((p) => (p.itens_producao ?? []).map((i: { lote_id: string | null }) => i.lote_id))
      .find(Boolean);

    if (!loteId) {
      return NextResponse.json(
        { error: 'Pedidos sem lote de producao vinculado' },
        { status: 400 }
      );
    }

    // Collect NF IDs from orders' tiny_pedido_id
    const nfIds = pedidos
      .map((p) => p.tiny_pedido_id)
      .filter((id): id is number => id != null);

    if (nfIds.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma NF encontrada nos pedidos' },
        { status: 400 }
      );
    }

    // Get freight config from first order
    const idFormaFrete = pedidos[0].id_forma_frete ?? null;
    const idTransportador = pedidos[0].id_transportador ?? null;

    const { expedicaoId, tinyExpedicaoId } = await createExpeditionForGroup(
      loteId,
      forma_frete,
      nfIds,
      idFormaFrete,
      idTransportador
    );

    return NextResponse.json({
      expedicao_id: expedicaoId,
      tiny_expedicao_id: tinyExpedicaoId,
      nf_count: nfIds.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
