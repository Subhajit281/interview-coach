export const BACKEND_WAKE_TIMEOUT_MS = 50_000;
export const BACKEND_WAKE_INTERVAL_MS = 5_000;
export const BACKEND_WAKE_REQUEST_TIMEOUT_MS = 8_000;
export const INTERVIEW_START_TIMEOUT_MS = 90_000;

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Aborted', 'AbortError')); }
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
});

export function isAbort(error) {
  return error?.name === 'AbortError' || /aborted|timed out/i.test(String(error?.message || ''));
}

export function isTemporaryStartError(error) {
  const status = Number(error?.status) || 0;
  // Credential/model errors are already actionable; a Render/network/provider outage is not.
  if (['PROVIDER_AUTH', 'MODEL_INVALID', 'MODEL_UNAVAILABLE'].includes(error?.code)) return false;
  return !status || status === 408 || status === 409 || status === 429 || status >= 500;
}

function requestSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'AbortError')), timeoutMs);
  const abort = () => controller.abort(parent.reason || new DOMException('Aborted', 'AbortError'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    clear: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort); },
  };
}

/** Poll a public liveness endpoint without allowing any single proxy request to hang forever. */
export async function waitForBackend(health, { signal, timeoutMs = BACKEND_WAKE_TIMEOUT_MS, intervalMs = BACKEND_WAKE_INTERVAL_MS, requestTimeoutMs = BACKEND_WAKE_REQUEST_TIMEOUT_MS, onAttempt } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    onAttempt?.(Date.now() - started);
    const remaining = timeoutMs - (Date.now() - started);
    const request = requestSignal(signal, Math.max(1, Math.min(requestTimeoutMs, remaining)));
    try {
      await health({ signal: request.signal });
      request.clear();
      return { ok: true, elapsedMs: Date.now() - started };
    } catch (error) {
      request.clear();
      if (signal?.aborted) throw signal.reason || error;
      lastError = error;
    }
    const pause = Math.min(intervalMs, timeoutMs - (Date.now() - started));
    if (pause > 0) await sleep(pause, signal);
  }
  return { ok: false, elapsedMs: Date.now() - started, error: lastError };
}

export function createStartKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
