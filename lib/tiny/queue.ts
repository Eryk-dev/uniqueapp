/**
 * In-memory rate limiter for Tiny API requests.
 *
 * Tiny ERP limit: 60 requests per 60s.
 * We use 55 as budget to keep a 5-request buffer.
 *
 * Strategy:
 *   - Sliding window of 60s with max 55 requests
 *   - Min 1.1s between dispatches (spreads evenly)
 *   - Max 5 concurrent in-flight requests
 *   - 120s timeout per queued request
 */

const MAX_PER_MINUTE = 55;
const WINDOW_MS = 60_000;
const MIN_INTERVAL_MS = Math.ceil(WINDOW_MS / MAX_PER_MINUTE); // ~1091ms
const MAX_CONCURRENT = 5;
const MAX_QUEUE_WAIT_MS = 120_000;

interface QueueItem<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

class TinyRateLimiter {
  private timestamps: number[] = [];
  private active = 0;
  private lastDispatchTime = 0;
  private queue: QueueItem<unknown>[] = [];
  private drainScheduled = false;

  /** Enqueue a request to be executed within rate limits. */
  execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      });
      this.scheduleDrain();
    });
  }

  private scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    // Use queueMicrotask for immediate check, setTimeout for delays
    queueMicrotask(() => this.drain());
  }

  private drain() {
    this.drainScheduled = false;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Check for timed-out items
      const item = this.queue[0];
      if (now - item.enqueuedAt > MAX_QUEUE_WAIT_MS) {
        this.queue.shift();
        item.reject(new Error('Tiny API queue timeout (120s)'));
        continue;
      }

      // Concurrency limit
      if (this.active >= MAX_CONCURRENT) {
        break;
      }

      // Sliding window: remove old timestamps
      this.timestamps = this.timestamps.filter((t) => now - t < WINDOW_MS);

      // Window budget exhausted — wait for oldest to expire
      if (this.timestamps.length >= MAX_PER_MINUTE) {
        const waitMs = this.timestamps[0] + WINDOW_MS - now + 50;
        setTimeout(() => this.drain(), waitMs);
        this.drainScheduled = true;
        return;
      }

      // Min interval between dispatches
      const elapsed = now - this.lastDispatchTime;
      if (elapsed < MIN_INTERVAL_MS) {
        const waitMs = MIN_INTERVAL_MS - elapsed + 10;
        setTimeout(() => this.drain(), waitMs);
        this.drainScheduled = true;
        return;
      }

      // Dispatch
      const job = this.queue.shift()!;
      this.active++;
      this.lastDispatchTime = Date.now();
      this.timestamps.push(this.lastDispatchTime);

      job
        .execute()
        .then((result) => job.resolve(result))
        .catch((err) => job.reject(err))
        .finally(() => {
          this.active--;
          if (this.queue.length > 0) this.scheduleDrain();
        });
    }
  }

  /** Number of items waiting in queue. */
  get pending(): number {
    return this.queue.length;
  }

  /** Number of in-flight requests. */
  get inflight(): number {
    return this.active;
  }
}

// Singleton — one rate limiter for the single Tiny account
export const tinyQueue = new TinyRateLimiter();
