import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const keyFor = (secret) => {
  if (typeof secret !== 'string' || secret.length < 32) throw Object.assign(new Error('Server encryption is not configured.'), { status: 503 });
  return createHash('sha256').update(secret).digest();
};
export function encryptSecret(value, secret) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function decryptSecret(value, secret) {
  if (!value?.iv || !value?.tag || !value?.ciphertext) throw new Error('Stored credential is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
