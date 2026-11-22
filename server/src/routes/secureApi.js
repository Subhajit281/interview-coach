import { Router } from 'express';
import multer from 'multer';
import { MODES, POSITIONS, LEGACY_POSITIONS, DIFFICULTIES, DURATIONS, STYLES, PERSONALITIES } from '../data/modes.js';
import { COMPANIES } from '../data/companies.js';
import { createInterviewer } from '../services/interviewer.js';
import { createEvaluator } from '../services/evaluator.js';
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const err = (status, message) => Object.assign(new Error(message), { status });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
async function configFor(body, repo) {
  const b = body || {}, mode = b.mode, company = COMPANIES[b.company] ? b.company : 'generic', position = LEGACY_POSITIONS[b.position] ?? b.position, durationMin = Number(b.durationMin);
  if (!MODES[mode] || !POSITIONS.includes(position) || !DIFFICULTIES.includes(b.difficulty) || !PERSONALITIES[b.personality] || !DURATIONS.includes(durationMin)) throw err(400, 'Invalid interview configuration.');
  const projectId = mode === 'project' ? String(b.projectId || '') : null;
  if (projectId && !(await repo.getProject(projectId))) throw err(400, 'Project Discussion needs one of your saved projects.');
  if (mode === 'project' && !projectId) throw err(400, 'Project Discussion needs one of your saved projects.');
  return { mode, company, position, difficulty: b.difficulty, personality: b.personality, durationMin, style: STYLES[b.style] ? b.style : 'standard', round: COMPANIES[company].rounds.includes(b.round) ? b.round : COMPANIES[company].rounds[0], projectId };
}
export function secureApiRouter({ repoForUser, llm, stt, credentials, tracker }) {
  const r = Router(), busy = new Set();
  const repo = (req) => repoForUser(req.userId);
  const services = async (req) => { const keys = await credentials.resolve(req.userId); const current = repo(req); return { repo: current, interviewer: createInterviewer({ repo: current, llm, credentials: keys }), evaluator: createEvaluator({ repo: current, llm, credentials: keys }), keys }; };
  r.get('/health', (_q, res) => res.json({ ok: true, authRequired: true }));
  r.get('/meta', wrap(async (req, res) => res.json({ modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label, topics: m.topics })), companies: Object.entries(COMPANIES).map(([id, c]) => ({ id, name: c.name, style: c.style, rounds: c.rounds, defaultDurationMin: c.defaultDurationMin })), personalities: Object.entries(PERSONALITIES).map(([id, p]) => ({ id, label: p.label })), styles: Object.entries(STYLES).map(([id, d]) => ({ id, label: d.split(':')[0] })), positions: POSITIONS, difficulties: DIFFICULTIES, durations: DURATIONS, providers: await credentials.status(req.userId) })));
  r.get('/usage', (_q, res) => res.json(tracker.snapshot()));
  r.get('/stats', wrap(async (req, res) => { const current = repo(req), topics = await current.topicStats(), overview = await current.overview(); const mapped = topics.map((t) => { const [mode, ...rest] = t.topic.split(':'); return { mode, topic: rest.join(':'), attempts: t.attempts, avg: Math.round(t.avg_score * 10) / 10, hints: t.hints_total, last_seen: t.last_seen }; }); const sorted = [...mapped].sort((a, b) => a.avg - b.avg); res.json({ ...overview, weakTopics: sorted.filter((t) => t.avg < 6).slice(0, 6), strongTopics: [...sorted].reverse().filter((t) => t.avg >= 7).slice(0, 6), recentWeaknesses: await current.recentWeaknesses(3, 6) }); }));
  r.get('/interviews', wrap(async (req, res) => res.json({ interviews: await repo(req).listInterviews() })));
  r.get('/interviews/:id', wrap(async (req, res) => { const current = repo(req), interview = await current.getInterview(req.params.id); if (!interview) throw err(404, 'Interview not found.'); res.json({ interview, messages: await current.getMessages(interview.id), report: await current.getReport(interview.id) }); }));
  r.post('/interviews', wrap(async (req, res) => { const s = await services(req), cfg = await configFor(req.body, s.repo); const result = await s.interviewer.start(cfg); res.json({ interview: result.interview, message: result.reply, interviewer: result.interviewer || result.reply?.interviewer }); }));
  r.post('/interviews/:id/turn', wrap(async (req, res) => { const key = `${req.userId}:${req.params.id}`; if (busy.has(key)) throw err(409, 'The previous turn is still being processed.'); busy.add(key); try { const s = await services(req); res.json(await s.interviewer.turn(req.params.id, { text: req.body?.text, elapsedSec: Number(req.body?.elapsedSec) || 0 })); } finally { busy.delete(key); } }));
  for (const [path, from, to] of [['/interviews/:id/pause', 'active', 'paused'], ['/interviews/:id/resume', 'paused', 'active']]) r.post(path, wrap(async (req, res) => { const current = repo(req), interview = await current.getInterview(req.params.id); if (!interview) throw err(404, 'Interview not found.'); if (interview.status !== from) throw err(409, `Interview is ${interview.status}.`); await current.setStatus(interview.id, to); res.json({ ok: true, status: to }); }));
  r.post('/interviews/:id/end', wrap(async (req, res) => { const s = await services(req), interview = await s.repo.getInterview(req.params.id); if (!interview) throw err(404, 'Interview not found.'); if (interview.status === 'completed') return res.json({ interviewId: interview.id, report: await s.repo.getReport(interview.id) }); const messages = await s.repo.getMessages(interview.id); if (messages.filter((m) => m.role === 'candidate').length < 2) { await s.repo.finishInterview(interview.id, 'abandoned', req.body?.elapsedSec); return res.json({ interviewId: interview.id, report: null, note: 'Too short to evaluate (fewer than 2 answers).' }); } await s.repo.finishInterview(interview.id, 'completed', req.body?.elapsedSec); try { res.json({ interviewId: interview.id, report: await s.evaluator.evaluate(interview.id) }); } catch { throw err(502, 'Interview was saved, but the report could not be generated. You can retry it.'); } }));
  r.post('/interviews/:id/report', wrap(async (req, res) => { const s = await services(req); if (!(await s.repo.getInterview(req.params.id))) throw err(404, 'Interview not found.'); res.json({ report: await s.evaluator.evaluate(req.params.id) }); }));
  r.delete('/interviews/:id', wrap(async (req, res) => { await repo(req).deleteInterview(req.params.id); res.json({ ok: true }); }));
  r.post('/transcribe', upload.single('audio'), wrap(async (req, res) => { if (!req.file) throw err(400, 'No audio received.'); const keys = await credentials.resolve(req.userId); if (!keys.groqKey) throw err(428, 'Configure a Groq key to use voice transcription.'); res.json({ text: await stt.transcribe({ buffer: req.file.buffer, mime: req.file.mimetype || 'audio/webm', durationSec: Number(req.body?.duration) || 0, voicedSec: req.body?.voiced === undefined ? null : Number(req.body.voiced), apiKey: keys.groqKey }) }); }));
  r.get('/projects', wrap(async (req, res) => res.json({ projects: await repo(req).listProjects() })));
  r.post('/projects', wrap(async (req, res) => { const name = String(req.body?.name || '').trim().slice(0, 120), description = String(req.body?.description || '').trim().slice(0, 20000); if (!name || description.length < 30) throw err(400, 'Give the project a name and a description of at least 30 characters.'); res.json({ id: await repo(req).addProject(name, description) }); }));
  r.delete('/projects/:id', wrap(async (req, res) => { await repo(req).deleteProject(req.params.id); res.json({ ok: true }); }));
  return r;
}
