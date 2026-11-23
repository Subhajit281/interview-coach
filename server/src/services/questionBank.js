import { extractJson } from './llm.js';
import { MODES } from '../data/modes.js';
import { COMPANIES } from '../data/companies.js';

// Company-wise question cache.
// - Questions are stored per (company, mode, difficulty) and shared by all users, so every interview for a company
//   benefits from what earlier interviews (and one cheap background generation) produced.
// - Only generic question data is stored: title, topic, difficulty and the problem statement. Never answers, never
//   anything the candidate said, never Project Discussion questions.
// - Reads go through an in-memory cache, so picking a question costs no database round-trip on most turns.

const LEVELS = ['Easy', 'Medium', 'Hard'];
const TARGET_PER_COMPANY_MODE = 10; // below this, one background call tops the bank up
const LIST_TTL_MS = 5 * 60_000;
const PREFILL_COOLDOWN_MS = 10 * 60_000;

export const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
const clip = (s, n) => String(s || '').trim().slice(0, n);

/** In-memory store: used for the legacy SQLite dev server and in tests. */
export function createMemoryBank() {
  const rows = [];
  let seq = 0;
  return {
    async list(company, mode) { return rows.filter((r) => r.company === company && r.mode === mode).sort((a, b) => a.uses - b.uses).slice(0, 80); },
    async add(row) {
      if (rows.some((r) => r.company === row.company && r.mode === row.mode && r.titleKey === row.titleKey)) return false;
      rows.push({ id: `m${++seq}`, uses: 0, createdAt: new Date(), ...row });
      return true;
    },
    async use(id) { const r = rows.find((x) => x.id === id); if (r) r.uses += 1; },
    async count(company, mode) { return rows.filter((r) => r.company === company && r.mode === mode).length; },
  };
}

/**
 * Postgres store (Prisma model CachedQuestion). If the Prisma client has not been regenerated or the migration has not
 * been applied yet, it quietly falls back to an in-memory cache and says how to enable the persistent one, instead of
 * failing on every question.
 */
export function createPrismaBank(prisma, { log = console } = {}) {
  const fallback = createMemoryBank();
  let useFallback = false;
  let warned = false;
  const degrade = (why) => {
    useFallback = true;
    if (!warned) { warned = true; log.warn?.(`[bank] using an in-memory question cache (${why}). Run "npx prisma generate" and "npx prisma migrate deploy" to enable the persistent one.`); }
  };
  if (!prisma?.cachedQuestion) degrade('the Prisma client has no CachedQuestion model');
  const guard = async (fn, fb) => {
    if (useFallback) return fb();
    try { return await fn(); }
    catch (e) {
      if (e?.code === 'P2021' || e?.code === 'P2022' || e instanceof TypeError) { degrade(e.code || e.message); return fb(); }
      throw e;
    }
  };
  return {
    list: (company, mode) => guard(() => prisma.cachedQuestion.findMany({ where: { company, mode }, orderBy: [{ uses: 'asc' }, { createdAt: 'desc' }], take: 80 }), () => fallback.list(company, mode)),
    add: (row) => guard(async () => {
      try { await prisma.cachedQuestion.create({ data: row }); return true; }
      catch (e) { if (e?.code === 'P2002') return false; throw e; } // already cached
    }, () => fallback.add(row)),
    use: (id) => guard(() => prisma.cachedQuestion.update({ where: { id }, data: { uses: { increment: 1 } } }).catch(() => {}), () => fallback.use(id)),
    count: (company, mode) => guard(() => prisma.cachedQuestion.count({ where: { company, mode } }), () => fallback.count(company, mode)),
  };
}

