/**
 * Coalesces duplicate HTTP submissions for one interview start key.
 * The persistent key on InterviewSession covers restarts; this small in-memory
 * guard covers the interval before the first question has been stored.
 */
export function createStartGuard() {
  const pending = new Map();
  return {
    run(key, work) {
      if (!key) return work();
      if (pending.has(key)) return pending.get(key);
      const task = Promise.resolve().then(work).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}

export function validStartKey(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{16,128}$/.test(value) ? value : null;
}
