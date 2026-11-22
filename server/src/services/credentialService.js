import { decryptSecret, encryptSecret } from '../utils/encryption.js';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value) => String(value || '').trim();
const modelCache = new Map();
const CACHE_MS = 5 * 60 * 1000;
const label = (id) => id.replace(/^models\//, '').split(/[-/]/).map((x) => x ? x[0].toUpperCase() + x.slice(1) : '').join(' ');
const geminiChatModel = (model) => model.name?.startsWith('models/gemini-')
  && Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent')
  && !/(image|tts|audio|embedding|live|robotics)/i.test(model.name);
const groqChatModel = (model) => typeof model.id === 'string'
  && !/(whisper|speech|tts|audio|guard|embedding|compound)/i.test(model.id);

async function providerModels(fetchImpl, provider, apiKey) {
  const request = provider === 'groq'
    ? ['https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }]
    : [`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {}];
  const response = await fetchImpl(...request);
  if (!response.ok) throw fail(`Could not load your ${provider === 'groq' ? 'Groq' : 'Gemini'} model list.`, response.status === 401 || response.status === 403 ? 401 : 502);
  const data = await response.json();
  const rows = provider === 'groq' ? (data.data || []).filter(groqChatModel).map((m) => ({ id: m.id, label: label(m.id), note: 'Available with your Groq key' }))
    : (data.models || []).filter(geminiChatModel).map((m) => ({ id: m.name.slice('models/'.length), label: m.displayName || label(m.name), note: 'Available with your Gemini key' }));
  return rows;
}

export function createCredentialService({ prisma, config, fetchImpl = fetch }) {
  // A bad AES-GCM tag means the Render encryption secret changed after these
  // keys were saved. It is not recoverable, so surface a reset state rather
  // than letting provider requests repeatedly throw raw crypto errors.
  const state = (row) => {
    if (!row) return { geminiConfigured: false, groqConfigured: false, credentialResetRequired: false };
    let geminiConfigured = Boolean(row.geminiConfigured);
    let groqConfigured = Boolean(row.groqConfigured);
    let credentialResetRequired = false;
    if (geminiConfigured) {
      try { decryptSecret(row.encryptedGeminiKey, config.encryptionSecret); } catch { geminiConfigured = false; credentialResetRequired = true; }
    }
    if (groqConfigured) {
      try { decryptSecret(row.encryptedGroqKey, config.encryptionSecret); } catch { groqConfigured = false; credentialResetRequired = true; }
    }
    return { geminiConfigured, groqConfigured, credentialResetRequired };
  };
  async function gemini(key) { const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`); if (!r.ok && r.status !== 429) throw fail('Gemini key could not be validated.'); }
  async function groq(key) { const r = await fetchImpl('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } }); if (!r.ok && r.status !== 429) throw fail('Groq key could not be validated.'); }
  return {
    async status(userId) { return state(await prisma.userApiCredential.findUnique({ where: { userId } })); },
    async update(userId, body) {
      const geminiKey = body.geminiKey === undefined ? undefined : clean(body.geminiKey), groqKey = body.groqKey === undefined ? undefined : clean(body.groqKey);
      if (geminiKey === undefined && groqKey === undefined) throw fail('Provide at least one API key.');
      await Promise.all([geminiKey ? gemini(geminiKey) : null, groqKey ? groq(groqKey) : null]);
      const data = {};
      if (geminiKey !== undefined) Object.assign(data, { encryptedGeminiKey: geminiKey ? encryptSecret(geminiKey, config.encryptionSecret) : null, geminiConfigured: Boolean(geminiKey) });
      if (groqKey !== undefined) Object.assign(data, { encryptedGroqKey: groqKey ? encryptSecret(groqKey, config.encryptionSecret) : null, groqConfigured: Boolean(groqKey) });
      modelCache.delete(userId);
      return state(await prisma.userApiCredential.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
    },
    async remove(userId, provider) { return this.update(userId, provider === 'gemini' ? { geminiKey: '' } : provider === 'groq' ? { groqKey: '' } : (() => { throw fail('Unknown provider.'); })()); },
    async resolve(userId) {
      const row = await prisma.userApiCredential.findUnique({ where: { userId } });
      const current = state(row);
      if (current.credentialResetRequired) {
        throw Object.assign(fail('Your saved AI key cannot be read after a server security-key change. Open Settings and save that provider key again.', 428), { code: 'CREDENTIAL_RESET_REQUIRED', publicMessage: 'Your saved AI key needs to be entered again in Settings before an interview can start.' });
      }
      if (!row || (!current.geminiConfigured && !current.groqConfigured)) throw Object.assign(fail('Configure an AI provider key before starting an interview.', 428), { code: 'PROVIDER_NOT_CONFIGURED' });
      return { geminiKey: current.geminiConfigured ? decryptSecret(row.encryptedGeminiKey, config.encryptionSecret) : '', groqKey: current.groqConfigured ? decryptSecret(row.encryptedGroqKey, config.encryptionSecret) : '' };
    },
    async modelCatalog(userId, suppliedKeys = null) {
      const cached = modelCache.get(userId);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const keys = suppliedKeys || await this.resolve(userId);
      const entries = await Promise.all(['groq', 'gemini'].map(async (provider) => {
        const apiKey = provider === 'groq' ? keys.groqKey : keys.geminiKey;
        if (!apiKey) return [provider, []];
        try { return [provider, await providerModels(fetchImpl, provider, apiKey)]; }
        catch (error) { return [provider, { error: error.message }]; }
      }));
      const value = Object.fromEntries(entries);
      modelCache.set(userId, { value, expiresAt: Date.now() + CACHE_MS });
      return value;
    },
  };
}
