// Tests des calculs de géométrie 3D (module pur, sans DOM ni Three.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { floorSize, rackBoxes, zonePatches, aisleLabels, slotCount } from '../../../web/public/js/layout.js';

const def = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

test('floorSize reprend les dimensions de la définition', () => {
  assert.deepEqual(floorSize(def), { width: 44, depth: 42 });
});

test('rackBoxes produit un volume par rack, contenu dans le sol', () => {
  const boxes = rackBoxes(def);
  assert.equal(boxes.length, def.racks.length);
  for (const box of boxes) {
    assert.ok(box.x - box.width / 2 >= 0 && box.x + box.width / 2 <= 44, `rack ${box.id} hors sol en x`);
    assert.ok(box.z - box.depth / 2 >= 0 && box.z + box.depth / 2 <= 42, `rack ${box.id} hors sol en z`);
    assert.ok(box.height >= 2.4);
  }
});

test('les racks gauche et droite d’une allée encadrent son axe sans le couvrir', () => {
  const boxes = rackBoxes(def);
  const aisle = def.aisles[0];
  const left = boxes.find((b) => b.id === 'R01'); // gauche de A1
  const right = boxes.find((b) => b.id === 'R02'); // droite de A1
  assert.ok(left.x + left.width / 2 < aisle.x, 'le rack gauche empiète sur l’allée');
  assert.ok(right.x - right.width / 2 > aisle.x, 'le rack droit empiète sur l’allée');
});

test('rackBoxes rejette une allée ou un côté inconnus', () => {
  assert.throws(
    () => rackBoxes({ ...def, racks: [{ id: 'RX', aisle: 'A99', side: 'gauche', levels: 1 }] }),
    /allée inconnue/
  );
  assert.throws(
    () => rackBoxes({ ...def, racks: [{ id: 'RX', aisle: 'A1', side: 'milieu', levels: 1 }] }),
    /côté inconnu/
  );
});

test('zonePatches couvre ateliers, expédition et réception avec libellés', () => {
  const patches = zonePatches(def);
  assert.equal(patches.length, def.workshops.length + 2);
  assert.deepEqual(
    patches.map((p) => p.kind).sort(),
    ['receiving', 'shipping', 'workshop', 'workshop']
  );
  for (const patch of patches) {
    assert.ok(patch.label.length > 0);
    assert.ok(patch.width > 0 && patch.depth > 0);
  }
});

test('aisleLabels place une étiquette par allée, en tête d’allée', () => {
  const labels = aisleLabels(def);
  assert.equal(labels.length, 6);
  for (const [i, label] of labels.entries()) {
    assert.equal(label.id, def.aisles[i].id);
    assert.equal(label.x, def.aisles[i].x);
    assert.ok(label.z < def.aisles[i].yStart);
  }
});

test('slotCount compte les emplacements de l’entrepôt d’exemple', () => {
  assert.equal(slotCount(def), 204);
});

test('la largeur du couloir d’une allée écarte ses racks', () => {
  const custom = structuredClone(def);
  custom.aisles[0].width = 3;
  const boxes = rackBoxes(custom);
  const left = boxes.find((b) => b.id === 'R01');
  const right = boxes.find((b) => b.id === 'R02');
  const corridor = (right.x - right.width / 2) - (left.x + left.width / 2);
  assert.ok(Math.abs(corridor - 3) < 1e-9, `couloir attendu 3 m, obtenu ${corridor}`);
});

test('zonePatches respecte les tailles par zone et les listes', () => {
  const custom = structuredClone(def);
  custom.shipping = [
    { id: 'E1', label: 'Expédition 1', x: 5, y: 2, width: 8, depth: 4 },
    { id: 'E2', label: 'Expédition 2', x: 12, y: 2 },
  ];
  const zones = zonePatches(custom);
  const e1 = zones.find((z) => z.id === 'E1');
  assert.equal(e1.width, 8);
  assert.equal(e1.depth, 4);
  const e2 = zones.find((z) => z.id === 'E2');
  assert.equal(e2.width, 4.8); // défaut quand la taille n'est pas précisée
  assert.equal(e2.depth, 3);
  assert.ok(zones.some((z) => z.id === 'REC' && z.kind === 'receiving'));
});
