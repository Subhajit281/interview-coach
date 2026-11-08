import { ProviderError } from './http.js';
import { STT_VOCAB_PROMPT } from './groq.js';
import { isStrayInput } from './stray.js';

// Whisper tends to emit these phrases on near-silent audio.
const HALLUCINATIONS = /^(thank you( so much)?\.?|thanks\.?|thanks for watching\.?|please subscribe\.?|you\.?|bye\.?|goodbye\.?|okay\.?|ok\.?|hmm+\.?|mm+\.?|\.+|uh\.?|um\.?|ah\.?|oh\.?)$/i;

export function isLikelyHallucination(text, durationSec) {
  const t = (text || '').trim();
  if (t.length < 2) return true;
  return durationSec < 4 && HALLUCINATIONS.test(t);
}

// With near-silent audio Whisper sometimes echoes the vocabulary prompt back as a "transcript".
const VOCAB = new Set(STT_VOCAB_PROMPT.toLowerCase().match(/[a-z0-9]+/g));
export function isPromptEcho(text) {
  const w = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return w.length >= 4 && w.filter((x) => VOCAB.has(x)).length / w.length >= 0.85;
}

export function createStt({ config, groq, tracker }) {
  return {
    async transcribe({ buffer, mime, durationSec = 0, voicedSec = null }) {
      if (!config.groq.apiKey) {
        throw new ProviderError('Speech recognition needs GROQ_API_KEY. Type your answer instead.', 503);
      }
      if (!buffer || buffer.length < 1000) return ''; // too small to contain speech
      if (voicedSec !== null && voicedSec < 0.5) return ''; // the browser heard no real voice: do not even ask Whisper
      mime = String(mime || 'audio/webm').split(';')[0].trim() || 'audio/webm';
      tracker?.recordStt(durationSec);
      const ext = /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
      const out = await groq.transcribe({ buffer, mime, filename: `audio.${ext}` });
      const text = typeof out === 'string' ? out : out.text;
      if (typeof out === 'object' && out.noSpeech) return ''; // Whisper itself says this is not speech
      if (isLikelyHallucination(text, durationSec)) return '';
      if (isStrayInput(text)) return ''; // a lone command or filler word ("terminate", "okay") is never an answer
      if (isPromptEcho(text) && (voicedSec !== null ? voicedSec < 2.5 : durationSec < 5)) return '';
      return text;
    },
  };
}
