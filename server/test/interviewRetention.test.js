import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanStartInterview, recordInterviewDeletion, recordInterviewStart, retentionStatus } from '../src/services/interviewRetention.js';

function repo(total = 0, purgeRequired = false) {
  return {
    total, purgeRequired,
    async interviewRetention() { return { total: this.total, purgeRequired: this.purgeRequired }; },
    async setInterviewPurgeRequired(value) { this.purgeRequired = value; },
  };
}

test('a fifteenth retained interview starts the five-deletion retention lock', async () => {
  const r = repo(14);
  await assertCanStartInterview(r);
  r.total++;
  await recordInterviewStart(r);
  assert.equal(r.purgeRequired, true);
  assert.deepEqual(await retentionStatus(r), { total: 15, max: 15, requiredDelete: 5 });
});

test('the history lock requires deleting five sessions before another start', async () => {
  const r = repo(15, true);
  await assert.rejects(assertCanStartInterview(r), (e) => e.code === 'HISTORY_LIMIT' && e.requiredDelete === 5);
  while (r.total > 10) {
    const before = await r.interviewRetention();
    r.total--;
    await recordInterviewDeletion(r, before);
  }
  assert.equal(r.purgeRequired, false);
  await assertCanStartInterview(r);
  assert.deepEqual(await retentionStatus(r), { total: 10, max: 15, requiredDelete: 0 });
});
