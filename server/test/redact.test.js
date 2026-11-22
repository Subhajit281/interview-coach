import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/utils/redact.js';

test('diagnostic logging redacts common credential forms', () => {
  const text = redactSecrets('HTTP 401 Authorization: Bearer secret-value api_key=also-secret password: no-leaks');
  assert.ok(!text.includes('secret-value'));
  assert.ok(!text.includes('also-secret'));
  assert.ok(!text.includes('no-leaks'));
  assert.match(text, /\[REDACTED\]/);
});
