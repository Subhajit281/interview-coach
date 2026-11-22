// Browser SpeechSynthesis with sentence chunking and gender-matched voice selection.
let token = 0;

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function englishVoices() {
  if (!ttsSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('en'));
}

const MALE_NAMES = new Set([
  'david', 'michael', 'james', 'daniel', 'alex', 'john', 'robert', 'chris', 'ryan',
  'thomas', 'brian', 'matthew', 'andrew', 'marcus', 'kevin', 'mark', 'william', 'richard',
  'joseph', 'charles', 'steven', 'paul', 'jason', 'jeffrey', 'eric', 'scott', 'stephen',
  'rahul', 'rohit', 'amit', 'vikram', 'aditya', 'arjun', 'varun', 'suresh', 'rajesh',
  'karthik', 'pranav', 'guy', 'george', 'steffan', 'aaron', 'arthur', 'oliver', 'fred',
  'sam', 'luke', 'ben', 'adam', 'noah', 'liam', 'ethan', 'lucas', 'mason', 'logan', 'leo'
]);

const FEMALE_NAMES = new Set([
  'sarah', 'emily', 'rachel', 'priya', 'jessica', 'elena', 'laura', 'sophia', 'anna',
  'maya', 'jennifer', 'lisa', 'emma', 'olivia', 'samantha', 'zira', 'chloe', 'hannah',
  'claire', 'victoria', 'ashley', 'amanda', 'megan', 'stephanie', 'nicole', 'elizabeth',
  'maria', 'natasha', 'alicia', 'grace', 'zoe', 'lily', 'natalie', 'kavya', 'ananya',
  'sneha', 'pooja', 'neha', 'aarti', 'shreya', 'jenny', 'aria', 'susan', 'hazel', 'sonia',
  'charlotte', 'amelia', 'harper', 'evelyn', 'abigail', 'isabella', 'mia', 'ella', 'camila'
]);

/**
 * Detects whether the spoken intro or text indicates a male or female interviewer.
 */
export function detectGenderFromText(text) {
  if (!text || typeof text !== 'string') return null;
  // Match introductions like: "I am David", "I'm Sarah", "My name is Michael", "This is Rachel speaking"
  const m = text.match(/(?:i\s+am|i'm|my\s+name\s+is|this\s+is)\s+([a-zA-Z]+)/i);
  if (m && m[1]) {
    const name = m[1].toLowerCase();
    if (MALE_NAMES.has(name)) return 'male';
    if (FEMALE_NAMES.has(name)) return 'female';
  }
  // Check the first 25 words for any known persona name
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).slice(0, 25);
  for (const w of words) {
    if (MALE_NAMES.has(w)) return 'male';
    if (FEMALE_NAMES.has(w)) return 'female';
  }
  return null;
}

/**
 * Categorizes a browser SpeechSynthesis voice as male, female, or unknown.
 */
export function detectVoiceGender(v) {
  if (!v || !v.name) return 'unknown';
  const name = v.name.toLowerCase();
  const malePattern = /\b(male|david|mark|george|guy|ryan|steffan|daniel|alex|fred|arthur|oliver|richard|tom|james|christopher|aaron|gordon|paul|andrew|brian)\b|\(male\)/i;
  const femalePattern = /\b(female|zira|jenny|aria|samantha|victoria|karen|hazel|susan|sonia|mia|ana|eva|fiona|moira|tessa|kate|serena|stephanie|emma|ava|lisa)\b|\(female\)/i;

  const isMale = malePattern.test(name);
  const isFemale = femalePattern.test(name);
  if (isMale && !isFemale) return 'male';
  if (isFemale && !isMale) return 'female';
  return 'unknown';
}

/**
 * Selects the best English voice matching the requested gender ('male' | 'female' | null).
 * Prioritizes natural/neural voices and strict gender matching.
 */
export function bestVoice(gender = null) {
  const list = englishVoices();
  if (!list.length) return null;
  const targetGender = gender === 'male' || gender === 'female' ? gender : null;

  const score = (v) => {
    let s = 0;
    if (/natural|neural|online/i.test(v.name)) s += 10;
    if (/google (uk|us) english/i.test(v.name)) s += 6;
    if (/^en-(us|gb|in)/i.test(v.lang)) s += 2;
    if (/novelty|whisper|zarvox|bad news|bells/i.test(v.name)) s -= 50;

    if (targetGender) {
      const g = detectVoiceGender(v);
      if (g === targetGender) s += 100;
      else if (g !== 'unknown') s -= 100;
    }
    return s;
  };

  return list.reduce((best, v) => (!best || score(v) > score(best) ? v : best), null);
}

function chunk(text, max = 180) {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length > max && cur) { out.push(cur); cur = s; }
    else cur = (cur + ' ' + s).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export function cancelSpeech() {
  token++;
  if (ttsSupported()) window.speechSynthesis.cancel();
}

export function speak(text, { voiceURI = '', rate = 1, gender = null } = {}, onEnd = () => {}) {
  if (!ttsSupported()) { onEnd(); return; }
  cancelSpeech();
  const my = token;
  const effectiveGender = gender || detectGenderFromText(text);
  const voice = (voiceURI && englishVoices().find((v) => v.voiceURI === voiceURI)) || bestVoice(effectiveGender);
  const parts = chunk(text);
  if (!parts.length) { onEnd(); return; }
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-US';
    u.rate = rate;
    const done = () => { if (token === my && i === parts.length - 1) onEnd(); };
    u.onend = done;
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') done(); };
    window.speechSynthesis.speak(u);
  });
}
