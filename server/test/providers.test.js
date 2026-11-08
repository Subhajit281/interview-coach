import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroq } from '../src/services/groq.js';
import { createGemini, toContents } from '../src/services/gemini.js';
import { createLlm, extractJson } from '../src/services/llm.js';
import { isLikelyHallucination } from '../src/services/stt.js';

const cfg = (over = {}) => ({
  groq: { apiKey: 'g', sttModel: 'whisper-large-v3-turbo', sttLanguage: 'en', llmModel: 'llama-3.3-70b-versatile', llmFallbackModel: 'openai/gpt-oss-120b', ...over.groq },
  gemini: { apiKey: 'm', model: 'gemini-2.5-flash', ...over.gemini },
});
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

test('groq chat sends auth, json mode and gpt-oss reasoning_effort', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return json({ choices: [{ message: { content: '{"say":"hi"}' } }] }); };
  const groq = createGroq({ config: cfg(), fetchImpl });
  const out = await groq.chat({ model: 'openai/gpt-oss-120b', system: 'S', messages: [{ role: 'user', content: 'u' }], json: true });
  assert.equal(out.text, '{"say":"hi"}');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].init.headers.Authorization, 'Bearer g');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.messages[0].role, 'system');
});

test('groq transcribe posts multipart with model and language', async () => {
  let form;
  const fetchImpl = async (_u, init) => { form = init.body; return json({ text: ' hello world ' }); };
  const groq = createGroq({ config: cfg(), fetchImpl });
  const text = await groq.transcribe({ buffer: Buffer.from('abc'), mime: 'audio/webm' });
  assert.equal(text, 'hello world');
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  assert.equal(form.get('language'), 'en');
  assert.ok(form.get('file') instanceof Blob);
});

test('gemini merges same-role turns and starts with a user turn', () => {
  const c = toContents([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }]);
  assert.equal(c[0].role, 'user');
  assert.equal(c[2].parts[0].text, 'b\n\nc');
});

test('gemini chat reads candidate text and errors on empty', async () => {
  const ok = createGemini({ config: cfg(), fetchImpl: async () => json({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }) });
  assert.equal((await ok.chat({ model: 'gemini-2.5-flash', system: 's', messages: [{ role: 'user', content: 'u' }] })).text, 'x');
  const empty = createGemini({ config: cfg(), fetchImpl: async () => json({ candidates: [{ finishReason: 'SAFETY' }] }) });
  await assert.rejects(empty.chat({ model: 'gemini-2.5-flash', system: 's', messages: [{ role: 'user', content: 'u' }] }), /SAFETY/);
});

test('llm router falls through groq primary -> groq fallback -> gemini', async () => {
  const calls = [];
  const groq = { chat: async ({ model }) => { calls.push(model); if (model !== 'never') throw new Error('429'); } };
  const gemini = { chat: async ({ model }) => { calls.push(model); return { text: 'ok', provider: 'gemini', model }; } };
  const llm = createLlm({ config: cfg(), groq, gemini, log: { warn() {} } });
  const out = await llm.chat({ system: 's', messages: [] });
  assert.equal(out.provider, 'gemini');
  assert.deepEqual(calls, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'gemini-2.5-flash']);
});

test('llm router prefers gemini when asked, and errors clearly with no keys', async () => {
  const calls = [];
  const gemini = { chat: async ({ model }) => { calls.push(model); return { text: 'ok', provider: 'gemini', model }; } };
  const llm = createLlm({ config: cfg(), groq: {}, gemini });
  await llm.chat({ system: 's', messages: [], prefer: 'gemini' });
  assert.deepEqual(calls, ['gemini-2.5-flash']);
  const none = createLlm({ config: cfg({ groq: { apiKey: '' }, gemini: { apiKey: '' } }), groq: {}, gemini: {} });
  await assert.rejects(none.chat({ system: 's', messages: [] }), /No LLM provider configured/);
});

test('llm router dedupes identical in-flight requests', async () => {
  let n = 0;
  const groq = { chat: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { text: 'x', provider: 'groq', model: 'm' }; } };
  const llm = createLlm({ config: cfg({ gemini: { apiKey: '' } }), groq, gemini: {} });
  await Promise.all([llm.chat({ system: 's', messages: [], dedupeKey: 'k' }), llm.chat({ system: 's', messages: [], dedupeKey: 'k' })]);
  assert.equal(n, 1);
});

test('extractJson handles fences and prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure: {"a":2} done'), { a: 2 });
  assert.equal(extractJson('nope'), null);
});

test('whisper hallucination filter only drops short, silent-looking clips', () => {
  assert.equal(isLikelyHallucination('Thank you.', 1.2), true);
  assert.equal(isLikelyHallucination('Thank you.', 8), false);
  assert.equal(isLikelyHallucination('I would use a hash map', 2), false);
  assert.equal(isLikelyHallucination('', 5), true);
});

test('stt skips Whisper when the browser heard no real voice, and drops vocabulary echoes', async () => {
  const { createStt, isPromptEcho } = await import('../src/services/stt.js');
  let calls = 0;
  const groq = { transcribe: async () => { calls++; return 'array hash map two pointers sliding window binary search'; } };
  const stt = createStt({ config: { groq: { apiKey: 'k' } }, groq });
  const buffer = Buffer.alloc(5000);
  assert.equal(await stt.transcribe({ buffer, mime: 'audio/webm', durationSec: 6, voicedSec: 0.2 }), '');
  assert.equal(calls, 0);
  assert.equal(await stt.transcribe({ buffer, mime: 'audio/webm', durationSec: 6, voicedSec: 1.0 }), '');
  assert.equal(isPromptEcho('I would use a hash map and two pointers'), false);
});
