import { GENERIC_POOL, ANGLES, LEVELS } from '../data/questionPool.js';
import { COMPANIES } from '../data/companies.js';

// Rough minutes one main question takes, per pacing style. Coding and design questions take longer.
const MIN_PER_QUESTION = { rapid: 3, standard: 7, deep: 14 };
const MODE_FACTOR = { dsa: 1.4, system_design: 1.6, project: 1.2, sql: 1.1, ai_ml: 1.1, core_cs: 1, behavioral: 1 };
const LEVEL_ORDER = ['Easy', 'Medium', 'Hard'];

/** How many main questions fit the session. Keeps the interviewer from thinking it has "run out". */
export function planQuestions({ durationMin, style = 'standard', mode }) {
  const per = (MIN_PER_QUESTION[style] || 7) * (MODE_FACTOR[mode] || 1);
  return Math.max(2, Math.round(durationMin / per));
}

/** Difficulty for the next main question. "Mixed" ramps up, and reacts to how the last thread went. */
export function levelFor({ difficulty, askedCount = 0, sat = [] }) {
  if (difficulty !== 'Mixed') return LEVEL_ORDER.includes(difficulty) ? difficulty : 'Medium';
  let i = askedCount === 0 ? 0 : askedCount < 3 ? 1 : 2;
  const recent = sat.slice(-3);
  if (recent.length) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg >= 4) i += 1;
    else if (avg <= 2) i -= 1;
  }
  return LEVEL_ORDER[Math.min(2, Math.max(0, i))];
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Chooses the theme, angle and level for the next main question.
 * - Company-specific themes are three times as likely as generic ones.
 * - Themes used in recent interviews of the same mode (newest first in `recentSeeds`) are suppressed, never-used ones are favoured.
 */
export function pickBlueprint({ mode, company, difficulty, askedCount = 0, sat = [], recentSeeds = [], sessionSeeds = [], rng = Math.random }) {
  const bank = COMPANIES[company]?.bank?.[mode] || [];
  const generic = (GENERIC_POOL[mode] || []).filter((g) => !bank.includes(g));
  const items = [...bank.map((s) => ({ s, base: 3 })), ...generic.map((s) => ({ s, base: 1 }))];

  let seed = '';
  if (items.length) {
    const age = new Map();
    recentSeeds.forEach((s, i) => { if (!age.has(s)) age.set(s, i); });
    const inSession = new Set(sessionSeeds);
    let weights = items.map(({ s, base }) => {
      if (inSession.has(s)) return 0;
      const a = age.has(s) ? age.get(s) : Infinity;
      if (a < 10) return 0;
      return base * (a === Infinity ? 5 : 0.2 + Math.min(a, 120) / 30);
    });
    if (weights.every((w) => w === 0)) weights = items.map(({ s }) => (inSession.has(s) ? 0 : 1)); // pool exhausted: allow repeats, never in-session
    seed = weightedPick(items, weights, rng).s;
  }

  const angles = [...(ANGLES[mode] || []), ...ANGLES.common];
  const angle = angles[Math.floor(rng() * angles.length)];
  const level = levelFor({ difficulty, askedCount, sat });
  const levelText = (LEVELS[mode] || LEVELS.default)[level] || LEVELS.default[level];
  return { seed, angle, level, levelText };
}