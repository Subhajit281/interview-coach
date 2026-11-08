import { extractJson } from './llm.js';
import { MODES } from '../data/modes.js';
import { COMPANIES } from '../data/companies.js';
import { buildSystemPrompt } from './prompts.js';
import { pickFocus, seededRng } from './repo.js';
import { ProviderError } from './http.js';
import { isStrayInput } from './stray.js';

const MAX_CANDIDATE_CHARS = 4000;
export const NO_RESPONSE = '[NO RESPONSE]';
export const MAX_STRIKES = 5;
const FOLLOWUP_CAP = { standard: 3, rapid: 2, deep: 6 };
// Minimum counter-questions on a question before the interviewer may switch to a new one.
const MIN_PROBES = { standard: 2, rapid: 1, deep: 3 };
const VERDICTS = new Set(['correct', 'partial', 'incorrect', 'unclear', 'off_topic', 'stray', 'none']);

function parseMeta(m) {
  try { return m.meta ? JSON.parse(m.meta) : null; } catch { return null; }
}

/** History for the model. Only the latest board is resent (older boards just cost tokens). */
function toLlmMessages(history) {
  let lastBoard = -1;
  history.forEach((m, i) => { if (m.role === 'interviewer' && m.board) lastBoard = i; });
  return history.map((m, i) => {
    if (m.role === 'candidate') {
      if (m.content === NO_RESPONSE) return { role: 'user', content: NO_RESPONSE };
      const c = m.content.length > MAX_CANDIDATE_CHARS ? `${m.content.slice(0, MAX_CANDIDATE_CHARS)}\n[truncated]` : m.content;
      return { role: 'user', content: c };
    }
    const meta = parseMeta(m);
    const payload = { analysis: meta?.analysis ?? '', verdict: meta?.verdict ?? 'none', say: m.content };
    if (m.board && i === lastBoard) payload.board = m.board;
    return { role: 'assistant', content: JSON.stringify(payload) };
  });
}

