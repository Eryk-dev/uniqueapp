import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens } from '@/lib/tiny/oauth';
import { testConnection } from '@/lib/tiny/client';

/**
 * GET /api/tiny/oauth/callback?code=xxx&state=xxx
 *
 * OAuth2 callback — exchanges authorization code for tokens.
 * Redirects back to /admin/tiny with status.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const origin = `${proto}://${host}`;
  const adminUrl = new URL('/admin/tiny', origin);

  if (error) {
    adminUrl.searchParams.set('oauth_error', error);
    return NextResponse.redirect(adminUrl);
  }

  if (!code || !state) {
    adminUrl.searchParams.set('oauth_error', 'missing_params');
    return NextResponse.redirect(adminUrl);
  }

  const connectionId = state.split(':')[0];
  if (!connectionId) {
    adminUrl.searchParams.set('oauth_error', 'invalid_state');
    return NextResponse.redirect(adminUrl);
  }

  const supabase = createServerClient();

  // Validate CSRF state
  const { data: conn } = await supabase
    .from('tiny_connections')
    .select('id, client_id, client_secret, oauth_state')
    .eq('id', connectionId)
    .single();

  if (!conn || conn.oauth_state !== state) {
    adminUrl.searchParams.set('oauth_error', 'state_mismatch');
    return NextResponse.redirect(adminUrl);
  }

  try {
    const redirectUri = `${origin}/api/tiny/oauth/callback`;
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: conn.client_id,
      clientSecret: conn.client_secret,
      redirectUri,
    });

    // Test the new token
    const testResult = await testConnection(tokens.access_token);

    // Save tokens
    await supabase
      .from('tiny_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        oauth_state: null,
        ultimo_teste_em: new Date().toISOString(),
        ultimo_teste_ok: testResult.ok,
        nome: testResult.nome ?? 'Unique',
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);

    adminUrl.searchParams.set('oauth_success', 'true');
    return NextResponse.redirect(adminUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    adminUrl.searchParams.set('oauth_error', msg);
    return NextResponse.redirect(adminUrl);
  }
}
