// In-memory usage/rate-limit tracker (resets on server restart; Groq's own headers are the source of truth).
export function createUsageTracker({ sttDailyBudgetSec = 28800 } = {}) {
  const limits = new Map(); // "provider/model" -> header snapshot
  const counters = { day: today(), sttSeconds: 0, sttRequests: 0, llmRequests: 0 };

  function today() { return new Date().toISOString().slice(0, 10); }
  function roll() { if (counters.day !== today()) Object.assign(counters, { day: today(), sttSeconds: 0, sttRequests: 0, llmRequests: 0 }); }

  return {
    record(provider, model, headers) {
      roll();
      counters.llmRequests += 1;
      const g = (k) => headers?.get?.(k) ?? null;
      if (provider === 'groq' && headers) {
        limits.set(`${provider}/${model}`, {
          remainingRequests: g('x-ratelimit-remaining-requests'),
          remainingTokens: g('x-ratelimit-remaining-tokens'),
          resetRequests: g('x-ratelimit-reset-requests'),
          resetTokens: g('x-ratelimit-reset-tokens'),
          at: new Date().toISOString(),
        });
      }
    },
    recordStt(seconds) {
      roll();
      counters.sttRequests += 1;
      counters.sttSeconds += Math.max(0, Number(seconds) || 0);
    },
    snapshot() {
      roll();
      return {
        ...counters,
        sttDailyBudgetSec,
        sttBudgetUsedPct: Math.round((counters.sttSeconds / sttDailyBudgetSec) * 100),
        limits: Object.fromEntries(limits),
      };
    },
  };
}
