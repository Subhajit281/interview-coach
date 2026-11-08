import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createRepo, pickFocus, seededRng } from '../src/services/repo.js';
import { parseInterviewerReply } from '../src/services/interviewer.js';
import { normalizeReport } from '../src/services/evaluator.js';
import { buildSystemPrompt } from '../src/services/prompts.js';
import { MODES } from '../src/data/modes.js';
import { createApp } from '../src/app.js';
import { ProviderError } from '../src/services/http.js';
import { isStrayInput } from '../src/services/stray.js';
import { autoPairEdit } from '../../client/src/lib/autoPair.js';

function fakeLlm(script) {
  const calls = [];
  return {
    calls,
    chat: async (req) => {
      calls.push(req);
      const next = script.shift();
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next), provider: 'fake', model: 'f' };
    },
  };
}

const reply = (o) => ({ say: 'Okay.', board: '', topic: 'Graphs', new_question: false, question_title: '', hint_given: false, wrap_up: false, ...o });
const REPORT = {
  overall_score: 5.5, hire_recommendation: 'Lean No Hire',
  categories: { problem_understanding: 6, approach_selection: 5, technical_knowledge: 5, algorithmic_reasoning: 5, code_correctness: null, time_complexity: 7, space_complexity: 4, edge_case_handling: 3, communication: 6, confidence_clarity: 6 },
  strengths: ['Clear framing'], weaknesses: ['Missed edge cases'], mistakes: [{ what: 'Ignored cycles', why_wrong: 'Infinite loop', correct: 'Track visited' }],
  recommended_topics: ['Graphs'], practice_problems: [{ title: 'Number of Islands', platform: 'LeetCode', topic: 'Graphs' }],
  signal_notes: 'Correct but shallow', topic_scores: [{ topic: 'Graphs', score: 4, hints_used: 1 }],
  question_results: [{ title: 'Course Schedule', solved: false, hints_used: 1 }], final_assessment: 'Below bar today.',
};

