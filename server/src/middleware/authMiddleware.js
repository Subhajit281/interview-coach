import jwt from 'jsonwebtoken';
export function createAuthMiddleware({ prisma, config }) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication is required.' });
    try {
      const payload = jwt.verify(token, config.accessTokenSecret);
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true } });
      if (!user) return res.status(401).json({ error: 'Authentication is required.' });
      req.userId = user.id; req.user = user; return next();
    } catch { return res.status(401).json({ error: 'Your session has expired. Please log in again.' }); }
  };
}
