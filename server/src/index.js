import { createApp } from './app.js';
import { openDb } from './db/index.js';
import { config } from './config/index.js';

const db = openDb();
createApp({ db }).listen(config.port, () => {
  console.log(`Interview Coach API on http://localhost:${config.port}`);
  if (!config.groq.apiKey && !config.gemini.apiKey) console.warn('No API keys set. Copy .env.example to .env and add GROQ_API_KEY / GEMINI_API_KEY.');
  else if (!config.groq.apiKey) console.warn('GROQ_API_KEY missing: voice transcription is disabled (typing still works).');
});
