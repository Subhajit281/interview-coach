// Storage guardrail: a user may retain up to 15 sessions. Once they reach the
// cap they must purge five, returning to ten retained sessions, before starting
// another. This bounds transcript/report storage without deleting user data
// automatically.
export const MAX_RETAINED_INTERVIEWS = 15;
export const PURGE_TO_RETAIN = 10;

const limitError = (total) => {
  const remaining = Math.max(0, total - PURGE_TO_RETAIN);
  return Object.assign(new Error(`Your interview history is full (${total}/${MAX_RETAINED_INTERVIEWS}). Delete ${remaining} previous ${remaining === 1 ? 'interview' : 'interviews'} to continue.`), {
    status: 409,
    code: 'HISTORY_LIMIT',
    publicMessage: `Your interview history is full. Delete ${remaining} previous ${remaining === 1 ? 'interview' : 'interviews'} to continue. Deleting a session permanently removes its transcript and report.`,
    total,
    requiredDelete: remaining,
  });
};

export async function retentionStatus(repo) {
  const state = await repo.interviewRetention();
  const locked = Boolean(state.purgeRequired) || state.total >= MAX_RETAINED_INTERVIEWS;
  return { total: state.total, max: MAX_RETAINED_INTERVIEWS, requiredDelete: locked ? Math.max(0, state.total - PURGE_TO_RETAIN) : 0 };
}

export async function assertCanStartInterview(repo) {
  const state = await repo.interviewRetention();
  if (!state.purgeRequired && state.total < MAX_RETAINED_INTERVIEWS) return;
  const requiredDelete = Math.max(0, state.total - PURGE_TO_RETAIN);
  if (requiredDelete === 0) {
    await repo.setInterviewPurgeRequired(false);
    return;
  }
  await repo.setInterviewPurgeRequired(true);
  throw limitError(state.total);
}

export async function recordInterviewStart(repo) {
  const state = await repo.interviewRetention();
  if (state.total >= MAX_RETAINED_INTERVIEWS) await repo.setInterviewPurgeRequired(true);
}

export async function recordInterviewDeletion(repo, before) {
  const after = await repo.interviewRetention();
  if (before.purgeRequired || before.total >= MAX_RETAINED_INTERVIEWS) {
    await repo.setInterviewPurgeRequired(after.total > PURGE_TO_RETAIN);
  }
}
