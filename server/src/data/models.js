// Free-tier chat models that suit the interview simulation (JSON replies, low latency, solid reasoning).
// Edit this list to add or retire models. Users can only pick from here, so a typo can never reach a provider.
// Free-tier limits change often: trust each provider's console for exact numbers.
export const MODEL_CATALOG = {
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', note: 'Best all-round quality on Groq' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Strong reasoning, own daily quota' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Fast, good reasoning, own daily quota' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', note: 'Fast, separate daily quota' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', note: 'Fastest and lightest, larger daily allowance' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Best all-round quality on Gemini' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', note: 'Fastest, larger free allowance' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'Reliable, separate quota' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', note: 'Lightest, separate quota' },
  ],
};

export const PROVIDER_LABEL = { groq: 'Groq', gemini: 'Gemini' };

const fail = (message, code, extra = {}) => Object.assign(new Error(message), { status: 400, code, publicMessage: message, ...extra });

/** Catalog for the UI. The server default is always included so the dropdown can show what is active. */
export function catalogFor(config) {
  const defaults = { groq: config.groq.llmModel, gemini: config.gemini.model };
  const out = {};
  for (const p of Object.keys(MODEL_CATALOG)) {
    const list = MODEL_CATALOG[p].map((m) => ({ ...m, isDefault: m.id === defaults[p] }));
    if (defaults[p] && !list.some((m) => m.id === defaults[p])) {
      list.unshift({ id: defaults[p], label: defaults[p], note: 'Server default', isDefault: true });
    }
    out[p] = list;
  }
  return { catalog: out, defaults };
}

export function isAllowedModel(config, provider, model) {
  const { catalog } = catalogFor(config);
  return Boolean(catalog[provider]?.some((m) => m.id === model));
}

export function assertAllowedModel(config, provider, model) {
  if (!catalog_has(provider)) throw fail('Unknown AI provider.', 'MODEL_INVALID');
  if (!isAllowedModel(config, provider, model)) {
    throw fail('That model is not available in the list. Please choose one from the dropdown.', 'MODEL_INVALID', { provider, model });
  }
}
const catalog_has = (p) => Object.prototype.hasOwnProperty.call(MODEL_CATALOG, p);

/** Reads the X-Model-Prefs header ({"groq": "...", "gemini": "..."}). Unknown ids are rejected with a readable error. */
export function parseModelPrefs(config, headerValue) {
  if (!headerValue) return {};
  let raw;
  try { raw = JSON.parse(String(headerValue)); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const p of Object.keys(MODEL_CATALOG)) {
    const m = typeof raw[p] === 'string' ? raw[p].trim() : '';
    if (!m) continue;
    assertAllowedModel(config, p, m);
    out[p] = m;
  }
  return out;
}
