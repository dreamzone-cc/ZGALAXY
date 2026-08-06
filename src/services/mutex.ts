/**
 * Minimal async mutex (single-flight). Serializes multi-step read-modify-write
 * operations (e.g. the moon.json -> genmoon -> mkmoonworld -> dist pipeline)
 * across concurrent callers, preventing lost updates and overlapping CLI runs.
 */
export class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
}

/**
 * Shared build/migrate mutex: every operation that reads-and-writes moon.json
 * and runs the ZeroTier CLI tooling must go through this so concurrent builds
 * (DDNS worker, Cloudflare worker, HTTP routes) never race each other.
 */
export const buildMutex = new AsyncMutex();
