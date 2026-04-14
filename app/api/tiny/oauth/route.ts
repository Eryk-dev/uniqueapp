import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl } from '@/lib/tiny/oauth';
import { requireAuth, requireRole } from '@/lib/auth/middleware';

/**
 * GET /api/tiny/oauth?connectionId=xxx
 *
 * Starts OAuth2 Authorization Code flow.
 * Redirects the user to Tiny's Keycloak authorization page.
 */
export async function GET(request: NextRequest) {
  const userOrError = await requireAuth(request);
  if (userOrError instanceof NextResponse) return userOrError;
  const roleError = requireRole(userOrError, 'admin');
  if (roleError) return roleError;

  const connectionId = request.nextUrl.searchParams.get('connectionId');
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: conn } = await supabase
    .from('tiny_connections')
    .select('id, client_id, client_secret')
    .eq('id', connectionId)
    .single();

  if (!conn) {
    return NextResponse.json({ error: 'Conexao nao encontrada' }, { status: 404 });
  }

  if (!conn.client_id || !conn.client_secret) {
    return NextResponse.json(
      { error: 'Configure Client ID e Client Secret primeiro' },
      { status: 400 }
    );
  }

  // Generate CSRF state
  const state = `${connectionId}:${crypto.randomUUID()}`;

  await supabase
    .from('tiny_connections')
    .update({ oauth_state: state })
    .eq('id', connectionId);

  // Build redirect URL
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const origin = `${proto}://${host}`;
  const redirectUri = `${origin}/api/tiny/oauth/callback`;

  const authorizeUrl = buildAuthorizeUrl({
    clientId: conn.client_id,
    redirectUri,
    state,
  });

  return NextResponse.redirect(authorizeUrl);
}
