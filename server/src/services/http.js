export class ProviderError extends Error {
  constructor(message, status = 0, extra = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseRetryAfter(v) {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isNaN(n)) return Math.round(n * 1000);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}

/**
 * fetch with retries for network errors, 429 and 5xx.
 * If the server asks us to wait longer than maxWaitMs (e.g. a daily quota),
 * we throw immediately so the caller can fall back to another provider.
 */
export async function fetchWithRetry(url, init, opts = {}) {
  const {
    retries = 2,
    baseMs = 400,
    maxWaitMs = 6000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    label = 'request',
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const backoff = baseMs * 2 ** attempt + Math.floor(Math.random() * 100);
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      lastErr = new ProviderError(`${label}: network error (${e.message})`, 0);
      if (attempt === retries) throw lastErr;
      await sleep(backoff);
      continue;
    }
    if (res.ok) return res;

    const body = await res.text().catch(() => '');
    const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    lastErr = new ProviderError(`${label}: HTTP ${res.status} ${body.slice(0, 300)}`, res.status, { retryAfterMs });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === retries) throw lastErr;
    if (retryAfterMs != null && retryAfterMs > maxWaitMs) throw lastErr;
    await sleep(retryAfterMs ?? backoff);
  }
  throw lastErr;
}
