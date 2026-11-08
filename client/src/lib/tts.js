// Browser SpeechSynthesis with sentence chunking (avoids Chrome cutting off long utterances).
let token = 0;

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function englishVoices() {
  if (!ttsSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('en'));
}

// Default voice: prefer the natural / neural voices (Edge, Chrome) over the robotic system default.
export function bestVoice() {
  const list = englishVoices();
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google (uk|us) english/i.test(v.name) ? 3 : 0)
    + (/^en-(gb|us|in)/i.test(v.lang) ? 1 : 0) - (/novelty|whisper|zarvox|bad news|bells/i.test(v.name) ? 9 : 0);
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

export function speak(text, { voiceURI = '', rate = 1 } = {}, onEnd = () => {}) {
  if (!ttsSupported()) { onEnd(); return; }
  cancelSpeech();
  const my = token;
  const voice = englishVoices().find((v) => v.voiceURI === voiceURI) || bestVoice();
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
