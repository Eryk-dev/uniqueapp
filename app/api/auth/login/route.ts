import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { signToken, setAuthCookie } from '@/lib/auth/jwt';
import type { Usuario } from '@/lib/types';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Username e password sao obrigatorios' },
        { status: 400 }
      );
    }

    const { username, password } = parsed.data;

    // Dev mode: allow login without Supabase when SUPABASE_SERVICE_ROLE_KEY is not set
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      if (username === 'admin' && password === 'admin') {
        const devUser = {
          id: 'a1000000-0000-0000-0000-000000000001',
          username: 'admin',
          nome: 'Eryk Admin',
          role: 'admin' as const,
        };
        const token = await signToken(devUser);
        await setAuthCookie(token);
        return NextResponse.json({ user: devUser });
      }
      return NextResponse.json(
        { error: 'Dev mode: use admin/admin' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    const { data: user, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('username', username)
      .eq('ativo', true)
      .single<Usuario>();

    if (error || !user) {
      return NextResponse.json(
        { error: 'Credenciais invalidas' },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Credenciais invalidas' },
        { status: 401 }
      );
    }

    const token = await signToken({
      id: user.id,
      username: user.username,
      nome: user.nome,
      role: user.role,
    });

    await setAuthCookie(token);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nome: user.nome,
        role: user.role,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Erro interno' },
      { status: 500 }
    );
  }
}
