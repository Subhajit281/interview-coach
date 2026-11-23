import { ProviderError } from './http.js';
import { classify, summarize } from './providerErrors.js';

/** Provider router: Groq primary -> Groq fallback model -> Gemini (or Gemini first for heavy/long tasks). */
export function createLlm({ config, groq, gemini, log = console }) {
  const inflight = new Map();

  function chainFor(prefer, credentials = null) {
    const g = [];
    const allowServerKeys = config.allowDevelopmentProviderKeys ?? true;
    const groqKey = credentials?.groqKey || (allowServerKeys ? config.groq.apiKey : '');
    const geminiKey = credentials?.geminiKey || (allowServerKeys ? config.gemini.apiKey : '');
    // A model the user picked (X-Model-Prefs) replaces the env default for that provider.
    const models = credentials?.models || {};
    if (groqKey) {
      const primary = models.groq || config.groq.llmModel;
      g.push({ provider: 'groq', model: primary, apiKey: groqKey });
      // The built-in same-provider fallback only applies when the user has not chosen a model themselves.
      if (!models.groq && config.groq.llmFallbackModel && config.groq.llmFallbackModel !== primary) {
        g.push({ provider: 'groq', model: config.groq.llmFallbackModel, apiKey: groqKey, secondary: true });
      }
    }
    const m = geminiKey ? [{ provider: 'gemini', model: models.gemini || config.gemini.model, apiKey: geminiKey }] : [];
    return prefer === 'gemini' ? [...m, ...g] : [...g, ...m];
  }

  async function run({ prefer = 'groq', hedgeMs = 0, ...req }) {
    const chain = chainFor(prefer, req.credentials);
    if (!chain.length) {
      throw new ProviderError('No LLM provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in .env.', 503);
    }
    const errors = [];
    const failures = [];
    const limited = new Set();
    const primaryModel = chain[0].model;
    const record = (step, e) => {
      const c = classify(e);
      if (c.kind === 'limit') limited.add(step.provider);
      failures.push({ provider: step.provider, model: step.model, ...c });
      errors.push(`${step.provider}/${step.model}: ${e.message}`);
      log.warn?.(`[llm] ${step.provider}/${step.model} failed, trying next: ${e.message}`);
    };
    const finalError = () => summarize(failures) || new ProviderError(`All LLM providers failed.\n${errors.join('\n')}`, 502);

    // Hedged mode (live voice turns): if the current model has not answered after hedgeMs, ask the next model
    // in parallel and use whichever replies first. A slow model no longer costs 20-30 s of dead air.
    if (hedgeMs > 0 && chain.length > 1) {
      return new Promise((resolve, reject) => {
        let next = 0, pending = 0, settled = false, timer = null;
        const controllers = new Set();
        const finish = (fn, v) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          controllers.forEach((c) => c.abort(new DOMException('Superseded', 'AbortError')));
          fn(v);
        };
        const armHedge = () => { clearTimeout(timer); if (next < chain.length) timer = setTimeout(() => { if (!settled) launch(); }, hedgeMs); };
        const launch = () => {
          while (next < chain.length) {
            const step = chain[next++];
            if (step.secondary && limited.has(step.provider)) continue;
            const ctrl = new AbortController();
            controllers.add(ctrl);
            if (req.signal) { if (req.signal.aborted) ctrl.abort(req.signal.reason); else req.signal.addEventListener('abort', () => ctrl.abort(req.signal.reason), { once: true }); }
            pending++;
            (step.provider === 'groq' ? groq : gemini).chat({ ...req, model: step.model, apiKey: step.apiKey, signal: ctrl.signal }).then(
              (r) => finish(resolve, { ...r, primaryModel }),
              (e) => {
                pending--;
                if (settled) return;
                if (req.signal?.aborted) { finish(reject, e); return; }
                record(step, e);
                if (!launch() && pending === 0) finish(reject, finalError());
              },
            );
            armHedge();
            return true;
          }
          return false;
        };
        if (!launch()) reject(finalError());
      });
    }

    for (const step of chain) {
      // When a provider's daily quota is gone, its backup model is skipped so the user gets to choose instead.
      if (step.secondary && limited.has(step.provider)) continue;
      try {
        return { ...(await (step.provider === 'groq' ? groq : gemini).chat({ ...req, model: step.model, apiKey: step.apiKey })), primaryModel };
      } catch (e) {
        // An interview-start deadline or a disconnected browser must stop the
        // whole provider chain; falling through would keep a dead request alive.
        if (req.signal?.aborted) throw e;
        const c = classify(e);
        if (c.kind === 'limit') limited.add(step.provider);
        failures.push({ provider: step.provider, model: step.model, ...c });
        errors.push(`${step.provider}/${step.model}: ${e.message}`);
        log.warn?.(`[llm] ${step.provider}/${step.model} failed, trying next: ${e.message}`);
      }
    }
    // Actionable problems (limit, unavailable model, bad key) become readable errors the UI can act on.
    throw summarize(failures) || new ProviderError(`All LLM providers failed.\n${errors.join('\n')}`, 502);
  }

  function chat(req) {
    const key = req.dedupeKey;
    if (!key) return run(req);
    if (inflight.has(key)) return inflight.get(key);
    const p = run(req).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /** One tiny call used to confirm a chosen model works for the user's key before it is mounted. */
  async function probe({ provider, model, apiKey }) {
    return (provider === 'groq' ? groq : gemini).chat({
      model, apiKey, system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, temperature: 0,
    });
  }

  return { chat, chainFor, probe };
}

export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
