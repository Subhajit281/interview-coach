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
