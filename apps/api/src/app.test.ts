import assert from 'node:assert/strict';
import test from 'node:test';
import { API_BODY_LIMIT_BYTES, createApp } from './app.js';
import type { IdentitySessionRepository } from './modules/identity/repository.js';

test('liveness is available without database access and preserves a bounded correlation id', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: { 'x-request-id': 'upstream-correlation-id' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-request-id'], 'upstream-correlation-id');
  await app.close();
});

test('unsafe request ids are replaced before they reach handlers or audit context', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: { 'x-request-id': `unsafe value ${'x'.repeat(256)}` },
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/i);
  await app.close();
});

test('liveness generates and returns a request id when the client omits one', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({ method: 'GET', url: '/health/live' });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/i);
  await app.close();
});

test('readiness succeeds when the database dependency is available', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
  assert.ok(response.headers['x-request-id']);
  await app.close();
});

test('readiness is unavailable when its dependency fails', async () => {
  const app = createApp(async () => Promise.reject(new Error('db unavailable')), false);
  const response = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(response.statusCode, 503);
  assert.ok(response.headers['x-request-id']);
  await app.close();
});

test('metrics exposes liveness and a request id', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /isuv_api_up 1/);
  assert.ok(response.headers['x-request-id']);
  await app.close();
});

test('responses deny browser caching, framing, referrer leakage, and untrusted CORS', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: { origin: 'https://untrusted.example' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  await app.close();
});

test('oversized request bodies return a typed 413 without invoking identity resolution', async () => {
  let identityCalls = 0;
  const app = createApp(async () => undefined, false, {
    identityProvider: {
      async resolve() {
        identityCalls += 1;
        return null;
      },
    },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/observations',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ value: 'x'.repeat(API_BODY_LIMIT_BYTES) }),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  assert.equal(response.json().error.requestId, response.headers['x-request-id']);
  assert.equal(identityCalls, 0);
  await app.close();
});

test('unexpected failures are normalized without exposing implementation details', async () => {
  const sessionRepository: IdentitySessionRepository = {
    async findCurrentSession() {
      throw new Error('sensitive database implementation detail');
    },
  };
  const app = createApp(async () => undefined, false, {
    identityProvider: {
      async resolve() {
        return {
          userId: 'a3000000-0000-4000-8000-000000000001',
          provider: 'local-development',
        };
      },
    },
    identitySessionRepository: sessionRepository,
  });
  const response = await app.inject({ method: 'GET', url: '/api/v1/session' });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    error: {
      code: 'UNAVAILABLE',
      message: 'The API is temporarily unavailable.',
      requestId: response.headers['x-request-id'],
    },
  });
  assert.doesNotMatch(response.body, /sensitive database implementation detail/);
  await app.close();
});
