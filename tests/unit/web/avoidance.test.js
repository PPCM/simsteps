// Tests du module d'évitement visuel (séparation des agents au sol).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separationOffsets, MAX_SEPARATION_OFFSET } from '../../../web/public/js/avoidance.js';

test('deux agents mobiles qui se chevauchent sont écartés symétriquement', () => {
  const offsets = separationOffsets([
    { id: 'a', x: 0, z: 0, r: 0.5, movable: true },
    { id: 'b', x: 0.4, z: 0, r: 0.5, movable: true },
  ]);
  const a = offsets.get('a');
  const b = offsets.get('b');
  // Chacun prend la moitié du recouvrement (0,6 m), en sens opposés
  assert.ok(Math.abs(a.dx + 0.3) < 1e-9 && Math.abs(a.dz) < 1e-9);
  assert.ok(Math.abs(b.dx - 0.3) < 1e-9 && Math.abs(b.dz) < 1e-9);
  // Positions décalées : exactement à la distance minimale
  const dist = Math.abs((0 + a.dx) - (0.4 + b.dx));
  assert.ok(Math.abs(dist - 1.0) < 1e-9);
});

test('des agents éloignés ne sont pas décalés', () => {
  const offsets = separationOffsets([
    { id: 'a', x: 0, z: 0, r: 0.5, movable: true },
    { id: 'b', x: 3, z: 0, r: 0.5, movable: true },
  ]);
  assert.equal(offsets.size, 0);
});

test('un agent immobile repousse sans bouger', () => {
  const offsets = separationOffsets([
    { id: 'mobile', x: 0, z: 0, r: 0.5, movable: true },
    { id: 'gare', x: 0.4, z: 0, r: 0.5, movable: false },
  ]);
  assert.equal(offsets.has('gare'), false);
  // Le mobile absorbe tout le recouvrement
  assert.ok(Math.abs(offsets.get('mobile').dx + 0.6) < 1e-9);
});

test('deux agents immobiles restent en place', () => {
  const offsets = separationOffsets([
    { id: 'a', x: 0, z: 0, r: 0.5, movable: false },
    { id: 'b', x: 0.1, z: 0, r: 0.5, movable: false },
  ]);
  assert.equal(offsets.size, 0);
});

test('deux agents confondus sont séparés sur un axe de repli déterministe', () => {
  const agents = [
    { id: 'a', x: 2, z: 2, r: 0.5, movable: true },
    { id: 'b', x: 2, z: 2, r: 0.5, movable: true },
  ];
  const first = separationOffsets(agents);
  const second = separationOffsets(agents);
  const a = first.get('a');
  const b = first.get('b');
  assert.ok(Math.hypot(a.dx, a.dz) > 0.49, 'l’agent a doit être poussé');
  // Sens opposés (la somme s'annule) et résultat reproductible
  assert.ok(Math.abs(a.dx + b.dx) < 1e-9 && Math.abs(a.dz + b.dz) < 1e-9);
  assert.deepEqual(first, second);
});

test('la poussée cumulée est bornée', () => {
  const offsets = separationOffsets([
    { id: 'a', x: 0, z: 0, r: 5, movable: true },
    { id: 'b', x: 0.1, z: 0, r: 5, movable: true },
  ]);
  const a = offsets.get('a');
  assert.ok(Math.abs(Math.hypot(a.dx, a.dz) - MAX_SEPARATION_OFFSET) < 1e-9);
});
