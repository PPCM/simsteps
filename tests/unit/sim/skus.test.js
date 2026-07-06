// Tests des références et du rangement (rotation ABC, slotting).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';
import { buildSlotting, ROTATION_CLASSES, SLOTTINGS } from '../../../sim/skus.js';
import { mulberry32 } from '../../../sim/rng.js';

const spec = JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
);
const warehouse = buildWarehouse(spec);

test('les parts des classes de rotation somment à 1', () => {
  const slotShare = ROTATION_CLASSES.reduce((s, c) => s + c.slotShare, 0);
  const pickShare = ROTATION_CLASSES.reduce((s, c) => s + c.pickShare, 0);
  assert.ok(Math.abs(slotShare - 1) < 1e-9);
  assert.ok(Math.abs(pickShare - 1) < 1e-9);
  assert.deepEqual(SLOTTINGS, ['aleatoire', 'abc']);
});

test('chaque emplacement reçoit une classe, aux parts attendues', () => {
  const { classBySlot } = buildSlotting(warehouse, 'aleatoire', mulberry32(1));
  assert.equal(classBySlot.size, warehouse.slots.size);
  const counts = { A: 0, B: 0, C: 0 };
  for (const cls of classBySlot.values()) counts[cls]++;
  assert.equal(counts.A, Math.round(warehouse.slots.size * 0.2));
  assert.equal(counts.B, Math.round(warehouse.slots.size * 0.3));
});

test('le tirage concentre les lignes sur la classe A', () => {
  const rng = mulberry32(2);
  const { drawSlot, classBySlot } = buildSlotting(warehouse, 'aleatoire', rng);
  const counts = { A: 0, B: 0, C: 0 };
  for (let i = 0; i < 5000; i++) counts[classBySlot.get(drawSlot())]++;
  assert.ok(counts.A / 5000 > 0.75 && counts.A / 5000 < 0.85, `part A : ${counts.A / 5000}`);
  assert.ok(counts.C / 5000 < 0.1);
});

test('le slotting abc place la classe A au plus près de l’expédition', () => {
  const { classBySlot } = buildSlotting(warehouse, 'abc', mulberry32(3));
  const distances = warehouse.graph.distancesFrom(warehouse.shippingNodeId);
  const distOf = (cls) => {
    const values = [...classBySlot.entries()]
      .filter(([, c]) => c === cls)
      .map(([slotId]) => distances.get(warehouse.slots.get(slotId).nodeId));
    return values.reduce((s, v) => s + v, 0) / values.length;
  };
  assert.ok(distOf('A') < distOf('B'));
  assert.ok(distOf('B') < distOf('C'));
});

test('le tirage est déterministe à graine identique', () => {
  const a = buildSlotting(warehouse, 'abc', mulberry32(4));
  const b = buildSlotting(warehouse, 'abc', mulberry32(4));
  const drawsA = Array.from({ length: 50 }, () => a.drawSlot());
  const drawsB = Array.from({ length: 50 }, () => b.drawSlot());
  assert.deepEqual(drawsA, drawsB);
});
