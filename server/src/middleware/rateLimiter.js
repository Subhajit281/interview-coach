const records = new Map();
export function rateLimiter(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown', now = Date.now();
  const item = records.get(key) || { count: 0, until: now + 900000 };
  if (now >= item.until) { item.count = 0; item.until = now + 900000; }
  item.count += 1; records.set(key, item);
  return item.count > 20 ? res.status(429).json({ error: 'Too many authentication attempts. Try again later.' }) : next();
}
