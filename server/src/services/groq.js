import { fetchWithRetry, ProviderError } from './http.js';

const BASE = 'https://api.groq.com/openai/v1';

export const STT_VOCAB_PROMPT =
  'Technical software engineering interview. Terms: array, hash map, two pointers, sliding window, binary search, ' +
  'linked list, BFS, DFS, Dijkstra, trie, heap, backtracking, dynamic programming, memoization, O(n log n), O(1), ' +
  'mutex, semaphore, deadlock, paging, TCP, B-tree, ACID, CAP theorem, sharding, load balancer, Redis, Kafka, SQL, CTE.';

export function createGroq({ config, fetchImpl = fetch, sleep, tracker }) {
  const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey || config.groq.apiKey}` });
  const opts = (label, request = {}) => ({ fetchImpl, sleep, label, ...request });

  async function chat({ model, system, messages, json = false, maxTokens = 700, temperature = 0.7, apiKey, signal, timeoutMs, retries }) {
    const body = {
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature,
      max_tokens: maxTokens,
    };
    if (json) body.response_format = { type: 'json_object' };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';

    const once = async () => {
      const res = await fetchWithRetry(
        `${BASE}/chat/completions`,
        { method: 'POST', headers: { ...auth(apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal },
        opts(`Groq ${model}`, { timeoutMs, retries }),
      );
      tracker?.record('groq', model, res.headers);
      const data = await res.json();
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      // Reasoning models spend max_tokens on hidden thinking. An empty reply must fail over to the next model
      // instead of reaching the interviewer as "no answer" (this was the silent failure).
      if (!text.trim()) throw new ProviderError(`Groq ${model}: empty reply (${choice?.finish_reason || 'no content'}); its token budget was probably used up by reasoning`, 502);
      return { text, provider: 'groq', model, truncated: choice?.finish_reason === 'length' };
    };
    // gpt-oss on Groq sometimes returns nothing parseable (HTTP 400 output_parse_failed, or an empty reply).
    // These are transient: retry the same model once, quickly, before the router escalates to a bigger model.
    try { return await once(); }
    catch (e) {
      if (signal?.aborted || !(e instanceof ProviderError) || !/output_parse_failed|Parsing failed|empty reply/.test(e.message)) throw e;
      return once();
    }
  }

  async function transcribe({ buffer, mime = 'audio/webm', filename = 'audio.webm', apiKey }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), filename);
    form.append('model', config.groq.sttModel);
    form.append('language', config.groq.sttLanguage);
    form.append('temperature', '0');
    form.append('response_format', 'verbose_json');
    form.append('prompt', STT_VOCAB_PROMPT);
    const res = await fetchWithRetry(
      `${BASE}/audio/transcriptions`,
      { method: 'POST', headers: auth(apiKey), body: form },
      opts('Groq transcription'),
    );
    const data = await res.json();
    const text = String(data.text ?? '').trim();
    // Whisper scores each segment for silence/noise: if every segment looks like non-speech, flag it.
    const segs = Array.isArray(data.segments) ? data.segments : [];
    const good = (x) => !(x.no_speech_prob > 0.6 && x.avg_logprob < -0.5) && !(x.avg_logprob < -1.2) && !(x.compression_ratio > 2.4);
    if (segs.length === 0) return text;
    const kept = segs.filter(good);
    if (kept.length === 0) return { text, noSpeech: true };
    return kept.length === segs.length ? text : kept.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
  }

  return { chat, transcribe };
}