export function createQuestionBank({ store, llm = null, prefill = false, now = Date.now, log = console }) {
  const lists = new Map(); // `${company}:${mode}` -> { at, rows }
  const inflight = new Set();
  const cooldown = new Map();
  const keyOf = (company, mode) => `${company}:${mode}`;

  async function cachedList(company, mode) {
    const k = keyOf(company, mode);
    const hit = lists.get(k);
    if (hit && now() - hit.at < LIST_TTL_MS) return hit.rows;
    const rows = await store.list(company, mode);
    lists.set(k, { at: now(), rows });
    return rows;
  }

  /** Best unused question for this company, mode and level (an adjacent level is fine, a distant one is not). */
  async function pick({ company, mode, level = 'Medium', exclude = new Set(), rng = Math.random }) {
    if (mode === 'project') return null;
    const free = (await cachedList(company, mode)).filter((r) => !exclude.has(r.titleKey));
    if (!free.length) return null;
    const dist = (r) => Math.abs(LEVELS.indexOf(r.difficulty) - LEVELS.indexOf(level));
    const best = Math.min(...free.map(dist));
    if (best > 1) return null;
    const pool = free.filter((r) => dist(r) === best);
    const weights = pool.map((r) => 1 / (1 + (r.uses || 0)));
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  /** Saves a question. Duplicates and junk are ignored; never throws. */
  async function capture({ company, mode, level = 'Medium', topic = '', title, spoken = '', board = '', source = 'live' }) {
    try {
      if (mode === 'project' || !MODES[mode]) return false;
      const cleanTitle = clip(title, 120);
      const titleKey = normTitle(cleanTitle);
      if (cleanTitle.length < 6 || !titleKey) return false;
      const ok = await store.add({
        company, mode, difficulty: LEVELS.includes(level) ? level : 'Medium', topic: clip(topic, 80) || null,
        title: cleanTitle, titleKey, spoken: clip(spoken, 900), board: clip(board, 2500), source,
      });
      if (ok) lists.delete(keyOf(company, mode));
      return ok;
    } catch (e) { log.warn?.(`[bank] could not save question: ${e.message}`); return false; }
  }

  function markUsed(row) {
    if (!row?.id) return;
    row.uses = (row.uses || 0) + 1; // keep the cached copy fresh
    Promise.resolve(store.use(row.id)).catch(() => {});
  }

  /**
   * Tops the bank up with company-specific questions in ONE background call, only while it holds fewer than
   * TARGET_PER_COMPANY_MODE questions and at most once per 10 minutes. It runs after the interview has started,
   * never blocks a turn, and never throws.
   */
  async function ensure({ company, mode, credentials = null, delayMs = 0 }) {
    if (!prefill || !llm || mode === 'project' || !MODES[mode] || !COMPANIES[company]) return;
    const k = keyOf(company, mode);
    if (inflight.has(k) || (cooldown.get(k) || 0) > now()) return;
    inflight.add(k);
    const run = async () => {
      try {
        if ((await store.count(company, mode)) >= TARGET_PER_COMPANY_MODE) return;
        cooldown.set(k, now() + PREFILL_COOLDOWN_MS);
        const c = COMPANIES[company], m = MODES[mode];
        const have = (await cachedList(company, mode)).map((r) => r.title).slice(0, 20);
        const themes = (c.bank?.[mode] || []).slice(0, 12);
        const system = [
          `You write interview questions for ${c.name} ${m.label} interviews. Company style: ${c.style}`,
          `Mode guidance: ${m.guidance}`,
          themes.length ? `Company-specific themes to draw on: ${themes.join('; ')}.` : '',
          have.length ? `Do not repeat or paraphrase these existing questions: ${have.join('; ')}.` : '',
          'Return ONLY a JSON object: {"questions":[{"title": string (max 80 chars, unique), "topic": string (one of: ' + m.topics.join(', ') + '), "level": "Easy"|"Medium"|"Hard", "spoken": string (the question exactly as an interviewer would say it aloud: 2-5 sentences that state the real problem; no solution, no code), "board": string (constraints and examples, or "")}]}',
          `Write 6 questions: 2 Easy, 2 Medium, 2 Hard. They must feel realistic for ${c.name}, differ clearly from each other, and contain no answers or solutions.`,
        ].filter(Boolean).join('\n');
        const res = await llm.chat({ system, messages: [{ role: 'user', content: 'Generate the questions.' }], json: false, maxTokens: 2200, temperature: 0.9, timeoutMs: 30_000, retries: 0, credentials });
        const list = extractJson(res.text)?.questions;
        if (!Array.isArray(list)) return;
        for (const q of list.slice(0, 8)) {
          if (typeof q?.title !== 'string' || typeof q?.spoken !== 'string' || q.spoken.trim().length < 30) continue;
          const level = LEVELS.find((l) => l.toLowerCase() === String(q.level).toLowerCase()) || 'Medium';
          await capture({ company, mode, level, topic: q.topic, title: q.title, spoken: q.spoken, board: q.board, source: 'generated' });
        }
      } catch (e) { log.warn?.(`[bank] prefill skipped: ${e.message}`); }
      finally { inflight.delete(k); }
    };
    if (delayMs > 0) { const t = setTimeout(run, delayMs); t.unref?.(); return; }
    await run();
  }

  return { pick, capture, markUsed, ensure };
}
