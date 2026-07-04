// Tests de la génération de commandes B2C / B2B.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../sim/rng.js';
import { makeOrder, drawProfile, PROFILES } from '../../../sim/orders.js';

const slotIds = Array.from({ length: 200 }, (_, i) => `S-${i + 1}`);

test('une commande B2C compte 1 à 3 lignes de 1 à 3 unités', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 200; i++) {
    const order = makeOrder(rng, { id: i, profile: 'B2C', slotIds });
    assert.ok(order.lines.length >= 1 && order.lines.length <= 3);
    for (const line of order.lines) {
      assert.ok(line.qty >= 1 && line.qty <= 3);
    }
    assert.equal(order.clientId, null, 'une commande B2C n’a pas de client B2B');
  }
});

test('une commande B2B compte 10 à 50 lignes de 5 à 20 unités et un client', () => {
  const rng = mulberry32(2);
  for (let i = 0; i < 100; i++) {
    const order = makeOrder(rng, { id: i, profile: 'B2B', slotIds, b2bClients: 8 });
    assert.ok(order.lines.length >= 10 && order.lines.length <= 50);
    for (const line of order.lines) {
      assert.ok(line.qty >= 5 && line.qty <= 20);
    }
    assert.match(order.clientId, /^client-[1-8]$/);
  }
});

test('les lignes d’une commande portent des emplacements distincts', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 50; i++) {
    const order = makeOrder(rng, { id: i, profile: 'B2B', slotIds });
    const unique = new Set(order.lines.map((l) => l.slotId));
    assert.equal(unique.size, order.lines.length);
  }
});

test('la génération est reproductible à graine identique', () => {
  const a = makeOrder(mulberry32(42), { id: 1, profile: 'B2B', slotIds });
  const b = makeOrder(mulberry32(42), { id: 1, profile: 'B2B', slotIds });
  assert.deepEqual(a, b);
});

test('drawProfile respecte approximativement la part B2C demandée', () => {
  const rng = mulberry32(5);
  let b2c = 0;
  const n = 10000;
  for (let i = 0; i < n; i++) {
    if (drawProfile(rng, 0.7) === 'B2C') b2c++;
  }
  assert.ok(Math.abs(b2c / n - 0.7) < 0.03, `part B2C observée : ${b2c / n}`);
});

test('un profil inconnu lève une erreur explicite', () => {
  assert.throws(() => makeOrder(mulberry32(1), { id: 1, profile: 'B2X', slotIds }), /Profil/);
});

test('les profils du cahier des charges sont exposés', () => {
  assert.ok(PROFILES.B2C && PROFILES.B2B);
});
