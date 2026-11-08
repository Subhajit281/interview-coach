import { fetchWithRetry, ProviderError } from './http.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function toContents(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${m.content}`;
    else out.push({ role, parts: [{ text: m.content }] });
  }
  if (out[0]?.role === 'model') out.unshift({ role: 'user', parts: [{ text: '(begin)' }] });
  return out;
}

export function createGemini({ config, fetchImpl = fetch, sleep }) {
  async function chat({ model, system, messages, json = false, maxTokens = 700, temperature = 0.7 }) {
    const generationConfig = { temperature, maxOutputTokens: maxTokens };
    if (json) generationConfig.responseMimeType = 'application/json';
    // Skip "thinking" on 2.5 Flash for low latency; the interviewer turn does not need it.
    if (/2\.5-flash/.test(model) && maxTokens <= 1500) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const res = await fetchWithRetry(
      `${BASE}/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          generationConfig,
        }),
      },
      { fetchImpl, sleep, label: `Gemini ${model}` },
    );
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) {
      const why = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'empty response';
      throw new ProviderError(`Gemini ${model}: no text (${why})`, 502);
    }
    return { text, provider: 'gemini', model };
  }
  return { chat };
}
