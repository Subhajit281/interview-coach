import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, MAX_REGISTERED_USERS } from '../src/services/authService.js';

const config = {
  accessTokenSecret: 'test-access-secret',
  accessTokenTtl: '15m',
  refreshTokenDays: 7,
};

function prismaWithUserCount(total) {
  let createCalls = 0;
  const tx = {
    user: {
      findUnique: async () => null,
      count: async () => total,
      create: async () => { createCalls += 1; return { id: 'new-user', name: 'New User', email: 'new@example.com' }; },
    },
  };
  return {
    prisma: { ...tx, $transaction: async (work) => work(tx) },
    getCreateCalls: () => createCalls,
  };
}

test('registration refuses user 26 with a safe public limit message', async () => {
  const fake = prismaWithUserCount(MAX_REGISTERED_USERS);
  const auth = createAuthService({ prisma: fake.prisma, config });

  await assert.rejects(
    auth.register({ name: 'New User', email: 'new@example.com', password: 'a-long-test-password', confirmPassword: 'a-long-test-password' }),
    (error) => error.status === 403
      && error.code === 'REGISTRATION_LIMIT_REACHED'
      && error.publicMessage === 'The 25-user limit has been reached. No more registrations are available right now.',
  );
  assert.equal(fake.getCreateCalls(), 0);
});

test('registration is allowed while fewer than 25 users exist', async () => {
  const fake = prismaWithUserCount(MAX_REGISTERED_USERS - 1);
  const auth = createAuthService({ prisma: fake.prisma, config });
  const user = await auth.register({ name: 'New User', email: 'new@example.com', password: 'a-long-test-password', confirmPassword: 'a-long-test-password' });

  assert.equal(user.id, 'new-user');
  assert.equal(fake.getCreateCalls(), 1);
});

test('a refresh token can only be rotated once', async () => {
  const crypto = await import('node:crypto');
  const rawToken = 'refresh-token-for-test';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  let revoked = false;
  let issued = 0;
  const prisma = {
    refreshToken: {
      findUnique: async () => ({ id: 'refresh-1', tokenHash, revoked, expiresAt: new Date(Date.now() + 60_000), user: { id: 'user-1', email: 'u@example.com' } }),
      updateMany: async ({ where }) => {
        if (where.id !== 'refresh-1' || where.revoked !== false || revoked) return { count: 0 };
        revoked = true;
        return { count: 1 };
      },
      create: async () => { issued += 1; return {}; },
    },
  };
  const auth = createAuthService({ prisma, config });

  await auth.refresh(rawToken);
  await assert.rejects(auth.refresh(rawToken), (error) => error.status === 401);
  assert.equal(issued, 1);
});
