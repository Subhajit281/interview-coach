import { extractJson } from './llm.js';
import { MODES } from '../data/modes.js';
import { pickBlueprint, planQuestions } from './blueprint.js';
import { buildSystemPrompt, getInterviewerPersona } from './prompts.js';
import { pickFocus, seededRng } from './repo.js';
import { ProviderError } from './http.js';
import { isStrayInput } from './stray.js';
import { normTitle } from './questionBank.js';

const MAX_CANDIDATE_CHARS = 4000;
export const NO_RESPONSE = '[NO RESPONSE]';
export const MAX_STRIKES = 5;
const FOLLOWUP_CAP = { standard: 3, rapid: 2, deep: 6 };
// Minimum counter-questions on a question before the interviewer may switch to a new one.
const MIN_PROBES = { standard: 2, rapid: 1, deep: 3 };
const VERDICTS = new Set(['correct', 'partial', 'incorrect', 'unclear', 'off_topic', 'stray', 'none']);

// Clarification is part of an interview, not an answer. Flag common spoken
// variants explicitly so the model does not grade the request or jump ahead.
function isClarificationRequest(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || t === NO_RESPONSE || t.startsWith('[code]')) return false;
  return /\b(can you|could you|please|would you)\s+(explain|clarify|repeat|rephrase|elaborate)\b|\b(explain|clarify|repeat|rephrase)\s+(the )?(question|problem|prompt)\b|\bwhat do you mean\b|\bi (do not|don't) understand\b/.test(t);
}

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

// If the JSON was cut off after the spoken part, the spoken part is still usable.
function salvageSay(raw) {
  const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(raw || ''));
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`).trim(); } catch { return m[1].trim(); }
}

export function parseInterviewerReply(raw) {
  const j = extractJson(raw);
  const say = typeof j?.say === 'string' ? j.say.trim() : null;
  const verdict = typeof j?.verdict === 'string' && VERDICTS.has(j.verdict.trim().toLowerCase()) ? j.verdict.trim().toLowerCase() : '';
  const analysis = typeof j?.analysis === 'string' ? j.analysis.trim().slice(0, 600) : '';
  if (!j || (!say && verdict !== 'stray')) {
    const text0 = String(raw || '');
    const salvaged = salvageSay(text0);
    const looksLikeJson = /^\s*[{`]/.test(text0) || /"(analysis|verdict|say)"\s*:/.test(text0);
    // A truncated JSON blob must never be read aloud: salvage the spoken part or fail so the caller can retry.
    if (!salvaged && looksLikeJson) throw new ProviderError('The interviewer reply was cut off before its spoken part.', 502);
    if (salvaged) return { say: salvaged, analysis: '', verdict: '', board: '', topic: '', newQuestion: false, questionTitle: '', hintGiven: false, wrapUp: false, candidateStuck: false, endInterview: false, satisfaction: null };
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

