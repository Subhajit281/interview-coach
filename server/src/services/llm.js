import { ProviderError } from './http.js';

/** Provider router: Groq primary -> Groq fallback model -> Gemini (or Gemini first for heavy/long tasks). */
export function createLlm({ config, groq, gemini, log = console }) {
  const inflight = new Map();

  function chainFor(prefer) {
    const g = [];
    if (config.groq.apiKey) {
      g.push({ provider: 'groq', model: config.groq.llmModel });
      if (config.groq.llmFallbackModel && config.groq.llmFallbackModel !== config.groq.llmModel) {
        g.push({ provider: 'groq', model: config.groq.llmFallbackModel });
      }
    }
    const m = config.gemini.apiKey ? [{ provider: 'gemini', model: config.gemini.model }] : [];
    return prefer === 'gemini' ? [...m, ...g] : [...g, ...m];
  }

  async function run({ prefer = 'groq', ...req }) {
    const chain = chainFor(prefer);
    if (!chain.length) {
      throw new ProviderError('No LLM provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in .env.', 503);
    }
    const errors = [];
    for (const step of chain) {
      try {
        return await (step.provider === 'groq' ? groq : gemini).chat({ ...req, model: step.model });
      } catch (e) {
        errors.push(`${step.provider}/${step.model}: ${e.message}`);
        log.warn?.(`[llm] ${step.provider}/${step.model} failed, trying next: ${e.message}`);
      }
    }
    throw new ProviderError(`All LLM providers failed.\n${errors.join('\n')}`, 502);
  }

  function chat(req) {
    const key = req.dedupeKey;
    if (!key) return run(req);
    if (inflight.has(key)) return inflight.get(key);
    const p = run(req).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return { chat, chainFor };
}

export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
