import { cookies } from 'next/headers';
import type { AuthUser, UserRole } from '@/lib/types';

const COOKIE_NAME = 'auth_token';
const MAX_AGE = 60 * 60 * 24; // 24h

function encode(user: AuthUser): string {
  return Buffer.from(JSON.stringify({ sub: user.id, username: user.username, role: user.role })).toString('base64');
}

function decode(token: string): { sub: string; username: string; role: string } | null {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function signToken(user: AuthUser): Promise<string> {
  return encode(user);
}

export async function verifyToken(token: string) {
  return decode(token);
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function getAuthCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  const payload = decode(token);
  if (!payload) return null;
  return { id: payload.sub, username: payload.username, nome: payload.username, role: payload.role as UserRole };
}
