# PROJECT_STATUS

## Completed (all 10 phases)
1. Architecture and init: monorepo, docs, env handling.
2. Backend and provider integration: Groq chat + Whisper, Gemini, router with backoff and fallback, usage tracking.
3. Voice pipeline: mic capture, VAD, Groq STT endpoint, chunked browser TTS, interrupt/repeat/pause/end.
4. Interviewer engine: prompts, JSON contract, personalities, time awareness, question/hint tracking.
5. Modes and company profiles: 6 modes, 8 companies + generic, rounds, styles, project descriptions.
6. Evaluation engine: strict rubric, normalization, topic stats and question results.
7. Persistence: SQLite history, reports, adaptive topic weighting, recent-weakness probing.
8. Frontend: dashboard, configuration, active interview, report view.
9. Integration testing: 24 server tests (mocked providers), server process smoke test, client production build.
10. Docs: README, ARCHITECTURE.

## Update v4 (improvements round)
- Counter-questions: the interviewer now writes a private `analysis` + `verdict` before every reply and must ask at least 2 counter-questions (1 rapid, 3 deep) on the same question before switching. The server retries once if the model switches too early or judges "incorrect/unclear" without naming the gap.
- Memory isolation: past-weakness hints are scoped to the same mode (a SQL session no longer shapes Core CS); prompt says each interview is independent.
- Mic is manual: it opens only on Start answering (optional auto-start setting, off by default). Stray words ("terminate", "okay", "thank you") are filtered on the server (STT and typed input) and never reach the interviewer or change the question.
- New: Tech Mahindra profile (question pool), roles SDE Intern / SDE FTE / AI Engineer Intern / AI Engineer FTE, AI / ML Engineering mode.
- Report: two parallel evaluator calls; question-by-question your-answer vs ideal answer, optimisation, strength evidence, weakness analysis, improvement plan, readiness, communication.
- Professional tone prompt and better default TTS voice; VS Code-style auto-closing brackets/quotes in the code editor.
- Performance: clock isolated from the editor (no per-second re-highlight), editor lazy-loaded, prepared-statement cache, only latest board resent to the model, lower temperature.

## Verified in this build environment
- `npm test`: 36/36 pass (retry/backoff, provider fallback, request shapes for Groq/Gemini, hallucination filter, full interview flow incl. pause/retry/end/report/stats, validation, adaptive weighting).
- `npm run build`: client builds. `npm start`: serves UI and API; no-key paths return clear errors.

## NOT verified (needs your machine and keys)
- Real Groq/Gemini calls: request shapes follow provider docs but were only tested against mocks. Model IDs/params (e.g. `reasoning_effort` for gpt-oss, Gemini `thinkingBudget`) may need adjusting via `.env` if a provider rejects them.
- Browser behavior: microphone capture, VAD thresholds, MediaRecorder formats, SpeechSynthesis voices and the UI were never run in a browser here. Expect to tune pause tolerance and possibly VAD sensitivity (`voiceInput.js`, `thr` calibration).

## Known limitations
- No resume of an interview after closing the tab.
- Voice barge-in is off by default (echo risk without headphones).
- Free-tier numbers differ across sources; trust your consoles.
- No Gemini audio fallback for STT (webm is not a documented Gemini input format); when Groq STT is rate limited, type answers.

## Next ideas
Resume interrupted interviews, Groq/Gemini TTS option, coding editor with syntax highlighting, export reports to PDF.
