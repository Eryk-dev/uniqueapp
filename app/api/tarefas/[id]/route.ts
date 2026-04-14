import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

const patchSchema = z.object({
  status: z.enum(['pendente', 'em_andamento', 'concluido']).optional(),
  notas: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 });
    }

    const supabase = createServerClient();
    const update: Record<string, unknown> = {};

    if (parsed.data.status) {
      update.status = parsed.data.status;
      if (parsed.data.status === 'concluido') {
        update.completed_at = new Date().toISOString();
      }
    }

    if (parsed.data.notas !== undefined) {
      update.notas = parsed.data.notas;
    }

    const { data, error } = await supabase
      .from('tarefas')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ tarefa: data });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
