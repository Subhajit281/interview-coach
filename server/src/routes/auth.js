import express from 'express';
import { rateLimiter } from '../middleware/rateLimiter.js';
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const setCookie = (res, token, config) => res.cookie('refreshToken', token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api/auth', maxAge: config.refreshTokenDays * 86400000 });
export function createAuthRouter({ auth, credentials, config, requireAuth }) {
  const router = express.Router();
  router.post('/register', rateLimiter, wrap(async (req, res) => { const user = await auth.register(req.body || {}); res.status(201).json({ user, message: 'Registration successful' }); }));
  router.post('/login', rateLimiter, wrap(async (req, res) => { const result = await auth.login(req.body || {}); setCookie(res, result.refreshToken, config); res.json({ accessToken: result.accessToken, user: result.user }); }));
  router.post('/refresh', wrap(async (req, res) => { if (!req.cookies?.refreshToken) throw Object.assign(new Error('Session expired. Please log in again.'), { status: 401 }); const result = await auth.refresh(req.cookies.refreshToken); setCookie(res, result.refreshToken, config); res.json({ accessToken: result.accessToken }); }));
  router.post('/logout', wrap(async (req, res) => { if (req.cookies?.refreshToken) await auth.revokeRefreshToken(req.cookies.refreshToken); res.clearCookie('refreshToken', { path: '/api/auth' }); res.json({ ok: true }); }));
  router.get('/me', requireAuth, wrap(async (req, res) => res.json({ user: req.user, credentials: await credentials.status(req.userId) })));
  router.get('/credentials', requireAuth, wrap(async (req, res) => res.json(await credentials.status(req.userId))));
  router.put('/credentials', requireAuth, wrap(async (req, res) => { const existing = await credentials.status(req.userId); if ((existing.geminiConfigured || existing.groqConfigured) && !(await auth.verifyPassword(req.userId, req.body?.currentPassword))) throw Object.assign(new Error('Password verification failed.'), { status: 401 }); res.json(await credentials.update(req.userId, req.body || {})); }));
  router.delete('/credentials/:provider', requireAuth, wrap(async (req, res) => { if (!(await auth.verifyPassword(req.userId, req.body?.password))) throw Object.assign(new Error('Password verification failed.'), { status: 401 }); res.json(await credentials.remove(req.userId, req.params.provider)); }));
  return router;
}
