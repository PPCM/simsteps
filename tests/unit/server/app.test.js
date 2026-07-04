// Tests de l'application Fastify via inject(), sans base de données :
// le pool est simulé. Vérifie la sonde de santé et la limitation de débit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../../server/app.js';

// Pool factice : répond toujours, sans PostgreSQL
const fakePool = { query: async () => ({ rows: [] }) };

test('la sonde /health répond ok quand la base répond', async () => {
  const app = await buildApp({ pool: fakePool });
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', database: 'up' });
  await app.close();
});

test('la sonde /health répond 503 quand la base est injoignable', async () => {
  const brokenPool = { query: async () => { throw new Error('down'); } };
  const app = await buildApp({ pool: brokenPool });
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().database, 'down');
  await app.close();
});

test('la limitation de débit renvoie 429 au-delà du plafond', async () => {
  const app = await buildApp({ pool: fakePool, rateLimit: { max: 2, timeWindow: '1 minute' } });
  const first = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-ratelimit-limit'], '2');
  await app.inject({ method: 'GET', url: '/health' });
  const third = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(third.statusCode, 429);
  await app.close();
});

test('le plafond par défaut laisse passer l’usage normal', async () => {
  const app = await buildApp({ pool: fakePool });
  for (let i = 0; i < 20; i++) {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
  }
  await app.close();
});
