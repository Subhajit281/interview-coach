import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialService } from '../src/services/credentialService.js';
import { encryptSecret } from '../src/utils/encryption.js';

const config = { encryptionSecret: 'a'.repeat(64) };
const row = (key) => ({ geminiConfigured: false, groqConfigured: true, encryptedGeminiKey: null, encryptedGroqKey: key });

test('unreadable saved provider keys are reported as a reset state, not a crypto exception', async () => {
  const prisma = { userApiCredential: { findUnique: async () => row(encryptSecret('gsk_key', 'b'.repeat(64))) } };
  const service = createCredentialService({ prisma, config });
  assert.deepEqual(await service.status('user'), { geminiConfigured: false, groqConfigured: false, credentialResetRequired: true });
  await assert.rejects(service.resolve('user'), (e) => e.status === 428 && e.code === 'CREDENTIAL_RESET_REQUIRED' && /entered again/.test(e.publicMessage));
});

test('readable saved provider keys remain configured', async () => {
  const prisma = { userApiCredential: { findUnique: async () => row(encryptSecret('gsk_key', config.encryptionSecret)) } };
  const service = createCredentialService({ prisma, config });
  assert.deepEqual(await service.status('user'), { geminiConfigured: false, groqConfigured: true, credentialResetRequired: false });
  assert.equal((await service.resolve('user')).groqKey, 'gsk_key');
});

test('model catalog is built from models available to the saved provider keys', async () => {
  const prisma = { userApiCredential: { findUnique: async () => ({
    geminiConfigured: true, groqConfigured: true,
    encryptedGeminiKey: encryptSecret('gem_key', config.encryptionSecret),
    encryptedGroqKey: encryptSecret('gsk_key', config.encryptionSecret),
  }) } };
  const fetchImpl = async (url) => {
    const body = url.includes('api.groq.com')
      ? { data: [{ id: 'openai/gpt-oss-20b' }, { id: 'whisper-large-v3' }] }
      : { models: [
      { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const service = createCredentialService({ prisma, config, fetchImpl });

  assert.deepEqual(await service.modelCatalog('catalog-user'), {
    groq: [{ id: 'openai/gpt-oss-20b', label: 'Openai Gpt Oss 20b', note: 'Available with your Groq key' }],
    gemini: [{ id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', note: 'Available with your Gemini key' }],
  });
});
