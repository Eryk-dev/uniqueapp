import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { retryFailedItems } from '@/lib/production/batch';

const schema = z.object({
  lote_id: z.string().uuid(),
  item_ids: z.array(z.string().uuid()).min(1),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'lote_id e item_ids sao obrigatorios' },
        { status: 400 }
      );
    }

    await retryFailedItems(parsed.data.lote_id, parsed.data.item_ids);

    return NextResponse.json({ status: 'processando' }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
