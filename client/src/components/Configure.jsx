import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, Field, inputCls, Badge } from './ui.jsx';

const closest = (list, n) => list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

export default function Configure({ meta, onStart, onCancel }) {
  const [f, setF] = useState({
    mode: 'dsa',
    company: 'generic',
    position: 'New Grad SDE',
    round: meta.companies[0]?.rounds[0] || 'Technical Round 1',
    difficulty: 'Mixed',
    durationMin: 45,
    personality: 'real',
    style: 'standard',
    projectId: null,
  });
  const [projects, setProjects] = useState([]);
  const [np, setNp] = useState({ name: '', description: '' });
  const [err, setErr] = useState('');
  const company = meta.companies.find((c) => c.id === f.company) || meta.companies[0];
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadProjects = () =>
    api.projects()
      .then((r) => {
        setProjects(r.projects);
        setF((s) => ({ ...s, projectId: s.projectId ?? r.projects[0]?.id ?? null }));
      })
      .catch(() => {});

  useEffect(() => {
    loadProjects();
  }, []);

  const changeCompany = (id) => {
    const c = meta.companies.find((x) => x.id === id);
    if (!c) return;
    setF((s) => ({
      ...s,
      company: id,
      round: c.rounds[0],
      durationMin: closest(meta.durations, c.defaultDurationMin),
    }));
  };

  const addProject = async () => {
    setErr('');
    try {
      await api.addProject(np.name, np.description);
      setNp({ name: '', description: '' });
      await loadProjects();
    } catch (e) {
      setErr(e.message);
    }
  };

  const readFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setNp((s) => ({
      name: s.name || file.name.replace(/\.[^.]+$/, ''),
      description: (s.description ? `${s.description}\n\n` : '') + t.slice(0, 20000),
    }));
  };

  const needsProject = f.mode === 'project';
  const ready = !needsProject || f.projectId;

  const Sel = ({ k, label, options, hint, onChangeCustom }) => (
    <Field label={label} hint={hint}>
      <select
        className={inputCls}
        value={f[k]}
        onChange={(e) => {
          if (onChangeCustom) {
            onChangeCustom(e.target.value);
          } else {
            set(k, typeof options[0]?.value === 'number' ? Number(e.target.value) : e.target.value);
          }
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#070b08] text-neutral-100">
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title="Interview Setup & Parameters">
        {/* Alerts if providers are partially configured */}
        {!meta.providers?.groqConfigured && (
          <div className="mb-4 flex items-start gap-2.5 rounded-[6px] border border-amber-900/60 bg-amber-950/40 p-3 text-xs text-amber-200">
            <span className="mt-0.5 text-amber-400">ℹ</span>
            <div>
              <strong>Groq key not configured:</strong> Speech-to-text voice transcription is currently disabled. You can still type all answers in the chat editor.
            </div>
          </div>
        )}
        {!meta.providers?.groqConfigured && !meta.providers?.geminiConfigured && (
          <div className="mb-4 flex items-start gap-2.5 rounded-[6px] border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200">
            <span className="mt-0.5 text-red-400">⚠</span>
            <div>
              <strong>No AI provider configured:</strong> Connect your Gemini or Groq API key in Settings before launching an interview.
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Sel
            k="mode"
            label="Interview track"
            options={meta.modes.map((m) => ({ value: m.id, label: m.label }))}
          />
          <Sel
            k="company"
            label="Target company"
            options={meta.companies.map((c) => ({ value: c.id, label: c.name }))}
            onChangeCustom={changeCompany}
          />

          <Field label="Target role level">
            <select
              className={inputCls}
              value={f.position}
              onChange={(e) => set('position', e.target.value)}
            >
              {meta.positions.map((p) => (
                <option key={p} value={p} className="bg-[#070b08] text-neutral-100">
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Interview round">
            <select
              className={inputCls}
              value={f.round}
              onChange={(e) => set('round', e.target.value)}
            >
              {company.rounds.map((r) => (
                <option key={r} value={r} className="bg-[#070b08] text-neutral-100">
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Problem difficulty">
            <select
              className={inputCls}
              value={f.difficulty}
              onChange={(e) => set('difficulty', e.target.value)}
            >
              {meta.difficulties.map((d) => (
                <option key={d} value={d} className="bg-[#070b08] text-neutral-100">
                  {d}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Target duration">
            <select
              className={inputCls}
              value={f.durationMin}
              onChange={(e) => set('durationMin', Number(e.target.value))}
            >
              {meta.durations.map((d) => (
                <option key={d} value={d} className="bg-[#070b08] text-neutral-100">
                  {d} minutes
                </option>
              ))}
            </select>
          </Field>

          <Sel
            k="personality"
            label="Interviewer persona"
            options={meta.personalities.map((p) => ({ value: p.id, label: p.label }))}
          />
          <Sel
            k="style"
            label="Interview tone"
            options={meta.styles.map((s) => ({ value: s.id, label: s.label }))}
          />
        </div>

        {/* Company interview context pill */}
        <div className="mt-4 flex items-center gap-2 rounded-[6px] border border-[#16231a] bg-[#070b08] p-3 text-xs text-neutral-300">
          <Badge variant="emerald">{company.name}</Badge>
          <span className="text-neutral-400 leading-normal">{company.style}</span>
        </div>
      </Card>

      {/* Project discussion selection if Project mode */}
      {needsProject && (
        <Card title="Saved Project for Deep-Dive">
          {projects.length > 0 && (
            <div className="mb-4 space-y-2">
              {projects.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-[6px] border p-3 text-xs transition-all ${
                    f.projectId === p.id
                      ? 'border-emerald-500/50 bg-[#0e1912]'
                      : 'border-[#16231a] bg-[#070b08] hover:border-[#223628]'
                  }`}
                >
                  <input
                    type="radio"
                    name="project"
                    className="mt-0.5 accent-emerald-500"
                    checked={f.projectId === p.id}
                    onChange={() => set('projectId', p.id)}
                  />
                  <div className="flex-1">
                    <span className="font-semibold text-neutral-100 block">{p.name}</span>
                    <span className="text-neutral-400 line-clamp-2 mt-0.5 leading-relaxed">{p.preview}…</span>
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-neutral-400 hover:text-red-300"
                    onClick={async (e) => {
                      e.preventDefault();
                      await api.deleteProject(p.id);
                      setF((s) => ({ ...s, projectId: null }));
                      loadProjects();
                    }}
                  >
                    Delete
                  </Button>
                </label>
              ))}
            </div>
          )}

          <div className="space-y-3 rounded-[6px] border border-[#16231a] bg-[#070b08] p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Or Add a New Project
            </div>
            <input
              className={inputCls}
              placeholder="Project name (e.g. Distributed Task Queue)"
              value={np.name}
              onChange={(e) => setNp({ ...np, name: e.target.value })}
            />
            <textarea
              className={`${inputCls} h-28 font-mono text-xs`}
              placeholder="Describe the architecture, stack, concurrency, bottlenecks, trade-offs, and your specific role. Minimum 30 characters."
              value={np.description}
              onChange={(e) => setNp({ ...np, description: e.target.value })}
            />
            <div className="flex items-center gap-3">
              <Button
                variant="default"
                onClick={addProject}
                disabled={!np.name.trim() || np.description.trim().length < 30}
              >
                Save project
              </Button>
              <label className="cursor-pointer text-xs font-medium text-emerald-400 hover:text-emerald-300 underline inline-flex items-center gap-1 transition-colors">
                <span>Upload README / notes (.md, .txt)</span>
                <input
                  type="file"
                  accept=".md,.txt"
                  className="hidden"
                  onChange={readFile}
                />
              </label>
            </div>
            {err && <p className="text-xs text-red-300">{err}</p>}
          </div>
        </Card>
      )}

      {/* Start actions */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => onStart(f)}
            className="shadow-md"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Launch interview session
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <span className="text-[11px] text-neutral-400 hidden sm:inline-block">
          Microphone permission required for voice audio.
        </span>
      </div>
    </div>
  );
}
