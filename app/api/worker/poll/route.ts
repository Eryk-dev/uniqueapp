import { NextRequest, NextResponse } from 'next/server';
import { runPollCycle } from '@/lib/tiny/poller';
import { logError } from '@/lib/logger';

/**
 * Trigger manual do polling fallback do Tiny (pedidos aprovados + NFs
 * autorizadas). O ciclo também roda sozinho via instrumentation.ts —
 * este endpoint serve pra teste e pra cron externo, espelhando
 * /api/worker/processar.
 */
export async function POST(request: NextRequest) {
  // Optional auth via WORKER_SECRET
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const stats = await runPollCycle();
    if (!stats) {
      return NextResponse.json({ status: 'ciclo ja em andamento' }, { status: 409 });
    }
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logError({
      source: 'poller',
      category: 'infrastructure',
      message: `Poll manual falhou: ${message}`,
      error: err,
      request_path: '/api/worker/poll',
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET for easy health-check / cron trigger
export async function GET(request: NextRequest) {
  return POST(request);
}
