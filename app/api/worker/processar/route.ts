import { NextRequest, NextResponse } from 'next/server';
import { processQueue, kickWorker } from '@/lib/worker';
import { logError } from '@/lib/logger';

export async function POST(request: NextRequest) {
  // Optional auth via WORKER_SECRET
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam === null ? 5 : Number(limitParam);

  try {
    if (limit === 0) {
      // Drain entire queue (singleton loop, non-blocking)
      kickWorker().catch((err) => {
        logError({
          source: 'worker',
          category: 'infrastructure',
          message: `kickWorker falhou: ${err instanceof Error ? err.message : 'Unknown'}`,
          error: err,
          request_path: '/api/worker/processar',
        });
      });
      return NextResponse.json({ status: 'draining' });
    }

    const result = await processQueue(Math.min(limit, 20));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logError({
      source: 'worker',
      category: 'infrastructure',
      message: `Worker processar falhou: ${message}`,
      error: err,
      request_path: '/api/worker/processar',
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET for easy health-check / cron trigger
export async function GET(request: NextRequest) {
  return POST(request);
}
