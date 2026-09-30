/**
 * Retries with exponential backoff, and a small concurrency limiter. Both are
 * plain functions with the clock passed in, so tests run without waiting.
 */

export interface RetryOptions {
  /** How many times to try again after the first failure. Defaults to 3. */
  maxRetries?: number;
  /** First wait in milliseconds; doubles each time. Defaults to 1000. */
  baseDelayMs?: number;
  /** The longest single wait. Defaults to 30000. */
  maxDelayMs?: number;
  /** True for an error worth trying again. */
  isRetryable: (error: unknown) => boolean;
  /** A wait the server asked for (a `retry-after` header), in milliseconds. */
  retryAfterMs?: (error: unknown) => number | undefined;
  sleep?: (ms: number) => Promise<void>;
  /** Between 0 and 1; spreads the waits so parallel requests do not retry together. */
  random?: () => number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  // Half fixed, half random: never less than half the step, never more than the step.
  return Math.round(exponential / 2 + (exponential / 2) * random);
}

export async function withRetry<T>(run: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= maxRetries || options.signal?.aborted || !options.isRetryable(error)) throw error;
      const asked = options.retryAfterMs?.(error);
      const delayMs =
        asked !== undefined && asked >= 0 ? Math.min(asked, 60_000) : backoffDelay(attempt, baseDelayMs, maxDelayMs, random());
      options.onRetry?.({ attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }
}

/** Run at most `concurrency` tasks at once. */
export function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    active--;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
