import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = (token) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
// This is deliberately enforced on the server (rather than only hiding the
// registration button), so a direct API call cannot create user number 26.
export const MAX_REGISTERED_USERS = 25;
const registrationLimitReached = () => Object.assign(
  fail(`Registration is closed: the ${MAX_REGISTERED_USERS}-user limit has been reached.`, 403),
  {
    code: 'REGISTRATION_LIMIT_REACHED',
    publicMessage: `The ${MAX_REGISTERED_USERS}-user limit has been reached. No more registrations are available right now.`,
  },
);
const isTransactionConflict = (error) => error?.code === 'P2034';

export function createAuthService({ prisma, config }) {
  const accessToken = (user) => jwt.sign({ sub: user.id, email: user.email }, config.accessTokenSecret, { expiresIn: config.accessTokenTtl });
  async function issue(user) {
    const refreshToken = randomBytes(48).toString('base64url');
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: digest(refreshToken), expiresAt: new Date(Date.now() + config.refreshTokenDays * 86400000) } });
    return { accessToken: accessToken(user), refreshToken };
  }
  return {
    async register({ name, email, password, confirmPassword }) {
      const cleanName = String(name || '').trim(), cleanEmail = normalizeEmail(email);
      if (cleanName.length < 2 || cleanName.length > 120) throw fail('Enter a name between 2 and 120 characters.');
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw fail('Enter a valid email address.');
      if (typeof password !== 'string' || password.length < 12) throw fail('Use a password with at least 12 characters.');
      if (password !== confirmPassword) throw fail('Passwords do not match.');
      const createUser = async (tx) => {
        if (await tx.user.findUnique({ where: { email: cleanEmail }, select: { id: true } })) throw fail('An account with that email already exists.', 409);
        if (await tx.user.count() >= MAX_REGISTERED_USERS) throw registrationLimitReached();
        return tx.user.create({ data: { name: cleanName, email: cleanEmail, passwordHash: await bcrypt.hash(password, 12) }, select: { id: true, name: true, email: true } });
      };

      // Serializable transactions prevent two registrations that arrive at the
      // same time from both seeing slot 25 as available. PostgreSQL may abort
      // one competing transaction, so retry that safe, transient conflict.
      if (!prisma.$transaction) return createUser(prisma);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await prisma.$transaction(createUser, { isolationLevel: 'Serializable' });
        } catch (error) {
          if (!isTransactionConflict(error) || attempt === 2) throw error;
        }
      }
    },
    async login({ email, password }) {
      const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
      if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) throw fail('Invalid email or password.', 401);
      return { ...(await issue(user)), user: { id: user.id, name: user.name, email: user.email } };
    },
    async refresh(token) {
      const row = await prisma.refreshToken.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
      if (!row || row.revoked || row.expiresAt <= new Date()) throw fail('Session expired. Please log in again.', 401);
      await prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } });
      return issue(row.user);
    },
    revokeRefreshToken: (token) => prisma.refreshToken.updateMany({ where: { tokenHash: digest(token), revoked: false }, data: { revoked: true } }),
    async verifyPassword(userId, password) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      return Boolean(user && await bcrypt.compare(String(password || ''), user.passwordHash));
    },
  };
}
