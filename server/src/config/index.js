const env = process.env;

export const config = {
  port: Number(env.PORT || 3001),
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:5173',
  dbPath: env.DB_PATH || './data/coach.db',
  groq: {
    apiKey: env.GROQ_API_KEY || '',
    sttModel: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
    sttLanguage: env.STT_LANGUAGE || 'en',
    llmModel: env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile',
    llmFallbackModel: env.GROQ_LLM_FALLBACK_MODEL || 'openai/gpt-oss-120b',
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.5-flash',
  },
  // Local soft budget so the UI can warn before Groq's free STT cap (audio seconds/day).
  sttDailyBudgetSec: Number(env.STT_DAILY_BUDGET_SEC || 28800),
};
