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
