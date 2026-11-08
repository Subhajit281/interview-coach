import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import { apiRouter } from './routes/api.js';
import { createRepo } from './services/repo.js';
import { createUsageTracker } from './services/usage.js';
import { createGroq } from './services/groq.js';
import { createGemini } from './services/gemini.js';
import { createLlm } from './services/llm.js';
import { createInterviewer } from './services/interviewer.js';
import { createEvaluator } from './services/evaluator.js';
import { createStt } from './services/stt.js';

const here = dirname(fileURLToPath(import.meta.url));

/** All collaborators can be injected for tests; defaults wire the real providers. */
export function createApp({ db, llm, stt, fetchImpl, sleep } = {}) {
  const repo = createRepo(db);
  const tracker = createUsageTracker({ sttDailyBudgetSec: config.sttDailyBudgetSec });
  const groq = createGroq({ config, fetchImpl, sleep, tracker });
  const gemini = createGemini({ config, fetchImpl, sleep });
  const theLlm = llm ?? createLlm({ config, groq, gemini });
  const theStt = stt ?? createStt({ config, groq, tracker });

  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter({
    repo, tracker, stt: theStt,
    interviewer: createInterviewer({ repo, llm: theLlm }),
    evaluator: createEvaluator({ repo, llm: theLlm }),
  }));

  const dist = resolve(here, '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err.name === 'MulterError') err.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    let status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (err.name === 'ProviderError' && status !== 503 && status !== 429) status = 502;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });
  return app;
}
