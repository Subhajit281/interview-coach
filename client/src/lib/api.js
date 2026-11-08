async function req(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}). Is the server running?`);
  return data;
}

export const api = {
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
