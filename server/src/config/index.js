const env = process.env;
const production = env.NODE_ENV === 'production';
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
  groq: { apiKey: env.GROQ_API_KEY || '', sttModel: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo', sttLanguage: env.STT_LANGUAGE || 'en', llmModel: env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile', llmFallbackModel: env.GROQ_LLM_FALLBACK_MODEL || 'openai/gpt-oss-120b' },
  gemini: { apiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-2.5-flash' },
  sttDailyBudgetSec: Number(env.STT_DAILY_BUDGET_SEC || 28800),
};
