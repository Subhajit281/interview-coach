let accessToken = null;
// Refresh tokens are deliberately rotated by the server.  When a page resumes
// after the access token has expired, several requests (dashboard cards,
// interview state, etc.) can receive 401 together.  They must share one
// refresh request; otherwise the first response rotates the cookie and a
// second refresh incorrectly looks like a logged-out session.
let refreshInFlight = null;
export const session = { set: (token) => { accessToken = token || null; }, clear: () => { accessToken = null; }, token: () => accessToken };

// Models the user picked from the dropdown. Kept per account in this browser and sent with every request;
// the server validates them against its own list, so nothing typed or tampered can reach a provider.
const safeJson = (v, fallback) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };
const today = () => new Date().toLocaleDateString('en-CA');
export const modelPrefs = {
  owner: 'anon',
  setOwner(id) { this.owner = String(id || 'anon'); },
  get() { return safeJson(localStorage.getItem(`ic.models.v1:${this.owner}`), {}); },
  set(next) {
    const clean = Object.fromEntries(Object.entries(next || {}).filter(([, v]) => v));
    try { Object.keys(clean).length ? localStorage.setItem(`ic.models.v1:${this.owner}`, JSON.stringify(clean)) : localStorage.removeItem(`ic.models.v1:${this.owner}`); } catch { /* storage unavailable */ }
  },
  header() { const p = this.get(); return Object.keys(p).length ? JSON.stringify(p) : ''; },
  // Models that reported "daily limit reached" today (local date), so the picker can label them.
  exhausted() { return safeJson(localStorage.getItem(`ic.models.out.v1:${this.owner}:${today()}`), []); },
  markExhausted(list) {
    const all = new Set(this.exhausted());
    (list || []).filter((x) => x.daily !== false).forEach((x) => all.add(`${x.provider}/${x.model}`));
    try { localStorage.setItem(`ic.models.out.v1:${this.owner}:${today()}`, JSON.stringify([...all])); } catch { /* ignore */ }
  },
};
export const MODEL_PROBLEM_CODES = ['MODEL_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_INVALID'];

async function req(path, { method = 'GET', body, form, retry = true, signal, headers = {} } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(modelPrefs.header() ? { 'X-Model-Prefs': modelPrefs.header() } : {}), ...headers },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (res.status === 401 && retry && path !== '/auth/refresh' && !path.startsWith('/auth/')) {
    try {
      // Do not attach the caller's abort signal to the shared refresh. One
      // cancelled request must not cancel a refresh another live request needs.
      if (!refreshInFlight) {
        refreshInFlight = req('/auth/refresh', { method: 'POST', retry: false })
          .then((refreshed) => { accessToken = refreshed.accessToken; return refreshed; })
          .finally(() => { refreshInFlight = null; });
      }
      await refreshInFlight;
      return req(path, { method, body, form, retry: false, signal, headers });
    } catch { accessToken = null; }
  }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status}). Is the server running?`);
    Object.assign(e, { status: res.status, code: data?.code, provider: data?.provider, model: data?.model, reason: data?.reason, exhausted: data?.exhausted });
    throw e;
  }
  return data;
}

export const api = {
  // Public and deliberately tiny: this is safe to call before the user is signed in
  // and is used to wake a sleeping Render instance without touching the database.
  health: ({ signal } = {}) => req('/health', { signal, retry: false }),
  register: (body) => req('/auth/register', { method: 'POST', body }),
  login: (body) => req('/auth/login', { method: 'POST', body }).then((r) => { accessToken = r.accessToken; return r; }),
  refresh: () => {
    if (!refreshInFlight) {
      refreshInFlight = req('/auth/refresh', { method: 'POST', retry: false })
        .then((r) => { accessToken = r.accessToken; return r; })
        .finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  },
  logout: () => req('/auth/logout', { method: 'POST' }).finally(() => { accessToken = null; }),
  me: () => req('/auth/me'),
  credentials: () => req('/auth/credentials'),
  saveCredentials: (body) => req('/auth/credentials', { method: 'PUT', body }),
  removeCredential: (provider, password) => req(`/auth/credentials/${provider}`, { method: 'DELETE', body: { password } }),
  meta: () => req('/meta'),
  models: () => req('/models'),
  checkModel: (provider, model) => req('/models/check', { method: 'POST', body: { provider, model } }),
  stats: () => req('/stats'),
  usage: () => req('/usage'),
  interviews: () => req('/interviews'),
  interview: (id) => req(`/interviews/${id}`),
  start: (cfg, { signal, idempotencyKey } = {}) => req('/interviews', { method: 'POST', body: cfg, signal, headers: idempotencyKey ? { 'X-Interview-Start-Key': idempotencyKey } : {} }),
  turn: (id, body) => req(`/interviews/${id}/turn`, { method: 'POST', body }),
  pause: (id) => req(`/interviews/${id}/pause`, { method: 'POST' }),
  resume: (id) => req(`/interviews/${id}/resume`, { method: 'POST' }),
  end: (id, elapsedSec) => req(`/interviews/${id}/end`, { method: 'POST', body: { elapsedSec } }),
  regenerateReport: (id) => req(`/interviews/${id}/report`, { method: 'POST' }),
  remove: (id) => req(`/interviews/${id}`, { method: 'DELETE' }),
  projects: () => req('/projects'),
  addProject: (name, description) => req('/projects', { method: 'POST', body: { name, description } }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),
  transcribe: (blob, duration, voiced) => {
    const form = new FormData();
    const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
    form.append('audio', blob, `speech.${ext}`);
    form.append('duration', String(duration));
    if (Number.isFinite(voiced)) form.append('voiced', String(voiced));
    return req('/transcribe', { method: 'POST', form });
  },
};
