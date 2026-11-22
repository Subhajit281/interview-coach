import { decryptSecret, encryptSecret } from '../utils/encryption.js';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value) => String(value || '').trim();
export function createCredentialService({ prisma, config, fetchImpl = fetch }) {
  const state = (row) => ({ geminiConfigured: Boolean(row?.geminiConfigured), groqConfigured: Boolean(row?.groqConfigured) });
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
      return state(await prisma.userApiCredential.upsert({ where: { userId }, create: { userId, ...data }, update: data }));
    },
    async remove(userId, provider) { return this.update(userId, provider === 'gemini' ? { geminiKey: '' } : provider === 'groq' ? { groqKey: '' } : (() => { throw fail('Unknown provider.'); })()); },
    async resolve(userId) {
      const row = await prisma.userApiCredential.findUnique({ where: { userId } });
      if (!row || (!row.geminiConfigured && !row.groqConfigured)) throw Object.assign(fail('Configure an AI provider key before starting an interview.', 428), { code: 'PROVIDER_NOT_CONFIGURED' });
      return { geminiKey: row.geminiConfigured ? decryptSecret(row.encryptedGeminiKey, config.encryptionSecret) : '', groqKey: row.groqConfigured ? decryptSecret(row.encryptedGroqKey, config.encryptionSecret) : '' };
    },
  };
}
