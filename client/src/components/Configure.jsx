import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, Field, inputCls } from './ui.jsx';

const closest = (list, n) => list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

export default function Configure({ meta, onStart, onCancel }) {
  const [f, setF] = useState({
    mode: 'dsa', company: 'generic', position: 'New Grad SDE', round: meta.companies[0].rounds[0],
    difficulty: 'Mixed', durationMin: 45, personality: 'real', style: 'standard', projectId: null,
  });
  const [projects, setProjects] = useState([]);
  const [np, setNp] = useState({ name: '', description: '' });
  const [err, setErr] = useState('');
  const company = meta.companies.find((c) => c.id === f.company);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadProjects = () => api.projects().then((r) => {
    setProjects(r.projects);
    setF((s) => ({ ...s, projectId: s.projectId ?? r.projects[0]?.id ?? null }));
  }).catch(() => {});
  useEffect(() => { loadProjects(); }, []);

  const changeCompany = (id) => {
    const c = meta.companies.find((x) => x.id === id);
    setF((s) => ({ ...s, company: id, round: c.rounds[0], durationMin: closest(meta.durations, c.defaultDurationMin) }));
  };

  const addProject = async () => {
    setErr('');
    try { await api.addProject(np.name, np.description); setNp({ name: '', description: '' }); await loadProjects(); }
    catch (e) { setErr(e.message); }
  };
  const readFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setNp((s) => ({ name: s.name || file.name.replace(/\.[^.]+$/, ''), description: (s.description ? `${s.description}\n\n` : '') + t.slice(0, 20000) }));
  };

  const needsProject = f.mode === 'project';
  const ready = !needsProject || f.projectId;
  const Sel = ({ k, label, options, hint }) => (
    <Field label={label} hint={hint}>
      <select className={inputCls} value={f[k]} onChange={(e) => set(k, typeof options[0].value === 'number' ? Number(e.target.value) : e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title="Interview configuration">
        {!meta.providers.groq && (
          <p className="mb-4 rounded border border-amber-900 bg-amber-950/40 p-2 text-sm text-amber-200">
            GROQ_API_KEY is not set, so voice transcription is off. You can still type answers.
          </p>
        )}
        {!meta.providers.groq && !meta.providers.gemini && (
          <p className="mb-4 rounded border border-red-900 bg-red-950/40 p-2 text-sm text-red-200">No LLM key is configured. Add GROQ_API_KEY and/or GEMINI_API_KEY to .env and restart the server.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Sel k="mode" label="Interview mode" options={meta.modes.map((m) => ({ value: m.id, label: m.label }))} />
          <Sel k="company" label="Target company" options={meta.companies.map((c) => ({ value: c.id, label: c.name }))} />
          <Field label="Position">
            <select className={inputCls} value={f.position} onChange={(e) => set('position', e.target.value)}>
              {meta.positions.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Round">
            <select className={inputCls} value={f.round} onChange={(e) => set('round', e.target.value)}>
              {company.rounds.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className={inputCls} value={f.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
              {meta.difficulties.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Duration">
            <select className={inputCls} value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))}>
              {meta.durations.map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </Field>
          <Sel k="personality" label="Interviewer personality" options={meta.personalities.map((p) => ({ value: p.id, label: p.label }))} />
          <Sel k="style" label="Interview style" options={meta.styles.map((s) => ({ value: s.id, label: s.label }))} />
        </div>
        <p className="mt-4 text-xs text-neutral-500">{company.name}: {company.style}</p>
      </Card>

      {needsProject && (
        <Card title="Your project">
          {projects.length > 0 && (
            <div className="mb-4 space-y-2">
              {projects.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded border border-neutral-800 p-2 text-sm">
                  <input type="radio" name="project" className="mt-1" checked={f.projectId === p.id} onChange={() => set('projectId', p.id)} />
                  <span className="flex-1"><span className="font-medium">{p.name}</span><span className="block text-xs text-neutral-500">{p.preview}…</span></span>
                  <Button variant="ghost" onClick={async () => { await api.deleteProject(p.id); setF((s) => ({ ...s, projectId: null })); loadProjects(); }}>Delete</Button>
                </label>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <input className={inputCls} placeholder="Project name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
            <textarea className={`${inputCls} h-32`} placeholder="Describe the project: what it does, stack, architecture, database, hardest problems, your role. Paste README or docs if you have them." value={np.description} onChange={(e) => setNp({ ...np, description: e.target.value })} />
            <div className="flex items-center gap-3">
              <Button onClick={addProject} disabled={!np.name.trim() || np.description.trim().length < 30}>Save project</Button>
              <label className="cursor-pointer text-sm text-neutral-400 underline">Load .md / .txt file<input type="file" accept=".md,.txt" className="hidden" onChange={readFile} /></label>
            </div>
            {err && <p className="text-sm text-red-300">{err}</p>}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="primary" disabled={!ready} onClick={() => onStart(f)}>Start interview</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-neutral-500">Your browser will ask for microphone access. Chrome or Edge give the best voices and recording support.</p>
    </div>
  );
}
