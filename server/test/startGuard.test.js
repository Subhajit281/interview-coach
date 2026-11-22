import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartGuard, validStartKey } from '../src/services/startGuard.js';

test('start guard shares one in-flight operation for an idempotency key', async () => {
  const guard = createStartGuard();
  let calls = 0;
  const work = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 5)); return { id: 1 }; };
  const [a, b] = await Promise.all([guard.run('user:key', work), guard.run('user:key', work)]);
  assert.deepEqual(a, { id: 1 });
  assert.deepEqual(b, { id: 1 });
  assert.equal(calls, 1);
});

test('start keys accept UUID-like values and reject malformed headers', () => {
  assert.equal(validStartKey('51f14516-3e95-4475-9b8f-933566837cc1'), '51f14516-3e95-4475-9b8f-933566837cc1');
  assert.equal(validStartKey('short'), null);
  assert.equal(validStartKey('spaces are not allowed'), null);
});
