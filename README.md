# Interview Coach

A personal, voice-first AI interviewer for MAANG-style technical interview practice. You speak, it listens (Groq Whisper), thinks (Groq Llama / Gemini), and answers aloud (browser speech). Every session ends with a strict scored report, and your history shapes future interviews.

## Quick start

Requires **Node 22.13 or newer** (uses the built-in `node:sqlite`) and Chrome or Edge.

```
cp .env.example .env        # Windows: copy .env.example .env
# put GROQ_API_KEY and GEMINI_API_KEY in .env
npm install
npm run build
npm start                   # open http://localhost:3001
```

For development with hot reload use `npm run dev` (client on http://localhost:5173, API on :3001). Run the tests with `npm test`.

Keys: Groq https://console.groq.com/keys, Gemini https://aistudio.google.com/apikey. Both have free tiers; the app works with only one (Groq gives you voice input; without it you can type). Keys stay on the server.

## Using it

1. **New interview**: pick mode, company style, position, round, difficulty, duration, personality and style.
2. The interviewer greets you and asks the first question aloud. The problem or schema appears in the **Problem / board** panel.
3. Just talk. When you stop speaking for a moment (default 2.2 s, adjustable in Voice settings) your answer is transcribed and sent. Press **Done speaking** to send immediately.
4. Controls: **Interrupt and answer**, **Repeat question**, **Pause/Resume**, **End interview**. You can also type, and paste code in the **Code / notes** panel (**Send code**).
5. **End interview** generates the report (needs at least 2 answers). Reports, transcripts and stats are stored locally in `server/data/coach.db`.

### Modes
DSA, Core CS, System Design, Project Discussion (add your project description or load a README), Behavioral (STAR), SQL.

### Companies
Google, Amazon, Microsoft, Meta, Apple, Netflix, Uber, Atlassian, plus a generic profile. Profiles are based on publicly reported patterns and are only tendencies; real interviewers vary.

### Personalities
Real (neutral, challenging), Strict (minimal hints, heavy cross-questioning), Mentor (teaches and explains mistakes). They are separate prompts; Mentor behavior is never mixed into a Real or Strict session.

### Adaptive memory
After each report, per-topic scores are stored. New interviews weight weaker and unseen topics higher, avoid recently asked question titles, and probe weaknesses listed in your last three reports. The dashboard shows weak/strong topics, a score trend, and questions solved with and without hints.

## How it works

```
Browser: mic + silence detection -> POST /api/transcribe -> Groq Whisper
         text -> POST /api/interviews/:id/turn -> interviewer engine -> LLM chain
         reply (JSON: say, board, topic...) -> browser SpeechSynthesis
LLM chain (interview turns): Groq llama-3.3-70b -> Groq gpt-oss-120b -> Gemini Flash
LLM chain (reports):         Gemini Flash -> Groq models
```

See `docs/ARCHITECTURE.md` for provider limits, cost controls and design decisions.

## Limits and honest notes

- Free-tier limits change. Groq's published Whisper free limits at build time: 20 requests/min, 2,000/day, 28,800 audio seconds/day. Check your console. The dashboard shows local usage and Groq's rate-limit headers.
- Talk-over interruption is off by default: speaker audio can re-trigger the mic. Turn it on in Voice settings if you use headphones. The Interrupt button always works.
- Voice quality is whatever your browser provides. Pick a better voice in Voice settings (Edge "Natural" voices sound best).
- Reports are an AI model's judgment of the transcript. Treat single scores as noisy; trends matter.
- An interview left mid-way (tab closed) cannot be resumed; it stays in history as active and can be deleted.

## Troubleshooting

- *"Cannot reach the server"*: start it with `npm start` or `npm run dev`.
- *Mic blocked*: allow microphone access for localhost in the browser; text mode still works.
- *429 / provider errors*: the app retries and falls back across models automatically; if all fail you get a Retry button and nothing is lost.
- *Cut off while thinking*: raise Pause tolerance in Voice settings.