export function parseInterviewerReply(raw) {
  const j = extractJson(raw);
  const say = typeof j?.say === 'string' ? j.say.trim() : null;
  const verdict = typeof j?.verdict === 'string' && VERDICTS.has(j.verdict.trim().toLowerCase()) ? j.verdict.trim().toLowerCase() : '';
  const analysis = typeof j?.analysis === 'string' ? j.analysis.trim().slice(0, 600) : '';
  if (!j || (!say && verdict !== 'stray')) {
    // Model ignored the JSON contract: speak the plain text rather than failing the turn.
    const plain = String(raw || '').replace(/[`*#]/g, '').trim();
    return { say: plain || 'Could you say that again?', analysis: '', verdict: '', board: '', topic: '', newQuestion: false, questionTitle: '', hintGiven: false, wrapUp: false, candidateStuck: false, endInterview: false, satisfaction: null };
  }
  return {
    say: say || '',
    analysis,
    verdict,
    board: typeof j.board === 'string' ? j.board.trim() : '',
    topic: typeof j.topic === 'string' ? j.topic : '',
    newQuestion: j.new_question === true,
    questionTitle: typeof j.question_title === 'string' ? j.question_title.trim().slice(0, 120) : '',
    hintGiven: j.hint_given === true,
    wrapUp: j.wrap_up === true,
    candidateStuck: j.candidate_stuck === true,
    endInterview: j.end_interview === true,
    satisfaction: Number.isFinite(Number(j.satisfaction)) ? Math.min(5, Math.max(1, Math.round(Number(j.satisfaction)))) : null,
  };
}

export function createInterviewer({ repo, llm }) {
  // Consecutive turns without a usable answer. In memory is fine for a personal tool.
  const strikesById = new Map();
  // Per-thread state: follow-ups since the last brand-new question and the recent satisfaction scores.
  const threadById = new Map();

  async function ask(system, messages) {
    const res = await llm.chat({ system, messages, json: true, maxTokens: 900, temperature: 0.6 });
    return { res, reply: parseInterviewerReply(res.text) };
  }

  async function generate(interviewId, elapsedSec = 0) {
    const iv = repo.getInterview(interviewId);
    const mode = MODES[iv.mode];
    const history = repo.getMessages(interviewId, 20);
    const asked = repo.interviewQuestions(interviewId);
    const thread = threadById.get(interviewId) || { followups: 0, sat: [] };
    const cap = FOLLOWUP_CAP[iv.style] || 3;
    const min = Math.min(MIN_PROBES[iv.style] ?? 2, cap);
    // The seed changes with every new question, so the topic focus rotates instead of staying fixed all interview.
    const rng = seededRng(interviewId * 7919 + asked.length * 131);
    const focusTopics = pickFocus(mode.topics, repo.topicStats(iv.mode), iv.mode, 3, rng);
    const bank = COMPANIES[iv.company]?.bank;
    const pool = bank ? [...(iv.mode === 'behavioral' ? bank.hr : bank.technical)].sort(() => rng() - 0.5).slice(0, 6) : [];
    const system = buildSystemPrompt({
      interview: iv,
      focusTopics,
      companyPool: pool,
      askedTitles: repo.recentQuestionTitles(iv.mode, 25),
      weaknesses: repo.recentWeaknesses(3, 6, iv.mode),
      project: iv.project_id ? repo.getProject(iv.project_id) : null,
      elapsedSec,
      strikes: strikesById.get(interviewId) || 0,
      maxStrikes: MAX_STRIKES,
      askedHere: asked.map((a) => a.title),
      coveredTopics: [...new Set(asked.map((a) => a.topic).filter(Boolean))],
      thread: { followups: thread.followups, sat: thread.sat.slice(-3), cap, min },
    });
    const messages = history.length
      ? toLlmMessages(history)
      : [{ role: 'user', content: '[The interview begins. Introduce yourself professionally in one sentence, state the format briefly, and ask your first question according to the plan.]' }];

    let { res, reply } = await ask(system, messages);

    // Guardrails: one corrective retry when the model skips the counter-question or judges without evidence.
    const lastCand = [...history].reverse().find((m) => m.role === 'candidate');
    const genuine = lastCand && lastCand.content !== NO_RESPONSE;
    const timeLeft = iv.duration_min - elapsedSec / 60 > iv.duration_min * 0.2;
    let correction = '';
    if (genuine && reply.newQuestion && !reply.candidateStuck && reply.verdict !== 'stray' && thread.followups < min && timeLeft && !reply.wrapUp) {
      correction = `You moved to a new question after only ${thread.followups} follow-up(s); at least ${min} are required. Do NOT change the question. Re-read the candidate's last answer and ask ONE counter-question about a specific claim, gap, edge case or trade-off in it. Set new_question false.`;
    } else if (genuine && ['incorrect', 'unclear'].includes(reply.verdict) && reply.analysis.length < 30) {
      correction = 'You judged the last answer incorrect or unclear without naming the specific statement or gap. Re-analyse it carefully: quote what the candidate actually said, decide what is right and what is wrong, and only then reply. If the answer was merely incomplete, say so and ask a targeted counter-question.';
    }
    if (correction) {
      try {
        const retry = await ask(`${system}\n\nCORRECTION: ${correction}`, messages);
        if (retry.reply.say || retry.reply.verdict === 'stray') { res = retry.res; reply = retry.reply; }
      } catch { /* keep the first reply */ }
    }

    // Stray input that slipped past the filter: drop it silently, change nothing.
    if (lastCand && lastCand.content !== NO_RESPONSE && reply.verdict === 'stray') {
      repo.deleteMessage(lastCand.id);
      return { ignored: true, say: '', board: '', strikes: strikesById.get(interviewId) || 0, provider: res.provider, model: res.model };
    }

    // Streak bookkeeping lives on the server, so the model can never end the interview on a whim.
    if (lastCand) {
      const stuck = lastCand.content === NO_RESPONSE || reply.candidateStuck;
      strikesById.set(interviewId, stuck ? (strikesById.get(interviewId) || 0) + 1 : 0);
    }
    if (reply.newQuestion) threadById.set(interviewId, { followups: 0, sat: [] });
    else if (lastCand) threadById.set(interviewId, { followups: thread.followups + 1, sat: [...thread.sat, ...(reply.satisfaction ? [reply.satisfaction] : [])] });
    const strikes = strikesById.get(interviewId) || 0;
    reply.endInterview = reply.endInterview && strikes >= MAX_STRIKES;
    if (reply.endInterview) reply.wrapUp = true;

    repo.addMessage(interviewId, 'interviewer', reply.say, reply.board, reply.analysis || reply.verdict ? { analysis: reply.analysis, verdict: reply.verdict } : null);
    if (reply.newQuestion && reply.questionTitle) {
      repo.addQuestion(interviewId, iv.mode, reply.topic, reply.questionTitle, iv.difficulty);
    }
    if (reply.hintGiven) repo.bumpHint(interviewId);
    const { analysis, ...publicReply } = reply;
    return { ...publicReply, strikes, provider: res.provider, model: res.model };
  }

  async function start(cfg) {
    const interviewId = repo.createInterview(cfg);
    try {
      const reply = await generate(interviewId, 0);
      return { interview: repo.getInterview(interviewId), reply };
    } catch (e) {
      repo.deleteInterview(interviewId);
      throw e;
    }
  }

  async function turn(interviewId, { text, elapsedSec = 0 }) {
    const iv = repo.getInterview(interviewId);
    if (!iv) throw Object.assign(new Error('Interview not found'), { status: 404 });
    if (iv.status === 'paused') throw Object.assign(new Error('Interview is paused. Resume it first.'), { status: 409 });
    if (iv.status !== 'active') throw Object.assign(new Error('Interview has ended.'), { status: 409 });

    const clean = (text || '').trim();
    if (clean === NO_RESPONSE) {
      repo.addMessage(interviewId, 'candidate', NO_RESPONSE);
    } else if (clean) {
      // A lone "terminate", "okay" or a transcription artefact is not an answer: never let it reach the interviewer.
      if (isStrayInput(clean)) return { ignored: true, say: '', board: '', strikes: strikesById.get(interviewId) || 0 };
      repo.addMessage(interviewId, 'candidate', clean.slice(0, 8000));
    } else {
      const last = repo.lastMessage(interviewId);
      if (!last || last.role !== 'candidate') throw Object.assign(new Error('Nothing to respond to.'), { status: 400 });
    }
    try {
      return await generate(interviewId, elapsedSec);
    } catch (e) {
      if (e instanceof ProviderError) e.message = `Interviewer could not respond: ${e.message}`;
      throw e;
    }
  }

  return { start, turn };
}
