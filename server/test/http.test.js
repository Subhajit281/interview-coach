import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, ProviderError } from '../src/services/http.js';

const noSleep = async () => {};
const res = (status, body = '{}', headers = {}) => new Response(body, { status, headers });

test('retries 429 honoring short retry-after, then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls < 3 ? res(429, 'slow down', { 'retry-after': '1' }) : res(200));
  const r = await fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep });
  assert.equal(r.status, 200);
  assert.equal(calls, 3);
});

test('gives up immediately when retry-after is long (daily quota) so caller can fall back', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return res(429, 'daily limit', { 'retry-after': '3600' }); };
  await assert.rejects(fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep }), (e) => e instanceof ProviderError && e.status === 429);
  assert.equal(calls, 1);
});

test('does not retry client errors', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return res(400, 'bad'); };
  await assert.rejects(fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep }), /HTTP 400/);
  assert.equal(calls, 1);
});

test('retries network errors then throws', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('ECONNRESET'); };
  await assert.rejects(fetchWithRetry('http://x', {}, { fetchImpl, sleep: noSleep, retries: 2 }), /network error/);
  assert.equal(calls, 3);
});