async function boot(script, stt) {
  const db = openDb(':memory:');
  const llm = fakeLlm(script);
  const server = createApp({ db, llm, stt }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  return { db, llm, call, close: () => server.close() };
}

const CFG = { mode: 'dsa', company: 'google', position: 'SDE FTE', difficulty: 'Medium', personality: 'real', durationMin: 30, style: 'standard' };

test('parseInterviewerReply accepts JSON and degrades to plain text', () => {
  assert.equal(parseInterviewerReply('{"say":"Hi","new_question":true,"question_title":"T"}').newQuestion, true);
  assert.equal(parseInterviewerReply('Just words, no json').say, 'Just words, no json');
});

test('pickFocus favors weak topics and is deterministic with a seed', () => {
  const topics = ['A', 'B', 'C'];
  const stats = [{ topic: 'dsa:A', attempts: 3, avg_score: 9, hints_total: 0 }, { topic: 'dsa:B', attempts: 3, avg_score: 2, hints_total: 3 }, { topic: 'dsa:C', attempts: 3, avg_score: 9, hints_total: 0 }];
  let b = 0;
  for (let i = 1; i <= 300; i++) if (pickFocus(topics, stats, 'dsa', 1, seededRng(i))[0] === 'B') b++;
  assert.ok(b > 150, `weak topic picked ${b}/300`);
  assert.deepEqual(pickFocus(topics, stats, 'dsa', 2, seededRng(5)), pickFocus(topics, stats, 'dsa', 2, seededRng(5)));
});

test('topic stats keep a running average', () => {
  const repo = createRepo(openDb(':memory:'));
  repo.upsertTopicStat('dsa:Graphs', 4, 1);
  repo.upsertTopicStat('dsa:Graphs', 8, 0);
  const [row] = repo.topicStats('dsa');
  assert.equal(row.attempts, 2);
  assert.equal(row.avg_score, 6);
  assert.equal(row.hints_total, 1);
});

test('normalizeReport clamps scores and tolerates junk', () => {
  const r = normalizeReport({ overall_score: 14, categories: { communication: -3, confidence_clarity: 'x' }, strengths: 'no', mistakes: [{}] });
  assert.equal(r.overall_score, 10);
  assert.equal(r.categories.communication, 0);
  assert.equal(r.categories.confidence_clarity, null);
  assert.deepEqual(r.strengths, []);
  assert.deepEqual(r.mistakes, []);
});

test('prompt keeps personalities separate and injects time pressure', () => {
  const base = { id: 1, mode: 'dsa', company: 'google', position: 'SDE Intern', round: 'Phone screen', style: 'standard', difficulty: 'Hard', duration_min: 30, project_id: null };
  const real = buildSystemPrompt({ interview: { ...base, personality: 'real' }, elapsedSec: 0 });
  const mentor = buildSystemPrompt({ interview: { ...base, personality: 'mentor' }, elapsedSec: 31 * 60 });
  assert.ok(real.includes('Real Interviewer') && !real.includes('teacher'));
  assert.ok(mentor.includes('Mentor') && mentor.includes('TIME IS UP'));
  assert.ok(MODES.dsa.topics.length === 15);
});

test('full interview flow: start, turn, pause/resume, retry, end, report, stats', async () => {
  const { call, llm, close } = await boot([
    reply({ say: 'Given an array, find two numbers summing to a target.', board: 'Two Sum...', new_question: true, question_title: 'Two Sum', topic: 'Hashing' }),
    reply({ say: 'What is the complexity?', hint_given: true }),
    new ProviderError('boom', 502),
    reply({ say: 'Can you do better on space?' }),
    REPORT,
  ]);
  try {
    let r = await call('/interviews', 'POST', CFG);
    assert.equal(r.status, 200);
    const id = r.data.interview.id;
    assert.equal(r.data.message.board, 'Two Sum...');

    r = await call(`/interviews/${id}/turn`, 'POST', { text: 'I would brute force it.', elapsedSec: 60 });
    assert.equal(r.data.say, 'What is the complexity?');

    assert.equal((await call(`/interviews/${id}/pause`, 'POST')).status, 200);
    assert.equal((await call(`/interviews/${id}/turn`, 'POST', { text: 'x' })).status, 409);
    assert.equal((await call(`/interviews/${id}/resume`, 'POST')).status, 200);

    r = await call(`/interviews/${id}/turn`, 'POST', { text: 'O(n^2) time, O(1) space.', elapsedSec: 120 });
    assert.equal(r.status, 502); // provider failure surfaces, candidate message is kept
    r = await call(`/interviews/${id}/turn`, 'POST', { elapsedSec: 125 }); // retry without text
    assert.equal(r.status, 200);
    assert.equal(r.data.say, 'Can you do better on space?');

    const sysPrompt = llm.calls[0].system;
    assert.ok(sysPrompt.includes('Google'));

    r = await call(`/interviews/${id}/end`, 'POST', { elapsedSec: 300 });
    assert.equal(r.status, 200);
    assert.equal(r.data.report.overall_score, 5.5);
    assert.equal(r.data.report.categories.code_correctness, null);

    const detail = await call(`/interviews/${id}`);
    assert.equal(detail.data.interview.status, 'completed');
    assert.equal(detail.data.messages.length, 5);

    const stats = await call('/stats');
    assert.equal(stats.data.reports, 1);
    assert.equal(stats.data.weakTopics[0].topic, 'Graphs');
    assert.equal(stats.data.neededHints, 1);
    assert.deepEqual(stats.data.recentWeaknesses, ['Missed edge cases']);
    assert.equal((await call('/interviews')).data.interviews[0].overall_score, 5.5);
  } finally { close(); }
});

test('too-short interviews are abandoned without a report call', async () => {
  const { call, close } = await boot([reply({ say: 'First question?' })]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    const r = await call(`/interviews/${id}/end`, 'POST', { elapsedSec: 10 });
    assert.equal(r.data.report, null);
    assert.equal((await call(`/interviews/${id}`)).data.interview.status, 'abandoned');
  } finally { close(); }
});

test('failed first question leaves no orphan interview', async () => {
  const { call, close } = await boot([new ProviderError('down', 502)]);
  try {
    assert.equal((await call('/interviews', 'POST', CFG)).status, 502);
    assert.equal((await call('/interviews')).data.interviews.length, 0);
  } finally { close(); }
});

test('config validation and project mode requirements', async () => {
  const { call, close } = await boot([reply({ say: 'Tell me about your project.' })]);
  try {
    assert.equal((await call('/interviews', 'POST', { ...CFG, mode: 'nope' })).status, 400);
    assert.equal((await call('/interviews', 'POST', { ...CFG, durationMin: 7 })).status, 400);
    assert.equal((await call('/interviews', 'POST', { ...CFG, mode: 'project' })).status, 400);
    assert.equal((await call('/projects', 'POST', { name: 'x', description: 'short' })).status, 400);
    const pid = (await call('/projects', 'POST', { name: 'ChatApp', description: 'A realtime chat app with websockets, redis pubsub and postgres storage.' })).data.id;
    const r = await call('/interviews', 'POST', { ...CFG, mode: 'project', projectId: pid });
    assert.equal(r.status, 200);
  } finally { close(); }
});

test('transcribe endpoint uses injected stt and rejects empty uploads', async () => {
  const stt = { transcribe: async ({ durationSec }) => `heard ${durationSec}s` };
  const { close, db } = await boot([], stt);
  const server = createApp({ db: openDb(':memory:'), llm: fakeLlm([]), stt }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const none = await fetch(`${base}/transcribe`, { method: 'POST', body: new FormData() });
    assert.equal(none.status, 400);
    const form = new FormData();
    form.append('audio', new Blob(['x'], { type: 'audio/webm' }), 'a.webm');
    form.append('duration', '4');
    const ok = await (await fetch(`${base}/transcribe`, { method: 'POST', body: form })).json();
    assert.equal(ok.text, 'heard 4s');
  } finally { server.close(); close(); }
});

test('meta exposes modes, companies and personalities', async () => {
  const { call, close } = await boot([]);
  try {
    const m = (await call('/meta')).data;
    assert.equal(m.modes.length, 7);
    assert.equal(m.companies.length, 10);
    assert.deepEqual(m.positions, ['SDE Intern', 'SDE FTE', 'AI Engineer Intern', 'AI Engineer FTE']);
    assert.deepEqual(m.personalities.map((p) => p.id), ['real', 'strict', 'mentor']);
  } finally { close(); }
});

test('interviewer can only end after a long unanswered streak, never earlier', async () => {
  const stuck = reply({ say: 'Let us try something else.', candidate_stuck: true, end_interview: true });
  const { call, close } = await boot([reply({ say: 'First question.', new_question: true, question_title: 'Q1' }), stuck, stuck, stuck, stuck, stuck]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    const ends = [];
    for (let i = 0; i < 5; i++) ends.push((await call(`/interviews/${id}/turn`, 'POST', { text: '[NO RESPONSE]', elapsedSec: 30 * (i + 1) })).data.endInterview);
    assert.deepEqual(ends, [false, false, false, false, true]);
  } finally { close(); }
});

test('prompt forces a move-on at the follow-up cap and lists covered topics', () => {
  const base = { mode: 'dsa', company: 'google', position: 'SDE Intern', difficulty: 'Medium', personality: 'real', duration_min: 30, style: 'standard' };
  const p = buildSystemPrompt({ interview: base, askedHere: ['Two Sum'], coveredTopics: ['Hashing'], thread: { followups: 3, sat: [4, 4], cap: 3 } });
  assert.ok(p.includes('CAP REACHED') && p.includes('Two Sum') && p.includes('Hashing'));
  assert.ok(!buildSystemPrompt({ interview: base, thread: { followups: 1, sat: [3], cap: 3 } }).includes('CAP REACHED'));
});

test('legacy position name is still accepted', async () => {
  const { call, close } = await boot([reply({ say: 'Hello.' })]);
  try {
    const r = await call('/interviews', 'POST', { ...CFG, position: 'New Grad SDE' });
    assert.equal(r.data.interview.position, 'SDE FTE');
  } finally { close(); }
});

test('stray words are ignored: no model call, no stored message, question unchanged', async () => {
  const { call, llm, close } = await boot([reply({ say: 'First question.', new_question: true, question_title: 'Q1' })]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    for (const t of ['terminate', 'Terminates.', 'okay', 'thank you', 'stop']) {
      const r = await call(`/interviews/${id}/turn`, 'POST', { text: t });
      assert.equal(r.data.ignored, true, t);
    }
    assert.equal(llm.calls.length, 1);
    assert.equal((await call(`/interviews/${id}`)).data.messages.length, 1);
    assert.equal(isStrayInput('O(n)'), false);
    assert.equal(isStrayInput('42'), false);
    assert.equal(isStrayInput('I would use a hash map'), false);
  } finally { close(); }
});

test('model verdict "stray" removes the message and keeps the thread intact', async () => {
  const { call, close } = await boot([
    reply({ say: 'First question.', new_question: true, question_title: 'Q1' }),
    { analysis: 'Noise.', verdict: 'stray', say: '' },
  ]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    const r = await call(`/interviews/${id}/turn`, 'POST', { text: 'subtitles by the amara community' });
    assert.equal(r.data.ignored, true);
    assert.equal((await call(`/interviews/${id}`)).data.messages.length, 1);
  } finally { close(); }
});

test('a premature topic switch triggers one corrective retry for a counter-question', async () => {
  const { call, llm, close } = await boot([
    reply({ say: 'Explain deadlock.', new_question: true, question_title: 'Deadlock', topic: 'Graphs' }),
    reply({ analysis: 'Defined it correctly.', verdict: 'correct', say: 'Now tell me about TCP.', new_question: true, question_title: 'TCP' }),
    reply({ analysis: 'Defined it but gave no example.', verdict: 'partial', say: 'You mentioned circular wait. How would you break it?' }),
  ]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    const r = await call(`/interviews/${id}/turn`, 'POST', { text: 'Processes wait on each other forever, circular wait.', elapsedSec: 60 });
    assert.equal(r.data.say, 'You mentioned circular wait. How would you break it?');
    assert.equal(r.data.newQuestion, false);
    assert.equal(llm.calls.length, 3);
    assert.ok(llm.calls[2].system.includes('CORRECTION'));
    assert.ok(!('analysis' in r.data));
  } finally { close(); }
});

test('weaknesses and focus never leak across modes; the sql session does not shape core cs', async () => {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const sqlId = repo.createInterview({ mode: 'sql', company: 'generic', position: 'SDE FTE', difficulty: 'Medium', personality: 'real', durationMin: 30 });
  repo.saveReport(sqlId, 4, {}, { weaknesses: ['Window functions'] });
  const csId = repo.createInterview({ mode: 'core_cs', company: 'generic', position: 'SDE FTE', difficulty: 'Medium', personality: 'real', durationMin: 30 });
  assert.deepEqual(repo.recentWeaknesses(3, 6, 'core_cs'), []);
  assert.deepEqual(repo.recentWeaknesses(3, 6, 'sql'), ['Window functions']);
  const llm = fakeLlm([reply({ say: 'Hello.' })]);
  const server = createApp({ db, llm }).listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    await fetch(`${base}/interviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...CFG, mode: 'core_cs', company: 'generic' }) });
    assert.ok(!llm.calls[0].system.includes('Window functions'));
    assert.ok(llm.calls[0].system.includes('This interview is independent'));
  } finally { server.close(); }
  assert.ok(csId > sqlId);
});

test('tech mahindra profile injects its question pool; AI roles add role guidance', async () => {
  const { call, llm, close } = await boot([reply({ say: 'Hello.' })]);
  try {
    await call('/interviews', 'POST', { ...CFG, mode: 'core_cs', company: 'techmahindra', position: 'AI Engineer Intern', round: 'Technical interview' });
    const sys = llm.calls[0].system;
    assert.ok(sys.includes('Tech Mahindra') && sys.includes('COMPANY QUESTION POOL'));
    assert.ok(sys.includes('Intern-level AI engineer'));
  } finally { close(); }
});

test('report carries the detailed question breakdown and tolerates a failed second call', async () => {
  const detailed = { question_breakdown: [{ title: 'Two Sum', topic: 'Hashing', verdict: 'partial', score: 6, your_answer: 'Brute force', ideal_answer: 'Hash map, O(n)', what_was_missing: 'No optimisation', optimization: 'Use a map', followup_handling: 'Fair' }, { title: '' }] };
  const { call, close } = await boot([
    reply({ say: 'Q1', new_question: true, question_title: 'Two Sum' }), reply({ say: 'Why?' }), reply({ say: 'Complexity?' }),
    { ...REPORT, strength_evidence: [{ area: 'Framing', evidence: 'Restated the problem' }], improvement_plan: [{ priority: 2, action: 'B' }, { priority: 1, action: 'A', why: 'x', timeframe: 'this week' }] },
    detailed,
  ]);
  try {
    const id = (await call('/interviews', 'POST', CFG)).data.interview.id;
    await call(`/interviews/${id}/turn`, 'POST', { text: 'Brute force with two loops.', elapsedSec: 30 });
    await call(`/interviews/${id}/turn`, 'POST', { text: 'It is quadratic in time and constant in space.', elapsedSec: 60 });
    const r = (await call(`/interviews/${id}/end`, 'POST', { elapsedSec: 90 })).data.report;
    assert.equal(r.question_breakdown.length, 1);
    assert.equal(r.question_breakdown[0].ideal_answer, 'Hash map, O(n)');
    assert.equal(r.improvement_plan[0].action, 'A');
    assert.equal(r.strength_evidence[0].area, 'Framing');
  } finally { close(); }
});

test('auto-pairing behaves like VS Code', () => {
  const k = (value, start, key, end = start, lang = 'javascript') => autoPairEdit({ value, start, end, key, lang });
  assert.deepEqual(k('', 0, '('), { from: 0, to: 0, insert: '()', selStart: 1, selEnd: 1 });
  assert.equal(k('foo', 3, '(').insert, '()');
  assert.equal(k('a(b)', 3, ')').insert, ''); // steps over the closing bracket
  assert.equal(k('a(b)', 3, ')').selStart, 4);
  assert.equal(k('don', 3, "'"), null); // apostrophe inside a word
  assert.equal(k('x = ', 4, '"').insert, '""');
  assert.equal(k('x = ""', 5, '"').selStart, 6); // typing the closing quote
  assert.equal(k('say(hi)', 4, '[', 6).insert, '[hi]'); // wraps a selection
  assert.deepEqual(k('()', 1, 'Backspace'), { from: 0, to: 2, insert: '', selStart: 0, selEnd: 0 });
  assert.equal(k('(a)', 2, 'Backspace'), null);
  const blk = k('if (x) {}', 8, 'Enter');
  assert.equal(blk.insert, '\n    \n');
  assert.equal(blk.selStart, 8 + 1 + 4);
  assert.equal(k('def f():', 8, 'Enter', 8, 'python').insert, '\n    ');
  assert.equal(k('    x = {}', 9, 'Enter').insert, '\n        \n    ');
  assert.equal(k('plain', 5, 'Enter'), null);
  assert.equal(k('it', 2, "'", 2, 'plain'), null);
});
