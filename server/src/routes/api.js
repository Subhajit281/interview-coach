import { Router } from 'express';
import multer from 'multer';
import { MODES, POSITIONS, LEGACY_POSITIONS, DIFFICULTIES, DURATIONS, STYLES, PERSONALITIES } from '../data/modes.js';
import { COMPANIES } from '../data/companies.js';
import { config } from '../config/index.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export function validateConfig(body, repo) {
  const b = body || {};
  if (!MODES[b.mode]) throw httpError(400, 'Invalid interview mode');
  const company = COMPANIES[b.company] ? b.company : 'generic';
  const position = LEGACY_POSITIONS[b.position] ?? b.position;
  if (!POSITIONS.includes(position)) throw httpError(400, 'Invalid position');
  if (!DIFFICULTIES.includes(b.difficulty)) throw httpError(400, 'Invalid difficulty');
  if (!PERSONALITIES[b.personality]) throw httpError(400, 'Invalid interviewer personality');
  const durationMin = Number(b.durationMin);
  if (!DURATIONS.includes(durationMin)) throw httpError(400, 'Invalid duration');
  const style = STYLES[b.style] ? b.style : 'standard';
  const round = COMPANIES[company].rounds.includes(b.round) ? b.round : COMPANIES[company].rounds[0];
  let projectId = null;
  if (b.mode === 'project') {
    projectId = Number(b.projectId);
    if (!projectId || !repo.getProject(projectId)) throw httpError(400, 'Project Discussion needs a project. Add one first.');
  }
  return { mode: b.mode, company, position, difficulty: b.difficulty, personality: b.personality, durationMin, style, round, projectId };
}

export function apiRouter({ repo, interviewer, evaluator, stt, tracker }) {
  const r = Router();
  const busy = new Set();

  r.get('/health', (_req, res) => res.json({
    ok: true,
    providers: { groq: Boolean(config.groq.apiKey), gemini: Boolean(config.gemini.apiKey) },
  }));

  r.get('/meta', (_req, res) => res.json({
    modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label, topics: m.topics })),
    companies: Object.entries(COMPANIES).map(([id, c]) => ({ id, name: c.name, style: c.style, rounds: c.rounds, defaultDurationMin: c.defaultDurationMin })),
    personalities: Object.entries(PERSONALITIES).map(([id, p]) => ({ id, label: p.label })),
    styles: Object.entries(STYLES).map(([id, d]) => ({ id, label: d.split(':')[0] })),
    positions: POSITIONS, difficulties: DIFFICULTIES, durations: DURATIONS,
    providers: { groq: Boolean(config.groq.apiKey), gemini: Boolean(config.gemini.apiKey) },
  }));

  r.get('/usage', (_req, res) => res.json(tracker.snapshot()));

  r.get('/stats', (_req, res) => {
    const topics = repo.topicStats().map((t) => {
      const [mode, ...rest] = t.topic.split(':');
      return { mode, topic: rest.join(':'), attempts: t.attempts, avg: Math.round(t.avg_score * 10) / 10, hints: t.hints_total, last_seen: t.last_seen };
    });
    const sorted = [...topics].sort((a, b) => a.avg - b.avg);
    res.json({
      ...repo.overview(),
      weakTopics: sorted.filter((t) => t.avg < 6).slice(0, 6),
      strongTopics: [...sorted].reverse().filter((t) => t.avg >= 7).slice(0, 6),
      recentWeaknesses: repo.recentWeaknesses(3, 6),
    });
  });

  r.get('/interviews', (_req, res) => res.json({ interviews: repo.listInterviews() }));

  r.get('/interviews/:id', wrap((req, res) => {
    const iv = repo.getInterview(Number(req.params.id));
    if (!iv) throw httpError(404, 'Interview not found');
    res.json({ interview: iv, messages: repo.getMessages(iv.id), report: repo.getReport(iv.id) });
  }));

  r.post('/interviews', wrap(async (req, res) => {
    const cfg = validateConfig(req.body, repo);
    const { interview, reply } = await interviewer.start(cfg);
    res.json({ interview, message: reply });
  }));

  r.post('/interviews/:id/turn', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (busy.has(id)) throw httpError(409, 'The previous turn is still being processed.');
    busy.add(id);
    try {
      const reply = await interviewer.turn(id, { text: req.body?.text, elapsedSec: Number(req.body?.elapsedSec) || 0 });
      res.json(reply);
    } finally { busy.delete(id); }
  }));

  const setState = (from, to) => wrap((req, res) => {
    const iv = repo.getInterview(Number(req.params.id));
    if (!iv) throw httpError(404, 'Interview not found');
    if (iv.status !== from) throw httpError(409, `Interview is ${iv.status}`);
    repo.setStatus(iv.id, to);
    res.json({ ok: true, status: to });
  });
  r.post('/interviews/:id/pause', setState('active', 'paused'));
  r.post('/interviews/:id/resume', setState('paused', 'active'));

  r.post('/interviews/:id/end', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const iv = repo.getInterview(id);
    if (!iv) throw httpError(404, 'Interview not found');
    if (iv.status === 'completed') return res.json({ interviewId: id, report: repo.getReport(id) });
    const candidateTurns = repo.getMessages(id).filter((m) => m.role === 'candidate').length;
    if (candidateTurns < 2) {
      repo.finishInterview(id, 'abandoned', req.body?.elapsedSec);
      return res.json({ interviewId: id, report: null, note: 'Too short to evaluate (fewer than 2 answers).' });
    }
    repo.finishInterview(id, 'completed', req.body?.elapsedSec);
    try {
      const report = await evaluator.evaluate(id);
      res.json({ interviewId: id, report });
    } catch (e) {
      // keep the transcript; allow retry via /report
      repo.setStatus(id, 'completed');
      throw httpError(502, `Interview saved, but the report failed: ${e.message}`);
    }
  }));

  r.post('/interviews/:id/report', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getInterview(id)) throw httpError(404, 'Interview not found');
    res.json({ report: await evaluator.evaluate(id) });
  }));

  r.delete('/interviews/:id', wrap((req, res) => {
    repo.deleteInterview(Number(req.params.id));
    res.json({ ok: true });
  }));

  r.post('/transcribe', upload.single('audio'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'No audio received');
    const durationSec = Number(req.body?.duration) || 0;
    const voicedSec = req.body?.voiced !== undefined && Number.isFinite(Number(req.body.voiced)) ? Number(req.body.voiced) : null;
    const text = await stt.transcribe({ buffer: req.file.buffer, mime: req.file.mimetype || 'audio/webm', durationSec, voicedSec });
    res.json({ text });
  }));

  r.get('/projects', (_req, res) => res.json({ projects: repo.listProjects() }));
  r.post('/projects', wrap((req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    const description = String(req.body?.description ?? '').trim().slice(0, 20000);
    if (!name || description.length < 30) throw httpError(400, 'Give the project a name and a description of at least 30 characters.');
    res.json({ id: repo.addProject(name, description) });
  }));
  r.delete('/projects/:id', wrap((req, res) => {
    repo.deleteProject(Number(req.params.id));
    res.json({ ok: true });
  }));

  return r;
}
