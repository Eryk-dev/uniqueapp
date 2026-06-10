/**
 * Next.js instrumentation hook — roda uma vez no boot do servidor.
 * Inicia o polling fallback do Tiny (lib/tiny/poller.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTinyPolling } = await import('@/lib/tiny/poller');
    startTinyPolling();
  }
}
