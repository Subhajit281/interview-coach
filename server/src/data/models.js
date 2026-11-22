// Fallbacks used only when a provider's live model API cannot be queried (for
// example the local, unauthenticated development mode). Signed-in users receive
// a per-key list from the provider instead of this static catalogue.
export const MODEL_CATALOG = {
  groq: [
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Best all-round quality on Groq' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Fast, good reasoning, separate quota' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Best all-round quality on Gemini' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', note: 'Fastest, larger free allowance' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'Reliable, separate quota' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', note: 'Lightest, separate quota' },
  ],
};

export const PROVIDER_LABEL = { groq: 'Groq', gemini: 'Gemini' };
const RETIRED_GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct']);

const fail = (message, code, extra = {}) => Object.assign(new Error(message), { status: 400, code, publicMessage: message, ...extra });

/** Catalog for the UI. The server default is always included so the dropdown can show what is active. */
const lightest = {
  groq: ['openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
  gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'],
};

const rank = (provider, model) => {
  const id = model.id.toLowerCase();
  const known = lightest[provider].indexOf(id);
  if (known !== -1) return known;
  if (/flash-lite|\bmini\b|\bsmall\b|\b8b\b/.test(id)) return 10;
  if (/\bflash\b|\b20b\b/.test(id)) return 20;
  return 100;
};

const defaultFor = (provider, list, verified, fallback) => {
  if (verified?.[provider] && list.some((m) => m.id === verified[provider])) return verified[provider];
  // A live list without a verified model must not silently send an interview to
  // an ID that only appears in ListModels but cannot generate for this key.
  if (verified) return '';
  // Prefer a light, low-latency model even if an older environment variable
  // named a heavier one. This app makes many short conversational calls.
  return [...list].sort((a, b) => rank(provider, a) - rank(provider, b))[0]?.id || list.find((m) => m.id === fallback)?.id || '';
};

/** Builds UI/API model data. `available` is the current key's provider list. */
export function catalogFor(config, available = null, verified = null) {
  const fallback = { groq: config.groq.llmModel, gemini: config.gemini.model };
  const out = {};
  for (const p of Object.keys(MODEL_CATALOG)) {
    const source = available ? (Array.isArray(available[p]) ? available[p] : []) : MODEL_CATALOG[p];
    const selected = defaultFor(p, source, verified, fallback[p]);
    const list = [...source].sort((a, b) => rank(p, a) - rank(p, b) || a.label.localeCompare(b.label)).map((m) => ({ ...m, isDefault: m.id === selected }));
    out[p] = list;
  }
  return { catalog: out, defaults: Object.fromEntries(Object.keys(MODEL_CATALOG).map((p) => [p, defaultFor(p, out[p], verified, fallback[p])])) };
}

export function isAllowedModel(catalogData, provider, model) {
  const { catalog } = catalogData?.catalog ? catalogData : catalogFor(catalogData);
  return Boolean(catalog[provider]?.some((m) => m.id === model));
}

export function assertAllowedModel(catalogData, provider, model) {
  if (!catalog_has(provider)) throw fail('Unknown AI provider.', 'MODEL_INVALID');
  if (!isAllowedModel(catalogData, provider, model)) {
    throw fail('That model is not available in the list. Please choose one from the dropdown.', 'MODEL_INVALID', { provider, model });
  }
}
const catalog_has = (p) => Object.prototype.hasOwnProperty.call(MODEL_CATALOG, p);

/** Reads the X-Model-Prefs header ({"groq": "...", "gemini": "..."}). Unknown ids are rejected with a readable error. */
export function parseModelPrefs(catalogData, headerValue, { ignoreUnknown = false } = {}) {
  if (!headerValue) return {};
  let raw;
  try { raw = JSON.parse(String(headerValue)); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const p of Object.keys(MODEL_CATALOG)) {
    const m = typeof raw[p] === 'string' ? raw[p].trim() : '';
    if (!m) continue;
    // Browser preferences survive deployments. Silently fall back to the new
    // server default when that stored Groq model was retired.
    if (p === 'groq' && RETIRED_GROQ_MODELS.has(m)) continue;
    if (ignoreUnknown && !isAllowedModel(catalogData, p, m)) continue;
    assertAllowedModel(catalogData, p, m);
    out[p] = m;
  }
  return out;
}
