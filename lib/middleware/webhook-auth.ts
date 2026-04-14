import { NextRequest, NextResponse } from 'next/server';

export function validateWebhookSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return null; // No secret configured, skip validation

  const tokenParam = request.nextUrl.searchParams.get('token');
  const headerSecret = request.headers.get('X-Webhook-Secret');

  if (tokenParam === secret || headerSecret === secret) {
    return null; // Valid
  }

  return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
}
