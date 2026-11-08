import { extractJson } from './llm.js';
import { EVAL_SYSTEM, EVAL_QUESTIONS_SYSTEM } from './prompts.js';

const CATEGORY_KEYS = [
  'problem_understanding', 'approach_selection', 'technical_knowledge', 'algorithmic_reasoning', 'code_correctness',
  'time_complexity', 'space_complexity', 'edge_case_handling', 'communication', 'confidence_clarity',
];

const clamp = (n) => Math.max(0, Math.min(10, Math.round(Number(n) * 10) / 10));
const arr = (v) => (Array.isArray(v) ? v : []);
const strs = (v, max = 10) => arr(v).filter((x) => typeof x === 'string' && x.trim()).slice(0, max);

export function normalizeReport(raw) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const categories = {};
  for (const k of CATEGORY_KEYS) {
    const v = j.categories?.[k];
    categories[k] = v == null || Number.isNaN(Number(v)) ? null : clamp(v);
  }
  const scored = Object.values(categories).filter((v) => v != null);
  let overall = Number(j.overall_score);
  if (Number.isNaN(overall)) overall = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
  return {
    overall_score: clamp(overall),
    hire_recommendation: typeof j.hire_recommendation === 'string' ? j.hire_recommendation : 'Lean No Hire',
    categories,
    strengths: strs(j.strengths),
    weaknesses: strs(j.weaknesses),
    mistakes: arr(j.mistakes).slice(0, 12).map((m) => ({
      what: String(m?.what ?? ''), why_wrong: String(m?.why_wrong ?? ''), correct: String(m?.correct ?? ''),
    })).filter((m) => m.what),
    recommended_topics: strs(j.recommended_topics),
    practice_problems: arr(j.practice_problems).slice(0, 8).map((p) => ({
      title: String(p?.title ?? ''), platform: String(p?.platform ?? ''), topic: String(p?.topic ?? ''),
    })).filter((p) => p.title),
    signal_notes: String(j.signal_notes ?? ''),
    topic_scores: arr(j.topic_scores).map((t) => ({
      topic: String(t?.topic ?? ''), score: clamp(t?.score ?? 0), hints_used: Math.max(0, Math.round(Number(t?.hints_used) || 0)),
    })).filter((t) => t.topic),
    question_results: arr(j.question_results).map((q) => ({
      title: String(q?.title ?? ''), solved: q?.solved === true, hints_used: Math.max(0, Math.round(Number(q?.hints_used) || 0)),
    })).filter((q) => q.title),
    final_assessment: String(j.final_assessment ?? ''),
    strength_evidence: arr(j.strength_evidence).slice(0, 8).map((x) => ({ area: String(x?.area ?? ''), evidence: String(x?.evidence ?? '') })).filter((x) => x.area),
    weakness_analysis: arr(j.weakness_analysis).slice(0, 8).map((x) => ({
      area: String(x?.area ?? ''), evidence: String(x?.evidence ?? ''), impact: String(x?.impact ?? ''), fix: String(x?.fix ?? ''),
    })).filter((x) => x.area),
    improvement_plan: arr(j.improvement_plan).slice(0, 10).map((x, i) => ({
      priority: Math.max(1, Math.round(Number(x?.priority) || i + 1)), action: String(x?.action ?? ''), why: String(x?.why ?? ''), timeframe: String(x?.timeframe ?? ''),
    })).filter((x) => x.action).sort((a, b) => a.priority - b.priority),
    communication_feedback: String(j.communication_feedback ?? ''),
    readiness: String(j.readiness ?? ''),
    question_breakdown: normalizeBreakdown(j.question_breakdown),
  };
}

const VERDICTS = ['correct', 'partial', 'incorrect', 'not_answered'];
export function normalizeBreakdown(v) {
  return arr(v).slice(0, 15).map((q) => ({
    title: String(q?.title ?? ''),
    topic: String(q?.topic ?? ''),
    verdict: VERDICTS.includes(q?.verdict) ? q.verdict : 'partial',
    score: clamp(q?.score ?? 0),
    your_answer: String(q?.your_answer ?? ''),
    ideal_answer: String(q?.ideal_answer ?? ''),
    what_was_missing: String(q?.what_was_missing ?? ''),
    optimization: String(q?.optimization ?? ''),
    followup_handling: String(q?.followup_handling ?? ''),
  })).filter((q) => q.title);
}

export function buildTranscript(messages, maxChars = 30000) {
  const lines = messages.map((m) => {
    const who = m.role === 'candidate' ? 'CANDIDATE' : 'INTERVIEWER';
    let c = m.content.length > 2500 ? `${m.content.slice(0, 2500)} [truncated]` : m.content;
    if (m.board) c += `\n[BOARD: ${m.board.slice(0, 800)}]`;
    if (m.role === 'interviewer' && m.meta) {
      try {
        const n = JSON.parse(m.meta);
        if (n.analysis && n.verdict && n.verdict !== 'none') c += `\n[INTERVIEWER NOTE on the previous candidate answer, verdict ${n.verdict}: ${n.analysis}]`;
      } catch { /* ignore */ }
    }
    return `${who}: ${c}`;
  });
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = `[earlier part omitted]\n…${text.slice(text.length - maxChars)}`;
  return text;
}

export function createEvaluator({ repo, llm }) {
  async function evaluate(interviewId) {
    const iv = repo.getInterview(interviewId);
    const messages = repo.getMessages(interviewId);
    const candidateTurns = messages.filter((m) => m.role === 'candidate').length;
    const header =
      `Interview: ${iv.mode}, company style ${iv.company}, ${iv.position}, difficulty ${iv.difficulty}, personality ${iv.personality}, ` +
      `${Math.round(iv.elapsed_sec / 60)} of ${iv.duration_min} min used, ${candidateTurns} candidate turns.\n` +
      `Questions asked: ${repo.questionsFor(interviewId).map((q) => q.title).join('; ') || 'unknown'}\n\nTRANSCRIPT:\n`;

    const input = [{ role: 'user', content: header + buildTranscript(messages) }];
    const call = (system, key) => llm.chat({ prefer: 'gemini', system, messages: input, json: true, maxTokens: 7000, temperature: 0.2, dedupeKey: `eval:${key}:${interviewId}` });
    // Two smaller calls in parallel are faster and far less likely to be cut off than one huge JSON document.
    const [main, qs] = await Promise.allSettled([call(EVAL_SYSTEM, 'main'), call(EVAL_QUESTIONS_SYSTEM, 'questions')]);
    if (main.status === 'rejected') throw main.reason;
    const parsed = extractJson(main.value.text);
    if (!parsed) throw new Error('Evaluator returned invalid JSON. Try ending the interview again.');
    const res = main.value;
    const report = normalizeReport(parsed);
    const breakdown = qs.status === 'fulfilled' ? extractJson(qs.value.text) : null;
    if (breakdown) report.question_breakdown = normalizeBreakdown(breakdown.question_breakdown);
    else report.breakdown_missing = true;
    report.evaluated_by = `${res.provider}/${res.model}`;

    repo.saveReport(interviewId, report.overall_score, report.categories, report);
    for (const t of report.topic_scores) repo.upsertTopicStat(`${iv.mode}:${t.topic}`, t.score, t.hints_used);
    const asked = repo.questionsFor(interviewId);
    for (const r of report.question_results) {
      const match = asked.find((q) => q.title.toLowerCase() === r.title.toLowerCase());
      if (match) repo.setQuestionResult(match.id, r.solved, r.hints_used);
    }
    return repo.getReport(interviewId);
  }
  return { evaluate };
}
