import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
import { createAuthService } from './services/authService.js';
import { createCredentialService } from './services/credentialService.js';
import { createAuthMiddleware } from './middleware/authMiddleware.js';
import { createAuthRouter } from './routes/auth.js';
import { secureApiRouter } from './routes/secureApi.js';
import { createPrismaRepo } from './services/prismaRepo.js';

const here = dirname(fileURLToPath(import.meta.url));

/** All collaborators can be injected for tests; defaults wire the real providers. */
export function createApp({ db, prisma, llm, stt, fetchImpl, sleep } = {}) {
  const repo = db ? createRepo(db) : null;
  const tracker = createUsageTracker({ sttDailyBudgetSec: config.sttDailyBudgetSec });
  const groq = createGroq({ config, fetchImpl, sleep, tracker });
  const gemini = createGemini({ config, fetchImpl, sleep });
  const theLlm = llm ?? createLlm({ config, groq, gemini });
  const theStt = stt ?? createStt({ config, groq, tracker });

  const app = express();
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (prisma) {
    const auth = createAuthService({ prisma, config });
    const credentials = createCredentialService({ prisma, config, fetchImpl });
    const requireAuth = createAuthMiddleware({ prisma, config });
    app.use('/api/auth', createAuthRouter({ auth, credentials, config, requireAuth }));
    app.use('/api', requireAuth, secureApiRouter({ repoForUser: (userId) => createPrismaRepo(prisma, userId), llm: theLlm, stt: theStt, credentials, tracker }));
  } else {
    app.use('/api', apiRouter({ repo, tracker, stt: theStt, interviewer: createInterviewer({ repo, llm: theLlm }), evaluator: createEvaluator({ repo, llm: theLlm }) }));
  }

  const dist = resolve(here, '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err.name === 'MulterError') err.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    let status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (err.name === 'ProviderError' && status !== 503 && status !== 429) status = 502;
    if (status >= 500) console.error(err.name, err.message);
    // Errors that carry a publicMessage are safe to show and tell the UI what to do (e.g. open the model picker).
    if (err.publicMessage) {
      const { code, provider, model, reason, exhausted } = err;
      return res.status(status).json({ error: err.publicMessage, code, provider, model, reason, exhausted });
    }
    // Any other provider rate limit (e.g. voice transcription) never leaks the raw provider response.
    if (err.name === 'ProviderError' && err.status === 429) {
      return res.status(429).json({ error: 'The AI service is busy right now. Please wait a moment and try again.', code: 'PROVIDER_BUSY' });
    }
    res.status(status).json({ error: status >= 500 ? 'The server could not complete that request.' : (err.message || 'Request failed.') });
  });
  return app;
}
