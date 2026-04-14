import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';

/**
 * GET /api/tiny/connections — list connections (admin only)
 */
export async function GET(request: NextRequest) {
  const userOrError = await requireAuth(request);
  if (userOrError instanceof NextResponse) return userOrError;
  const roleError = requireRole(userOrError, 'admin');
  if (roleError) return roleError;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('tiny_connections')
    .select('id, nome, client_id, ativo, ultimo_teste_em, ultimo_teste_ok, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

/**
 * POST /api/tiny/connections — create or update connection (admin only)
 * Body: { id?: string, client_id: string, client_secret: string }
 */
export async function POST(request: NextRequest) {
  const userOrError = await requireAuth(request);
  if (userOrError instanceof NextResponse) return userOrError;
  const roleError = requireRole(userOrError, 'admin');
  if (roleError) return roleError;

  const body = await request.json();
  const { id, client_id, client_secret } = body;

  if (!client_id || !client_secret) {
    return NextResponse.json({ error: 'client_id e client_secret obrigatorios' }, { status: 400 });
  }

  const supabase = createServerClient();

  if (id) {
    const { data, error } = await supabase
      .from('tiny_connections')
      .update({ client_id, client_secret, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, nome, client_id, ativo')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Create new — deactivate others first
  await supabase
    .from('tiny_connections')
    .update({ ativo: false })
    .eq('ativo', true);

  const { data, error } = await supabase
    .from('tiny_connections')
    .insert({ client_id, client_secret, ativo: true })
    .select('id, nome, client_id, ativo')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
