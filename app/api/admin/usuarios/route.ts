import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

const createSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  nome: z.string().min(1),
  role: z.enum(['admin', 'operador', 'expedicao']),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1).optional(),
  role: z.enum(['admin', 'operador', 'expedicao']).optional(),
  ativo: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const roleCheck = requireRole(authResult, 'admin');
  if (roleCheck) return roleCheck;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, username, nome, role, ativo, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const roleCheck = requireRole(authResult, 'admin');
  if (roleCheck) return roleCheck;

  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 });
    }

    const { username, password, nome, role } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 10);

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('usuarios')
      .insert({ username, password_hash: passwordHash, nome, role })
      .select('id, username, nome, role, ativo, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Username ja existe' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({ user: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const roleCheck = requireRole(authResult, 'admin');
  if (roleCheck) return roleCheck;

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados invalidos' }, { status: 400 });
    }

    const { id, password, ...rest } = parsed.data;
    const update: Record<string, unknown> = { ...rest };

    if (password) {
      update.password_hash = await bcrypt.hash(password, 10);
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('usuarios')
      .update(update)
      .eq('id', id)
      .select('id, username, nome, role, ativo, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    return NextResponse.json({ user: data });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
