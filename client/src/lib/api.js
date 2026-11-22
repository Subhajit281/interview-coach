let accessToken = null;
export const session = { set: (token) => { accessToken = token || null; }, clear: () => { accessToken = null; }, token: () => accessToken };
async function req(path, { method = 'GET', body, form, retry = true } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (res.status === 401 && retry && path !== '/auth/refresh' && !path.startsWith('/auth/')) { try { const refreshed = await req('/auth/refresh', { method: 'POST', retry: false }); accessToken = refreshed.accessToken; return req(path, { method, body, form, retry: false }); } catch { accessToken = null; } }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}). Is the server running?`);
  return data;
}

export const api = {
  register: (body) => req('/auth/register', { method: 'POST', body }),
  login: (body) => req('/auth/login', { method: 'POST', body }).then((r) => { accessToken = r.accessToken; return r; }),
  refresh: () => req('/auth/refresh', { method: 'POST' }).then((r) => { accessToken = r.accessToken; return r; }),
  logout: () => req('/auth/logout', { method: 'POST' }).finally(() => { accessToken = null; }),
  me: () => req('/auth/me'),
  credentials: () => req('/auth/credentials'),
  saveCredentials: (body) => req('/auth/credentials', { method: 'PUT', body }),
  removeCredential: (provider, password) => req(`/auth/credentials/${provider}`, { method: 'DELETE', body: { password } }),
  meta: () => req('/meta'),
  stats: () => req('/stats'),
  usage: () => req('/usage'),
  interviews: () => req('/interviews'),
  interview: (id) => req(`/interviews/${id}`),
  start: (cfg) => req('/interviews', { method: 'POST', body: cfg }),
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
