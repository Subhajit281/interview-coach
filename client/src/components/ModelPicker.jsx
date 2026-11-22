import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, modelPrefs, MODEL_PROBLEM_CODES } from '../lib/api.js';
import { Button, Card, Field, inputCls } from './ui.jsx';

const PROVIDER_NAME = { groq: 'Groq', gemini: 'Gemini' };
const selectCls = `${inputCls} [color-scheme:dark] cursor-pointer`;

/** Loads the dropdown lists (and which providers have a key) once, shared by the popup and Settings. */
function useCatalog(enabled) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const load = useCallback(() => {
    setLoadErr('');
    api.models().then(setData).catch((e) => setLoadErr(e.message));
  }, []);
  useEffect(() => { if (enabled && !data) load(); }, [enabled, data, load]);
  return { data, loadErr, reload: load };
}

const activeModel = (data, provider) => {
  const saved = modelPrefs.get()[provider];
  return data?.catalog?.[provider]?.some((m) => m.id === saved) ? saved : data?.defaults?.[provider] || '';
};

function optionText(m, provider, active, out) {
  const tags = [];
  if (m.id === active) tags.push('current');
  if (out.has(`${provider}/${m.id}`)) tags.push('limit reached today');
  return `${m.label}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}

/** Validates a chosen model against the user's own key before it is mounted. Returns an error message or ''. */
async function mount(provider, model) {
  try {
    await api.checkModel(provider, model);
    modelPrefs.set({ ...modelPrefs.get(), [provider]: model });
    return '';
  } catch (e) {
    if (e.code === 'MODEL_LIMIT') modelPrefs.markExhausted(e.exhausted?.length ? e.exhausted : [{ provider, model, daily: true }]);
    return e.message;
  }
}

const Ctx = createContext(null);
export const useModelGate = () => useContext(Ctx);

/**
 * Wrap any call in guard(fn). If the provider reports a model problem (daily limit, model unavailable) the
 * "change model" popup opens, the caller waits, and fn is retried as soon as a working model is mounted.
 * If the user closes the popup instead, the original error is thrown with modelDeclined = true.
 */
export function ModelGateProvider({ children }) {
  const [modal, setModal] = useState(null);
  const modalRef = useRef(null);

  const ask = useCallback((error) => new Promise((resolve) => {
    modalRef.current?.resolve(false);
    modalRef.current = { error, resolve };
    setModal({ error });
  }), []);

  const finish = (ok) => {
    const m = modalRef.current;
    modalRef.current = null;
    setModal(null);
    m?.resolve(ok);
  };

  const guard = useCallback(async (fn, { onWait, onResume } = {}) => {
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (!MODEL_PROBLEM_CODES.includes(e?.code)) throw e;
        if (e.code === 'MODEL_LIMIT') modelPrefs.markExhausted(e.exhausted?.length ? e.exhausted : [{ provider: e.provider, model: e.model, daily: e.reason === 'daily' }]);
        onWait?.(e);
        const ok = await ask(e);
        if (!ok) { e.modelDeclined = true; throw e; }
        onResume?.();
      }
    }
  }, [ask]);

  return (
    <Ctx.Provider value={{ guard, ask }}>
      {children}
      {modal && <ChangeModelModal error={modal.error} onDone={finish} />}
    </Ctx.Provider>
  );
}

function ChangeModelModal({ error, onDone }) {
  const { data, loadErr, reload } = useCatalog(true);
  const [provider, setProvider] = useState(error.provider || 'groq');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const out = new Set(modelPrefs.exhausted());

  const configured = data ? ['groq', 'gemini'].filter((p) => data.providers?.[`${p}Configured`]) : [];

  // Pick a sensible starting model: the first one on the list that is not the one that just failed.
  useEffect(() => {
    if (!data) return;
    const usable = configured.length ? configured : ['groq', 'gemini'];
    const p = usable.includes(provider) ? provider : usable[0];
    if (p !== provider) { setProvider(p); return; }
    const list = data.catalog[p] || [];
    const failed = new Set([`${error.provider}/${error.model}`, ...(error.exhausted || []).map((x) => `${x.provider}/${x.model}`)]);
    const pick = list.find((m) => !failed.has(`${p}/${m.id}`) && !out.has(`${p}/${m.id}`)) || list.find((m) => !failed.has(`${p}/${m.id}`)) || list[0];
    setModel(pick?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, provider]);

  const list = data?.catalog?.[provider] || [];
  const active = activeModel(data, provider);
  const title = error.code === 'MODEL_LIMIT' ? 'Model limit reached' : error.code === 'MODEL_INVALID' ? 'Choose a model' : 'Model not available';

  const use = async () => {
    if (!model) return;
    setBusy(true);
    setMsg('');
    // Provider model lists can briefly contain IDs that are not enabled for a
    // particular key. Try the selected model first, then the live alternatives
    // automatically, rather than making the user click through repeated 404s.
    const candidates = [model, ...list.map((m) => m.id).filter((id) => id !== model && !out.has(`${provider}/${id}`))];
    let problem = '';
    for (const candidate of candidates) {
      problem = await mount(provider, candidate);
      if (!problem) { setModel(candidate); break; }
    }
    setBusy(false);
    if (problem) { setMsg(problem); return; }
    onDone(true);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="model-modal-title">
      <div className="w-full max-w-md rounded-lg border border-red-900/60 bg-[#090f0c] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.85)] space-y-4">
        <div>
          <h3 id="model-modal-title" className="text-sm font-semibold tracking-tight text-red-300">{title}</h3>
          <p className="mt-2 rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs leading-relaxed text-red-200">{error.message}</p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-400">
            Your interview is paused and nothing is lost. Pick a model below and it will continue right where you left off.
          </p>
        </div>

        {!data && !loadErr && <div className="text-xs text-neutral-400">Loading available models…</div>}
        {loadErr && (
          <div className="flex items-center justify-between gap-2 rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
            <span>{loadErr}</span>
            <Button variant="default" className="text-xs" onClick={reload}>Retry</Button>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            {configured.length > 1 && (
              <div className="flex gap-1.5">
                {configured.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => { setProvider(p); setMsg(''); }}
                    className={`flex-1 rounded-[6px] border px-3 py-1.5 text-xs font-medium transition-all ${provider === p ? 'border-emerald-500/50 bg-[#0e1711] text-emerald-300' : 'border-[#1c2d22] text-neutral-400 hover:bg-[#0c140f] hover:text-neutral-200'}`}
                  >
                    {PROVIDER_NAME[p]}
                  </button>
                ))}
              </div>
            )}
            {configured.length === 0 && (
              <div className="rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
                No API key is connected yet. Add a Groq or Gemini key in Settings first.
              </div>
            )}
            {data.modelErrors?.[provider] && (
              <div className="rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
                {data.modelErrors[provider]}
              </div>
            )}
            <Field label={`${PROVIDER_NAME[provider]} model`} hint={list.find((m) => m.id === model)?.note}>
              <select className={selectCls} value={model} onChange={(e) => { setModel(e.target.value); setMsg(''); }} disabled={busy}>
                {list.map((m) => <option key={m.id} value={m.id}>{optionText(m, provider, active, out)}</option>)}
              </select>
            </Field>
          </div>
        )}

        {msg && <div className="rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">{msg}</div>}

        <div className="flex items-center justify-end gap-2.5 border-t border-[#16231a] pt-3">
          <Button variant="default" className="text-xs" onClick={() => onDone(false)} disabled={busy}>Not now</Button>
          <Button variant="primary" className="text-xs font-semibold" onClick={use} disabled={busy || !model || configured.length === 0}>
            {busy ? 'Checking model…' : 'Use this model'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Settings card: pick the model for each connected provider at any time. */
export function ModelSettings({ credentials }) {
  const { data, loadErr, reload } = useCatalog(true);
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: false });
  const out = new Set(modelPrefs.exhausted());

  useEffect(() => {
    if (!data) return;
    setChoice({ groq: activeModel(data, 'groq'), gemini: activeModel(data, 'gemini') });
  }, [data]);

  const providers = ['groq', 'gemini'].filter((p) => (data?.providers ?? credentials ?? {})[`${p}Configured`]);

  const save = async () => {
    setBusy(true);
    setMsg({ text: '', ok: false });
    for (const p of providers) {
      if (!choice[p] || choice[p] === activeModel(data, p)) continue;
      const problem = await mount(p, choice[p]);
      if (problem) {
        setChoice((c) => ({ ...c, [p]: activeModel(data, p) }));
        setMsg({ text: problem, ok: false });
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setMsg({ text: 'Models saved. They will be used for your next interview turn.', ok: true });
  };

  const reset = () => {
    modelPrefs.set({});
    setChoice({ groq: data.defaults.groq, gemini: data.defaults.gemini });
    setMsg({ text: 'Back to the default models.', ok: true });
  };

  return (
    <Card title="AI models">
      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        The default model runs automatically. If it reaches its free daily limit you will be asked to switch, or you can choose a different model here at any time.
      </p>

      {!data && !loadErr && <div className="text-xs text-neutral-400">Loading available models…</div>}
      {loadErr && (
        <div className="flex items-center justify-between gap-2 rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
          <span>{loadErr}</span>
          <Button variant="default" className="text-xs" onClick={reload}>Retry</Button>
        </div>
      )}

      {data && providers.length === 0 && (
        <div className="rounded-[6px] border border-amber-900/60 bg-amber-950/40 p-2.5 text-xs text-amber-200">Connect a Groq or Gemini key above to choose models.</div>
      )}

      {data && providers.length > 0 && (
        <div className="space-y-4">
          {providers.map((p) => (
            <Field key={p} label={`${PROVIDER_NAME[p]} model`} hint={(data.catalog[p] || []).find((m) => m.id === choice[p])?.note}>
              <select className={selectCls} value={choice[p] || ''} disabled={busy} onChange={(e) => { setChoice((c) => ({ ...c, [p]: e.target.value })); setMsg({ text: '', ok: false }); }}>
                {data.catalog[p].map((m) => (
                  <option key={m.id} value={m.id}>{`${m.label}${m.isDefault ? ' (default)' : ''}${out.has(`${p}/${m.id}`) ? ' (limit reached today)' : ''}`}</option>
                ))}
              </select>
            </Field>
          ))}

          {msg.text && (
            <div className={`rounded-[6px] border p-2.5 text-xs ${msg.ok ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300' : 'border-red-900/60 bg-red-950/40 text-red-300'}`}>{msg.text}</div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Checking model…' : 'Save models'}</Button>
            <Button variant="default" onClick={reset} disabled={busy}>Use defaults</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
