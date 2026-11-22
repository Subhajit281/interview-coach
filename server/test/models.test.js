import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/services/llm.js';
import { ProviderError } from '../src/services/http.js';
import { classify, friendly } from '../src/services/providerErrors.js';
import { parseModelPrefs, catalogFor, MODEL_CATALOG } from '../src/data/models.js';

const cfg = (over = {}) => ({
  allowDevelopmentProviderKeys: false,
  groq: { llmModel: 'llama-3.3-70b-versatile', llmFallbackModel: 'openai/gpt-oss-120b' },
  gemini: { model: 'gemini-2.5-flash' },
  ...over,
});
const keys = (extra = {}) => ({ groqKey: 'g', geminiKey: '', models: {}, ...extra });
const quota = (msg = 'Rate limit reached on tokens per day (TPD)') => new ProviderError(`Groq: HTTP 429 ${msg}`, 429, { retryAfterMs: 3600000 });

test('classify separates limits, bad keys and missing models; plain errors stay generic', () => {
  assert.deepEqual(classify(quota()), { kind: 'limit', daily: true });
  assert.equal(classify(new ProviderError('x: HTTP 429 slow down', 429)).daily, false);
  assert.equal(classify(new ProviderError('x: HTTP 401', 401)).kind, 'auth');
  assert.equal(classify(new ProviderError('x: HTTP 404 model not found', 404)).kind, 'unavailable');
  assert.equal(classify(new Error('429')).kind, 'other');
});

test('chosen model replaces the default and its hidden fallback', () => {
  const llm = createLlm({ config: cfg(), groq: {}, gemini: {} });
  const chain = llm.chainFor('groq', keys({ models: { groq: 'llama-3.1-8b-instant' } }));
  assert.deepEqual(chain.map((s) => s.model), ['llama-3.1-8b-instant']);
  assert.deepEqual(llm.chainFor('groq', keys()).map((s) => s.model), ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
});

test('daily limit on the default model raises a readable MODEL_LIMIT error and skips the silent backup', async () => {
  const calls = [];
  const groq = { chat: async ({ model }) => { calls.push(model); throw quota(); } };
  const llm = createLlm({ config: cfg(), groq, gemini: {}, log: { warn() {} } });
  await assert.rejects(llm.chat({ system: 's', messages: [], credentials: keys() }), (e) => {
    assert.equal(e.code, 'MODEL_LIMIT');
    assert.equal(e.status, 429);
    assert.equal(e.provider, 'groq');
    assert.equal(e.model, 'llama-3.3-70b-versatile');
    assert.match(e.publicMessage, /free limit for today/);
    assert.doesNotMatch(e.publicMessage, /HTTP|429|TPD/);
    return true;
  });
  assert.deepEqual(calls, ['llama-3.3-70b-versatile']);
});

test('the other provider still takes over when the user has both keys', async () => {
  const groq = { chat: async () => { throw quota(); } };
  const gemini = { chat: async ({ model }) => ({ text: 'ok', provider: 'gemini', model }) };
  const llm = createLlm({ config: cfg(), groq, gemini, log: { warn() {} } });
  const out = await llm.chat({ system: 's', messages: [], credentials: keys({ geminiKey: 'k', models: { gemini: 'gemini-2.0-flash' } }) });
  assert.equal(out.model, 'gemini-2.0-flash');
});

test('probe and friendly turn a rejected model into a coded error', async () => {
  const groq = { chat: async () => { throw new ProviderError('Groq: HTTP 404 model not found', 404); } };
  const llm = createLlm({ config: cfg(), groq, gemini: {} });
  await assert.rejects(llm.probe({ provider: 'groq', model: 'x', apiKey: 'k' }).catch((e) => { throw friendly(e, 'groq', 'x'); }), (e) => e.code === 'MODEL_UNAVAILABLE');
});

test('model prefs only accept ids from the dropdown list', () => {
  const c = cfg();
  assert.deepEqual(parseModelPrefs(c, JSON.stringify({ groq: 'llama-3.1-8b-instant', gemini: 'gemini-2.0-flash' })), { groq: 'llama-3.1-8b-instant', gemini: 'gemini-2.0-flash' });
  assert.deepEqual(parseModelPrefs(c, undefined), {});
  assert.deepEqual(parseModelPrefs(c, 'not json'), {});
  assert.throws(() => parseModelPrefs(c, JSON.stringify({ groq: 'made-up-model' })), (e) => e.code === 'MODEL_INVALID' && /dropdown/.test(e.publicMessage));
  assert.ok(catalogFor(c).catalog.groq.length === MODEL_CATALOG.groq.length);
});

test('HTTP: a hit limit reaches the browser as a readable, coded error with no provider noise', async () => {
  const { openDb } = await import('../src/db/index.js');
  const { createApp } = await import('../src/app.js');
  const { modelError } = await import('../src/services/providerErrors.js');
  const llm = { chat: async () => { throw modelError('limit', [{ provider: 'groq', model: 'llama-3.3-70b-versatile', kind: 'limit', daily: true }]); } };
  const server = createApp({ db: openDb(':memory:'), llm, stt: {} }).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/interviews`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dsa', company: 'google', position: 'SDE FTE', difficulty: 'Medium', personality: 'real', durationMin: 30, style: 'standard' }),
    });
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(body.code, 'MODEL_LIMIT');
    assert.equal(body.provider, 'groq');
    assert.match(body.error, /Choose another model/);
    assert.doesNotMatch(JSON.stringify(body), /HTTP 429|TPD|rate_limit/);
  } finally { server.close(); }
});
