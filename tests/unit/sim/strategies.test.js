// Tests des stratégies de picking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderByOrder, zoneWave, getStrategy, STRATEGIES } from '../../../sim/strategies.js';

// Fabrique une commande minimale pour les stratégies (seuls state et zone comptent)
function order(id, lineSpecs) {
  return {
    id,
    lines: lineSpecs.map(([zone, state = 'pending'], i) => ({
      orderId: id,
      slotId: `s-${id}-${i}`,
      zone,
      state,
    })),
  };
}

test('orderByOrder produit une mission par commande entière, en FIFO', () => {
  const orders = [order(1, [['Z1'], ['Z2']]), order(2, [['Z1']]), order(3, [['Z3']])];
  const missions = orderByOrder.plan(orders, 2);
  assert.equal(missions.length, 2);
  assert.deepEqual(missions[0].map((l) => l.orderId), [1, 1]);
  assert.deepEqual(missions[1].map((l) => l.orderId), [2]);
});

test('orderByOrder ignore les commandes déjà entamées', () => {
  const orders = [order(1, [['Z1', 'planned'], ['Z2']]), order(2, [['Z1']])];
  const missions = orderByOrder.plan(orders, 5);
  assert.equal(missions.length, 1);
  assert.equal(missions[0][0].orderId, 2);
});

test('orderByOrder ne dépasse pas le nombre de missions demandé', () => {
  const orders = [order(1, [['Z1']]), order(2, [['Z1']]), order(3, [['Z1']])];
  assert.equal(orderByOrder.plan(orders, 1).length, 1);
});

test('zoneWave regroupe les lignes de plusieurs commandes par zone', () => {
  const orders = [order(1, [['Z1'], ['Z2']]), order(2, [['Z1']]), order(3, [['Z1']])];
  const missions = zoneWave.plan(orders, 1, { waveSize: 20 });
  assert.equal(missions.length, 1);
  // La zone la plus chargée (Z1 : 3 lignes) est servie en premier
  assert.ok(missions[0].every((l) => l.zone === 'Z1'));
  assert.equal(missions[0].length, 3);
  assert.deepEqual(new Set(missions[0].map((l) => l.orderId)), new Set([1, 2, 3]));
});

test('zoneWave découpe une zone chargée en vagues de taille bornée', () => {
  const orders = [order(1, Array.from({ length: 25 }, () => ['Z1']))];
  const missions = zoneWave.plan(orders, 5, { waveSize: 10 });
  assert.deepEqual(missions.map((m) => m.length), [10, 10, 5]);
});

test('zoneWave ignore les lignes déjà planifiées', () => {
  const orders = [order(1, [['Z1', 'planned'], ['Z1', 'picked'], ['Z1']])];
  const missions = zoneWave.plan(orders, 5, { waveSize: 10 });
  assert.equal(missions.length, 1);
  assert.equal(missions[0].length, 1);
});

test('zoneWave sans lignes en attente ne produit aucune mission', () => {
  assert.deepEqual(zoneWave.plan([], 3, { waveSize: 10 }), []);
});

test('getStrategy résout les deux stratégies et rejette les inconnues', () => {
  assert.equal(getStrategy('orderByOrder'), orderByOrder);
  assert.equal(getStrategy('zoneWave'), zoneWave);
  assert.ok(STRATEGIES.size >= 2, 'au moins 2 stratégies comparables exigées');
  assert.throws(() => getStrategy('inconnue'), /Stratégie inconnue/);
});