export function createInterviewer({ repo, llm, credentials = null, bank = null }) {
  // Consecutive turns without a usable answer. In memory is fine for a personal tool.
  const strikesById = new Map();
  // Per-thread state: follow-ups since the last brand-new question and the recent satisfaction scores.
  const threadById = new Map();
  // Past-interview context (seeds, titles, weaknesses, project) cannot change mid-session: load it once per interview.
  const contextById = new Map();
  const lastModelById = new Map();

  async function ask(system, messages, request = {}) {
    // Secure routes keep one interviewer instance per user so its conversation
    // state survives HTTP requests. Credentials themselves remain request
    // scoped, allowing an API-key or model selection change to take effect on
    // the very next turn.
    const { credentials: requestCredentials, ...llmRequest } = request;
    // A spoken turn only needs a brief private assessment plus a few sentences.
    // A smaller response budget and low variance noticeably reduce dead air.
    // GPT-OSS currently rejects some otherwise-valid generations when Groq's
    // server-side JSON validator is enabled. The prompt still requests JSON,
    // while extractJson() handles fenced/prose-wrapped responses locally.
    // Reasoning models count hidden thinking against max_tokens, so the budget is generous; it is a cap, not a delay.
    // hedgeMs: if the first model is slow, a second one is asked in parallel and the faster answer wins.
    const call = (maxTokens) => llm.chat({ system, messages, json: false, maxTokens, temperature: 0.45, hedgeMs: 6000, timeoutMs: 14_000, retries: 1, credentials: requestCredentials ?? credentials, ...llmRequest });
    let res = await call(900);
    let reply;
    try { reply = parseInterviewerReply(res.text); }
    catch { res = await call(1600); reply = parseInterviewerReply(res.text); } // cut off: one retry with more room
    return { res, reply };
  }

  async function generate(interviewId, elapsedSec = 0, request = {}) {
    const iv = await repo.getInterview(interviewId);
    const mode = MODES[iv.mode];
    let ctx = contextById.get(interviewId);
    const [history, asked, topicStats, loaded] = await Promise.all([
      repo.getMessages(interviewId, 12),
      repo.interviewQuestions(interviewId),
      repo.topicStats(iv.mode),
      ctx ? null : Promise.all([repo.recentSeeds(iv.mode, 150), repo.recentQuestionTitles(iv.mode, 40), repo.recentWeaknesses(3, 6, iv.mode), iv.project_id ? repo.getProject(iv.project_id) : null]),
    ]);
    if (!ctx) {
      ctx = { recentSeeds: loaded[0], titles: loaded[1].map((t) => t.slice(0, 90)), weaknesses: loaded[2], project: loaded[3], usedSeeds: [] };
      if (contextById.size > 200) contextById.delete(contextById.keys().next().value);
      contextById.set(interviewId, ctx);
    }
    const thread = threadById.get(interviewId) || { followups: 0, sat: [] };
    const cap = FOLLOWUP_CAP[iv.style] || 3;
    const min = Math.min(MIN_PROBES[iv.style] ?? 2, cap);
    // The seed changes with every new question, so the topic focus rotates instead of staying fixed all interview.
    const rng = seededRng(interviewId * 7919 + asked.length * 131);
    const focusTopics = pickFocus(mode.topics, topicStats, iv.mode, 3, rng);
    // Blueprint for the next main question: a fresh theme (rotated across past interviews), an angle and a difficulty level.
    const sessionSeeds = [...new Set([...history.map(parseMeta).map((m) => m?.seed).filter(Boolean), ...ctx.usedSeeds])];
    const blueprint = pickBlueprint({
      mode: iv.mode, company: iv.company, difficulty: iv.difficulty, askedCount: asked.length, sat: thread.sat,
      recentSeeds: ctx.recentSeeds, sessionSeeds,
      rng: seededRng(interviewId * 104729 + asked.length * 7919 + history.length * 31 + 17),
    });
    // Company-wise cached question for the next NEW main question (a cache read: no model call, usually no DB query).
    const exclude = new Set([...ctx.titles, ...asked.map((a) => a.title)].map(normTitle));
    const bankQuestion = bank ? await bank.pick({ company: iv.company, mode: iv.mode, level: blueprint.level, exclude, rng: seededRng(interviewId * 3571 + asked.length * 17 + history.length) }).catch(() => null) : null;
    const plan = { total: planQuestions({ durationMin: iv.duration_min, style: iv.style, mode: iv.mode }), asked: asked.length };
    const lastCand = [...history].reverse().find((m) => m.role === 'candidate');
    const clarification = isClarificationRequest(lastCand?.content);
    const system = buildSystemPrompt({
      interview: iv,
      focusTopics,
      blueprint,
      plan,
      askedTitles: ctx.titles,
      weaknesses: ctx.weaknesses,
      project: ctx.project,
      elapsedSec,
      strikes: strikesById.get(interviewId) || 0,
      maxStrikes: MAX_STRIKES,
      askedHere: asked.map((a) => a.title),
      coveredTopics: [...new Set(asked.map((a) => a.topic).filter(Boolean))],
      thread: { followups: thread.followups, sat: thread.sat.slice(-3), cap, min },
      clarification,
      bankQuestion,
    });
    const messages = history.length
      ? toLlmMessages(history)
      : [{ role: 'user', content: '[The interview begins. Introduce yourself professionally in one sentence, state the format briefly, and ask your first question according to the plan.]' }];

    let { res, reply } = await ask(system, messages, request);

    // Guardrail: one corrective retry, only when the model tries to close the interview early. The old extra retries
    // (min probes, thin analysis) each cost a full LLM call, which is what made turns take 20-30 s.
    const genuine = lastCand && lastCand.content !== NO_RESPONSE;
    const remainingMin = iv.duration_min - elapsedSec / 60;
    const timeLeft = remainingMin > iv.duration_min * 0.2;
    // Closing is only allowed in the final stretch (the same threshold the prompt uses) or once time is up.
    const closeAllowed = remainingMin <= Math.max(3, iv.duration_min * 0.08);
    const diagnose = (r) => {
      if (r.wrapUp && !r.endInterview && !closeAllowed) {
        const how = genuine && thread.followups < min
          ? 'Ask ONE counter-question about a specific claim, gap or edge case in the candidate\'s last answer.'
          : `Pose a NEW main question now, built from the blueprint theme "${blueprint.seed || 'any fresh topic of this mode'}" (angle: ${blueprint.angle}); set new_question true with a short question_title.`;
        return `You tried to close the interview with about ${Math.round(remainingMin)} minutes left. Do NOT conclude, thank the candidate for their time or say goodbye. Set wrap_up false. ${how}`;
      }
      return '';
    };
    let corrections = '';
    for (let attempt = 0; attempt < 1; attempt++) {
      const c = diagnose(reply);
      if (!c) break;
      corrections += `\n\nCORRECTION: ${c}`;
      try {
        const retry = await ask(`${system}${corrections}`, messages, request);
        if (retry.reply.say || retry.reply.verdict === 'stray') { res = retry.res; reply = retry.reply; } else break;
      } catch { break; /* keep the previous reply */ }
    }
    // Last resort: the server, not the model, decides when the session may close.
    if (reply.wrapUp && !reply.endInterview && !closeAllowed) reply.wrapUp = false;

    // Stray input that slipped past the filter: drop it silently, change nothing.
    if (lastCand && lastCand.content !== NO_RESPONSE && reply.verdict === 'stray') {
      await repo.deleteMessage(lastCand.id);
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

    // The theme is recorded with the question so later interviews rotate away from it.
    const seed = reply.newQuestion && blueprint.seed ? blueprint.seed : undefined;
    if (seed) ctx.usedSeeds.push(seed);
    if (bank && reply.newQuestion && reply.questionTitle) {
      if (bankQuestion && normTitle(reply.questionTitle) === normTitle(bankQuestion.title)) bank.markUsed(bankQuestion);
      // Learn from live interviews. Only the title, topic, level and board text are kept: the spoken text can
      // mention what the candidate just said, so it is never stored.
      else bank.capture({ company: iv.company, mode: iv.mode, level: blueprint.level, topic: reply.topic, title: reply.questionTitle, board: reply.board, source: 'live' });
    }
    await Promise.all([
      repo.addMessage(interviewId, 'interviewer', reply.say, reply.board, reply.analysis || reply.verdict || seed ? { analysis: reply.analysis, verdict: reply.verdict, seed } : null),
      reply.newQuestion && reply.questionTitle ? repo.addQuestion(interviewId, iv.mode, reply.topic, reply.questionTitle, iv.difficulty) : null,
      reply.hintGiven ? repo.bumpHint(interviewId) : null,
    ]);
    // Tell the candidate when another model answered, instead of switching silently.
    const prevModel = lastModelById.get(interviewId);
    lastModelById.set(interviewId, res.model);
    const notice = res.primaryModel && res.model !== res.primaryModel && prevModel !== res.model ? `Switched to ${res.model} for this turn because ${res.primaryModel} was slow or unavailable.` : '';
    const { analysis, ...publicReply } = reply;
    const persona = getInterviewerPersona(interviewId);
    return { ...publicReply, interviewer: persona, strikes, provider: res.provider, model: res.model, notice };
  }

  async function start(cfg, { startRequestKey = null, signal, credentials: requestCredentials = null } = {}) {
    const created = repo.createOrGetInterview
      ? await repo.createOrGetInterview({ ...cfg, startRequestKey })
      : { id: await repo.createInterview(cfg), created: true };
    const interviewId = created.id;
    if (!created.created) {
      const messages = await repo.getMessages(interviewId, 1);
      const first = messages.find((m) => m.role === 'interviewer');
      if (first) {
        const persona = getInterviewerPersona(interviewId);
        return { interview: await repo.getInterview(interviewId), reply: { say: first.content, board: first.board || '', interviewer: persona }, interviewer: persona };
      }
      throw Object.assign(new Error('Your interview is still being initialized. Please keep this page open and retry shortly.'), { status: 409, code: 'START_IN_PROGRESS' });
    }
    try {
      // A first question is intentionally quick: the browser has a 90 s
      // connection window, so one provider should not consume it all.
      const reply = await generate(interviewId, 0, { signal, timeoutMs: 15_000, retries: 1, credentials: requestCredentials });
      // Sessions created through the idempotent production path are only active
      // once their first interviewer message exists.
      await repo.setStatus(interviewId, 'active');
      bank?.ensure({ company: cfg.company, mode: cfg.mode, credentials: requestCredentials, delayMs: 20_000 });
      const persona = getInterviewerPersona(interviewId);
      return { interview: await repo.getInterview(interviewId), reply, interviewer: persona };
    } catch (e) {
      if (created.created) await repo.deleteInterview(interviewId);
      throw e;
    }
  }

  async function turn(interviewId, { text, elapsedSec = 0, credentials: requestCredentials = null }) {
    const iv = await repo.getInterview(interviewId);
    if (!iv) throw Object.assign(new Error('Interview not found'), { status: 404 });
    if (iv.status === 'paused') throw Object.assign(new Error('Interview is paused. Resume it first.'), { status: 409 });
    if (iv.status !== 'active') throw Object.assign(new Error('Interview has ended.'), { status: 409 });

    const clean = (text || '').trim();
    if (clean === NO_RESPONSE) {
      await repo.addMessage(interviewId, 'candidate', NO_RESPONSE);
    } else if (clean) {
      // A lone "terminate", "okay" or a transcription artefact is not an answer: never let it reach the interviewer.
      if (isStrayInput(clean)) return { ignored: true, say: '', board: '', strikes: strikesById.get(interviewId) || 0 };
      await repo.addMessage(interviewId, 'candidate', clean.slice(0, 8000));
    } else {
      const last = await repo.lastMessage(interviewId);
      if (!last || last.role !== 'candidate') throw Object.assign(new Error('Nothing to respond to.'), { status: 400 });
    }
    try {
      return await generate(interviewId, elapsedSec, { credentials: requestCredentials });
    } catch (e) {
      if (e instanceof ProviderError) e.message = `Interviewer could not respond: ${e.message}`;
      throw e;
    }
  }

  return { start, turn };
}
