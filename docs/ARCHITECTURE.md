# Architecture

## Goal
Personal, voice-first AI technical interviewer. Reliable turn-based voice loop (listen -> transcribe -> reason -> speak). Full-duplex streaming was rejected as costlier and less reliable for a personal tool.

## Provider decisions (verified Nov 2026 from provider docs and third-party listings; re-check your consoles)
| Role | Choice | Notes |
|---|---|---|
| Speech-to-text | Groq `whisper-large-v3-turbo` | Free plan: 20 RPM, 2,000 RPD, 7,200 audio-sec/hour, 28,800 audio-sec/day. Paid $0.04/hour, 10 s minimum billed per request. |
| Interviewer LLM | Groq `llama-3.3-70b-versatile`, fallback `openai/gpt-oss-120b`, then Gemini Flash | Groq free text-model caps are per model (roughly 1,000 requests/day, 8-12K tokens/min reported). Separate quotas per model make the fallback useful. |
| Reports | Gemini Flash first, Groq as fallback | One call per interview. Gemini free quotas vary by model/account; view yours in AI Studio. |
| TTS | Browser SpeechSynthesis | Free, instant. Upgrade path: Groq Orpheus or Gemini TTS. |
| Gemini Live API | Not used | Free quotas for Live/native audio are tiny and unstable; revisit if the turn-based loop feels slow. |

Model IDs are env-configurable, and `/api/usage` plus the dashboard surface Groq rate-limit headers.

## Cost and quota controls
- Browser VAD sends one blob per utterance; the recorder restarts during silence so thinking time is not uploaded or billed; clips < 0.5 s of speech are dropped.
- Whisper hallucinations on near-silence ("Thank you.") are filtered server-side.
- Retries with exponential backoff on network errors, 429 and 5xx. A `retry-after` longer than 6 s (daily quota) skips straight to the next provider.
- One in-flight turn per interview (409 otherwise); evaluator calls are de-duplicated.
- Prompt context = system prompt + last 20 messages + recent question titles; candidate messages are clipped; transcripts for evaluation are capped.

## Modules (server/src)
- `config/` env loading. `db/` node:sqlite + `schema.sql`.
- `services/http.js` retry/backoff, `groq.js`, `gemini.js`, `llm.js` (router, JSON extraction), `stt.js`, `usage.js`.
- `services/prompts.js` interviewer and evaluator prompts; `interviewer.js` turn engine; `evaluator.js` report normalization and stats updates; `repo.js` SQL + weighted topic selection.
- `data/modes.js`, `data/companies.js` modes, topics, personalities, company profiles.
- `routes/api.js` REST API.

## Interviewer contract
The model must return JSON: `say` (spoken), `board` (problem/schema text shown on screen), `topic`, `new_question`, `question_title`, `hint_given`, `wrap_up`. Non-JSON replies degrade to plain speech. The server tracks questions asked, hints given, and time (client sends elapsed seconds; the prompt tells the model to converge and close near the limit).

## Data model
interviews, messages, questions_asked, reports, topic_stats (`mode:topic` -> running average 0-10), projects.

## Client (client/src)
`lib/voiceInput.js` (mic, VAD, recorder), `lib/tts.js` (chunked SpeechSynthesis), `lib/api.js`; components: Dashboard, Configure, Interview, Report, Visualizer.
