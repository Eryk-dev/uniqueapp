/**
 * Tiny ERP OAuth2 via Keycloak.
 *
 * Authorization Code flow:
 *   1. Redirect user to TINY_AUTHORIZE_URL
 *   2. Callback receives code → exchange for tokens
 *   3. getValidToken() auto-refreshes when expired
 */

import { createServerClient } from '@/lib/supabase/server';

const TINY_AUTH_BASE =
  'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect';

export const TINY_AUTHORIZE_URL = `${TINY_AUTH_BASE}/auth`;
export const TINY_TOKEN_URL = `${TINY_AUTH_BASE}/token`;

// ─── Build authorization URL ────────────────────────────────────────────────

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(TINY_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', params.state);
  return url.toString();
}

// ─── Token exchange ─────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });

  const res = await fetch(TINY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ─── Refresh token ──────────────────────────────────────────────────────────

async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const res = await fetch(TINY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ─── Get valid token (auto-refresh) ─────────────────────────────────────────

/**
 * Returns a valid access_token from the active tiny_connections row.
 * Auto-refreshes if the token is expired (with 60s buffer).
 */
export async function getValidToken(): Promise<string> {
  const supabase = createServerClient();

  const { data: conn } = await supabase
    .from('tiny_connections')
    .select('id, client_id, client_secret, access_token, refresh_token, token_expires_at')
    .eq('ativo', true)
    .single();

  if (!conn) throw new Error('Nenhuma conexao Tiny ativa encontrada');
  if (!conn.access_token || !conn.refresh_token) {
    throw new Error('Conexao Tiny nao autorizada — complete o fluxo OAuth2 primeiro');
  }
  if (!conn.client_id || !conn.client_secret) {
    throw new Error('Client ID/Secret nao configurados');
  }

  // Check expiry with 60s buffer
  const expiresAt = conn.token_expires_at
    ? new Date(conn.token_expires_at).getTime()
    : 0;

  if (expiresAt > Date.now() + 60_000) {
    return conn.access_token;
  }

  // Token expired — refresh
  const tokens = await refreshAccessToken({
    refreshToken: conn.refresh_token,
    clientId: conn.client_id,
    clientSecret: conn.client_secret,
  });

  // Save new tokens
  await supabase
    .from('tiny_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  return tokens.access_token;
}
