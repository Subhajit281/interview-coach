// Detects input that is not a real answer: stray command words ("terminate"), fillers and Whisper phantom phrases.
// These must never reach the interviewer, otherwise the question changes on a mistaken word.
const STRAY_WORDS = new Set([
  'terminate', 'terminates', 'terminated', 'terminating', 'termination', 'stop', 'stopped', 'end', 'ended', 'exit', 'quit',
  'cancel', 'bye', 'goodbye', 'thanks', 'thank', 'you', 'okay', 'ok', 'hmm', 'hm', 'mm', 'mmm', 'um', 'uh', 'ah', 'oh', 'er',
  'so', 'well', 'right', 'alright', 'done', 'finish', 'finished', 'that', 'is', 'all', 'thats', 's', 'i', 'am', 'the', 'a',
]);

export function isStrayInput(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (t === '[NO RESPONSE]' || t.startsWith('[CODE]')) return false;
  const words = t.toLowerCase().replace(/['’]/g, '').match(/[a-z]+/g) || [];
  if (words.length === 0) return !/\d/.test(t); // punctuation only is stray; a bare number can be a real answer
  return words.length <= 4 && words.every((w) => STRAY_WORDS.has(w));
}
