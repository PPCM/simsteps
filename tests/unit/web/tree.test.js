// Tests de l'arborescence pure des éléments (panneau Structure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTree } from '../../../web/public/js/editor/tree.js';
import { normalizeDefinition, addParking, addBuffer } from '../../../web/public/js/editor/model.js';

const def = normalizeDefinition(JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
));

test('les groupes obligatoires sont présents avec tous leurs éléments', () => {
  const groups = buildTree(def);
  const byType = new Map(groups.map((g) => [g.type, g]));
  assert.equal(byType.get('aisle').items.length, def.aisles.length);
  assert.equal(byType.get('corridor').items.length, def.corridors.length);
  assert.equal(byType.get('workshop').items.length, def.workshops.length);
  assert.ok(byType.has('shipping'));
  assert.ok(byType.has('receiving'));
});

test('les groupes optionnels vides sont omis, puis apparaissent', () => {
  const before = buildTree(def).map((g) => g.type);
  assert.ok(!before.includes('parking'));
  assert.ok(!before.includes('buffer'));
  const withZones = addBuffer(addParking(def));
  const after = new Map(buildTree(withZones).map((g) => [g.type, g]));
  assert.equal(after.get('parking').items.length, 1);
  assert.equal(after.get('buffer').items.length, 1);
});

test('les résumés portent les réglages clés', () => {
  const groups = new Map(buildTree(def).map((g) => [g.type, g]));
  const aisle = groups.get('aisle').items[0];
  const source = def.aisles.find((a) => a.id === aisle.id);
  assert.match(aisle.summary, new RegExp(`^${source.bays} baies · \\d+ niv\\.$`));
  const corridor = groups.get('corridor').items[0];
  assert.match(corridor.summary, /^(horizontal|vertical) · [\d.]+ m$/);
});
