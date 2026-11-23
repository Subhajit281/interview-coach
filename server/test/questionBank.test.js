import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionBank, createMemoryBank, normTitle } from '../src/services/questionBank.js';
import { buildSystemPrompt } from '../src/services/prompts.js';

const quiet = { warn() {} };
const make = (extra = {}) => createQuestionBank({ store: createMemoryBank(), log: quiet, ...extra });

test('bank dedupes by normalized title, never stores project questions, and rejects junk', async () => {
  const bank = make();
  assert.equal(await bank.capture({ company: 'google', mode: 'dsa', level: 'Hard', title: 'Word Ladder II' }), true);
  assert.equal(await bank.capture({ company: 'google', mode: 'dsa', level: 'Hard', title: 'word   ladder ii!' }), false);
  assert.equal(await bank.capture({ company: 'google', mode: 'project', title: 'My project question' }), false);
  assert.equal(await bank.capture({ company: 'google', mode: 'dsa', title: 'abc' }), false);
});

test('pick is company-wise, honours the level and the exclusion list, and never serves a distant level', async () => {
  const bank = make();
  await bank.capture({ company: 'google', mode: 'dsa', level: 'Medium', title: 'Meeting Rooms Scheduler' });
  await bank.capture({ company: 'amazon', mode: 'dsa', level: 'Medium', title: 'Warehouse Robot Paths' });
  const g = await bank.pick({ company: 'google', mode: 'dsa', level: 'Medium' });
  assert.equal(g.title, 'Meeting Rooms Scheduler');
  assert.equal(await bank.pick({ company: 'google', mode: 'dsa', level: 'Medium', exclude: new Set([normTitle('Meeting Rooms Scheduler')]) }), null);
  assert.equal(await bank.pick({ company: 'google', mode: 'dsa', level: 'Hard' }) !== null, true); // adjacent level is fine
  const hard = make();
  await hard.capture({ company: 'google', mode: 'dsa', level: 'Hard', title: 'Some Hard Problem' });
  assert.equal(await hard.pick({ company: 'google', mode: 'dsa', level: 'Easy' }), null); // two levels away is not
});

test('prefill makes one background call, stores only valid questions, then respects the cooldown', async () => {
  let calls = 0;
  const llm = { chat: async () => { calls++; return { text: JSON.stringify({ questions: [
    { title: 'Design a rate limiter for ads API', topic: 'Hashing', level: 'medium', spoken: 'Design a rate limiter that protects an ads API from bursts while staying fair across advertisers.', board: 'Constraints: 50k rps.' },
    { title: 'Too short', spoken: 'x' },
    { title: 'Missing spoken text entirely' },
  ] }) }; } };
  const bank = make({ llm, prefill: true });
  await bank.ensure({ company: 'google', mode: 'dsa' });
  await bank.ensure({ company: 'google', mode: 'dsa' }); // inside the cooldown: no second call
  assert.equal(calls, 1);
  const q = await bank.pick({ company: 'google', mode: 'dsa', level: 'Medium' });
  assert.equal(q.title, 'Design a rate limiter for ads API');
  assert.equal(q.source, 'generated');
  const off = make({ llm, prefill: false });
  await off.ensure({ company: 'google', mode: 'dsa' });
  assert.equal(calls, 1); // prefill disabled (dev SQLite server and tests)
});

test('the prompt carries the company bank question and asks for its exact title', () => {
  const base = { id: 3, mode: 'dsa', company: 'google', position: 'SDE Intern', difficulty: 'Medium', personality: 'real', duration_min: 30, style: 'standard', round: 'Technical' };
  const p = buildSystemPrompt({ interview: base, bankQuestion: { title: 'Meeting Rooms Scheduler', difficulty: 'Medium', topic: 'Intervals', spoken: 'Given meeting times, find the minimum rooms.', board: '' } });
  assert.ok(p.includes('COMPANY QUESTION BANK') && p.includes('question_title to exactly "Meeting Rooms Scheduler"'));
  assert.ok(!buildSystemPrompt({ interview: base }).includes('COMPANY QUESTION BANK'));
});

test('prisma bank falls back to memory (with one warning) when the client has no CachedQuestion model', async () => {
  const { createPrismaBank } = await import('../src/services/questionBank.js');
  const warnings = [];
  const bank = createQuestionBank({ store: createPrismaBank({}, { log: { warn: (m) => warnings.push(m) } }), log: quiet });
  assert.equal(await bank.capture({ company: 'google', mode: 'dsa', level: 'Medium', title: 'Meeting Rooms Scheduler' }), true);
  assert.equal((await bank.pick({ company: 'google', mode: 'dsa', level: 'Medium' })).title, 'Meeting Rooms Scheduler');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /prisma generate/);
});
