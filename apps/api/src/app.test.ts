import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';

test('liveness is available without database access', async () => {
  const app = createApp(async () => undefined, false);
  const response = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: { 'x-request-id': 'test-request' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-request-id'], 'test-request');
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
