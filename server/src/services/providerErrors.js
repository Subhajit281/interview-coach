import { ProviderError } from './http.js';
import { PROVIDER_LABEL } from '../data/models.js';

export const CODES = {
  LIMIT: 'MODEL_LIMIT',
  UNAVAILABLE: 'MODEL_UNAVAILABLE',
  AUTH: 'PROVIDER_AUTH',
  BUSY: 'PROVIDER_BUSY',
};

const DAILY = /per\s*day|perday|requests per day|tokens per day|\bTPD\b|\bRPD\b|daily/i;

/** Turns a raw provider failure into a coarse kind. Plain errors (no HTTP status) are 'other'. */
export function classify(e) {
  const status = Number(e?.status) || 0;
  const text = String(e?.message || '');
  if (status === 429) return { kind: 'limit', daily: DAILY.test(text) || (Number(e?.retryAfterMs) || 0) > 6000 };
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|invalid api key/i.test(text)) return { kind: 'auth' };
  if (status === 404 || (status === 400 && /model|not found|not supported|decommission/i.test(text))) return { kind: 'unavailable' };
  return { kind: 'other' };
}

const name = (provider) => PROVIDER_LABEL[provider] || provider;

/** A ProviderError that carries a safe, readable message plus the details the UI needs to open the model picker. */
export function modelError(kind, failures) {
  const list = failures.filter((f) => f.kind === kind);
  const first = list[0] || failures[0];
  const { provider, model } = first;
  const exhausted = list.map((f) => ({ provider: f.provider, model: f.model, daily: Boolean(f.daily) }));
  let code, status, message;
  if (kind === 'limit') {
    code = CODES.LIMIT; status = 429;
    message = first.daily
      ? `${name(provider)} model "${model}" has used up its free limit for today. Your progress is saved. Choose another model to continue.`
      : `${name(provider)} model "${model}" is receiving too many requests right now. Your progress is saved. Choose another model, or wait a minute and retry.`;
  } else if (kind === 'unavailable') {
    code = CODES.UNAVAILABLE; status = 502;
    message = `${name(provider)} model "${model}" is not available for your API key. Choose another model to continue.`;
  } else {
    code = CODES.AUTH; status = 502;
    message = `Your ${name(provider)} API key was rejected. Update it in Settings, then try again.`;
  }
  return new ProviderError(message, status, { code, publicMessage: message, provider, model, reason: first.daily ? 'daily' : kind, exhausted });
}

/** Converts any thrown provider error for a single known model into a friendly coded error. Unknown failures pass through. */
export function friendly(e, provider, model) {
  if (e?.publicMessage) return e;
  const c = classify(e);
  if (c.kind === 'other') return e;
  return modelError(c.kind, [{ provider, model, ...c }]);
}

/** Chooses what to tell the user after every model in the chain failed. Returns null if none of it was actionable. */
export function summarize(failures) {
  for (const kind of ['limit', 'unavailable', 'auth']) {
    if (failures.some((f) => f.kind === kind)) return modelError(kind, failures);
  }
  return null;
}
