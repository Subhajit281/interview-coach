const env = process.env;
const production = env.NODE_ENV === 'production';
// Groq retired these IDs for free/developer accounts in August 2026. Keep this
// normalization server-side so a stale Render environment variable cannot make
// every interview fail before the fallback is attempted.
const RETIRED_GROQ_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct']);
const configuredGroqModel = env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b';
const configuredGroqFallback = env.GROQ_LLM_FALLBACK_MODEL || 'openai/gpt-oss-20b';
const groqModel = RETIRED_GROQ_MODELS.has(configuredGroqModel) ? 'openai/gpt-oss-120b' : configuredGroqModel;
const groqFallbackModel = RETIRED_GROQ_MODELS.has(configuredGroqFallback) || configuredGroqFallback === groqModel ? 'openai/gpt-oss-20b' : configuredGroqFallback;
export const config = {
  port: Number(env.BACKEND_PORT || env.PORT || 3001),
  clientOrigin: env.FRONTEND_URL || env.CLIENT_ORIGIN || 'http://localhost:5173',
  production,
  trustProxy: /^\d+$/.test(env.TRUST_PROXY || '') ? Number(env.TRUST_PROXY) : false,
  cookieSecure: production,
  accessTokenSecret: env.JWT_ACCESS_SECRET || '',
  refreshTokenSecret: env.JWT_REFRESH_SECRET || '',
  encryptionSecret: env.API_KEY_ENCRYPTION_SECRET || '',
  accessTokenTtl: env.JWT_ACCESS_TTL || '15m',
  refreshTokenDays: Number(env.JWT_REFRESH_DAYS || 7),
  allowDevelopmentProviderKeys: !production && env.ALLOW_DEVELOPMENT_PROVIDER_KEYS === 'true',
  dbPath: env.DB_PATH || './data/coach.db',
  groq: { apiKey: env.GROQ_API_KEY || '', sttModel: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo', sttLanguage: env.STT_LANGUAGE || 'en', llmModel: groqModel, llmFallbackModel: groqFallbackModel },
  gemini: { apiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-2.5-flash' },
  sttDailyBudgetSec: Number(env.STT_DAILY_BUDGET_SEC || 28800),
};
