import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './jwt';
import type { AuthUser, UserRole } from '@/lib/types';

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  return {
    id: payload.sub,
    username: payload.username,
    nome: payload.username,
    role: payload.role as UserRole,
  };
}

export async function requireAuth(request: NextRequest): Promise<AuthUser | NextResponse> {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  }
  return user;
}

export function requireRole(user: AuthUser, ...roles: string[]): NextResponse | null {
  if (!roles.includes(user.role)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  return null;
}
