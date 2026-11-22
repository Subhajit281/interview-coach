import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma } from './db/prisma.js';

for (const [name, value] of Object.entries({ JWT_ACCESS_SECRET: config.accessTokenSecret, JWT_REFRESH_SECRET: config.refreshTokenSecret, API_KEY_ENCRYPTION_SECRET: config.encryptionSecret })) {
  if (value.length < 32) throw new Error(`${name} must be configured with a long random value.`);
}
createApp({ prisma }).listen(config.port, () => {
  console.log(`Interview Coach API on http://localhost:${config.port}`);
  console.log('Users must configure their own Gemini and/or Groq credentials.');
});
