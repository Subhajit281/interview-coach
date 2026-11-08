export function createRepo(db) {
  // Prepared statements are compiled once and reused.
  const cache = new Map();
  const q = (sql) => {
    let st = cache.get(sql);
    if (!st) { st = db.prepare(sql); cache.set(sql, st); }
    return st;
  };
  const id = (r) => Number(r.lastInsertRowid);

  return {
    // projects
    addProject: (name, description) => id(q('INSERT INTO projects (name, description) VALUES (?, ?)').run(name, description)),
    listProjects: () => q('SELECT id, name, substr(description, 1, 200) AS preview, created_at FROM projects ORDER BY id DESC').all(),
    getProject: (pid) => q('SELECT * FROM projects WHERE id = ?').get(pid) ?? null,
    deleteProject: (pid) => q('DELETE FROM projects WHERE id = ?').run(pid),

    // interviews
    createInterview: (c) => id(q(
      `INSERT INTO interviews (mode, company, position, round, style, difficulty, personality, duration_min, project_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(c.mode, c.company, c.position, c.round ?? '', c.style ?? 'standard', c.difficulty, c.personality, c.durationMin, c.projectId ?? null)),
    getInterview: (iid) => q('SELECT * FROM interviews WHERE id = ?').get(iid) ?? null,
    listInterviews: () => q(
      `SELECT i.*, r.overall_score FROM interviews i LEFT JOIN reports r ON r.interview_id = i.id ORDER BY i.id DESC LIMIT 200`,
    ).all(),
    setStatus: (iid, status) => q('UPDATE interviews SET status = ? WHERE id = ?').run(status, iid),
    finishInterview: (iid, status, elapsedSec) => q(
      `UPDATE interviews SET status = ?, elapsed_sec = ?, ended_at = datetime('now') WHERE id = ?`,
    ).run(status, Math.max(0, Math.round(elapsedSec || 0)), iid),
    deleteInterview: (iid) => q('DELETE FROM interviews WHERE id = ?').run(iid),

    // messages
    addMessage: (iid, role, content, board = null, meta = null) =>
      id(q('INSERT INTO messages (interview_id, role, content, board, meta) VALUES (?,?,?,?,?)').run(iid, role, content, board || null, meta ? JSON.stringify(meta) : null)),
    deleteMessage: (mid) => q('DELETE FROM messages WHERE id = ?').run(mid),
    getMessages: (iid, limit = null) => limit
      ? q(`SELECT * FROM (SELECT * FROM messages WHERE interview_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`).all(iid, limit)
      : q('SELECT * FROM messages WHERE interview_id = ? ORDER BY id ASC').all(iid),
    lastMessage: (iid) => q('SELECT * FROM messages WHERE interview_id = ? ORDER BY id DESC LIMIT 1').get(iid) ?? null,

    // questions
    addQuestion: (iid, mode, topic, title, difficulty) =>
      id(q('INSERT INTO questions_asked (interview_id, mode, topic, title, difficulty) VALUES (?,?,?,?,?)').run(iid, mode, topic || '', title, difficulty)),
    bumpHint: (iid) => q(
      `UPDATE questions_asked SET hints_used = hints_used + 1
       WHERE id = (SELECT id FROM questions_asked WHERE interview_id = ? ORDER BY id DESC LIMIT 1)`,
    ).run(iid),
    questionsFor: (iid) => q('SELECT * FROM questions_asked WHERE interview_id = ? ORDER BY id').all(iid),
    setQuestionResult: (qid, solved, hints) => q('UPDATE questions_asked SET solved = ?, hints_used = ? WHERE id = ?').run(solved ? 1 : 0, hints, qid),
    interviewQuestions: (iid) => q('SELECT topic, title FROM questions_asked WHERE interview_id = ? ORDER BY id').all(iid),
    recentQuestionTitles: (mode, limit = 25) =>
      q('SELECT title FROM questions_asked WHERE mode = ? ORDER BY id DESC LIMIT ?').all(mode, limit).map((r) => r.title),

    // reports + stats
    saveReport: (iid, overall, scores, report) => q(
      `INSERT OR REPLACE INTO reports (interview_id, overall_score, scores_json, report_json) VALUES (?,?,?,?)`,
    ).run(iid, overall, JSON.stringify(scores), JSON.stringify(report)),
    getReport: (iid) => {
      const r = q('SELECT * FROM reports WHERE interview_id = ?').get(iid);
      return r ? { ...JSON.parse(r.report_json), overall_score: r.overall_score, categories: JSON.parse(r.scores_json), created_at: r.created_at } : null;
    },
    upsertTopicStat: (key, score, hints = 0) => q(
      `INSERT INTO topic_stats (topic, attempts, avg_score, hints_total, last_seen) VALUES (?, 1, ?, ?, datetime('now'))
       ON CONFLICT(topic) DO UPDATE SET
         avg_score = (avg_score * attempts + excluded.avg_score) / (attempts + 1),
         attempts = attempts + 1,
         hints_total = hints_total + excluded.hints_total,
         last_seen = datetime('now')`,
    ).run(key, score, hints),
    topicStats: (prefix = null) => (prefix
      ? q('SELECT * FROM topic_stats WHERE instr(topic, ?) = 1').all(`${prefix}:`)
      : q('SELECT * FROM topic_stats').all()),
    // With a mode, only reports of that mode count: weaknesses from a SQL session must not steer a Core CS session.
    recentWeaknesses: (reports = 3, max = 6, mode = null) => {
      const rows = mode
        ? q('SELECT r.report_json FROM reports r JOIN interviews i ON i.id = r.interview_id WHERE i.mode = ? ORDER BY r.id DESC LIMIT ?').all(mode, reports)
        : q('SELECT report_json FROM reports ORDER BY id DESC LIMIT ?').all(reports);
      const out = [];
      for (const r of rows) {
        try { out.push(...(JSON.parse(r.report_json).weaknesses ?? [])); } catch { /* ignore */ }
      }
      return [...new Set(out)].slice(0, max);
    },
    overview: () => {
      const o = q('SELECT COUNT(*) AS n, AVG(overall_score) AS avg FROM reports').get();
      const trend = q(
        `SELECT r.interview_id AS id, r.overall_score AS score, i.mode, i.company, i.started_at
         FROM reports r JOIN interviews i ON i.id = r.interview_id ORDER BY r.id DESC LIMIT 12`,
      ).all().reverse();
      const clean = q('SELECT COUNT(*) AS n FROM questions_asked WHERE solved = 1 AND hints_used = 0').get().n;
      const assisted = q('SELECT COUNT(*) AS n FROM questions_asked WHERE hints_used > 0').get().n;
      return { reports: o.n, avgScore: o.avg == null ? null : Math.round(o.avg * 10) / 10, trend, solvedWithoutHints: clean, neededHints: assisted };
    },
  };
}

/** Weighted topic choice: weaker / unseen topics are likelier. Deterministic when rng is seeded. */
export function pickFocus(topics, statRows, mode, n, rng = Math.random) {
  const stats = new Map(statRows.map((r) => [r.topic, r]));
  const weights = topics.map((t) => {
    const s = stats.get(`${mode}:${t}`);
    if (!s) return 2;
    const hintPenalty = Math.min(1.5, (s.hints_total / Math.max(1, s.attempts)) * 0.5);
    return 1 + (10 - s.avg_score) / 3 + hintPenalty;
  });
  const pool = topics.map((t, i) => ({ t, w: weights[i] }));
  const picked = [];
  while (picked.length < Math.min(n, pool.length)) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = rng() * total;
    const idx = pool.findIndex((p) => (r -= p.w) <= 0);
    picked.push(pool.splice(idx === -1 ? pool.length - 1 : idx, 1)[0].t);
  }
  return picked;
}

export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
