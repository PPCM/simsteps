// Tests des calculs de géométrie 3D (module pur, sans DOM ni Three.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { floorSize, rackBoxes, zonePatches, aisleLabels, slotCount, gridSegments, corridorBands, corridorJunctions, obstacleBoxes, conveyorBelts } from '../../../web/public/js/layout.js';

const def = JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
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
    // Hauteur = niveaux × hauteur de niveau (défaut 2 m)
    assert.equal(box.height, box.levels * box.levelHeight);
    assert.ok(box.height >= 2);
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

test('gridSegments couvre exactement le sol, sans déborder', () => {
  const lines = gridSegments(def); // sol 44 × 42
  assert.equal(lines.length, (44 + 1) + (42 + 1));
  for (const [x1, z1, x2, z2] of lines) {
    assert.ok(x1 >= 0 && x2 <= 44, 'segment hors sol en x');
    assert.ok(z1 >= 0 && z2 <= 42, 'segment hors sol en z');
  }
  // Ne change que la dimension modifiée (grille non carrée)
  const wider = structuredClone(def);
  wider.dimensions.width = 64;
  const wideLines = gridSegments(wider);
  assert.equal(wideLines.length, (64 + 1) + (42 + 1));
  assert.ok(wideLines.every(([, z1, , z2]) => z1 >= 0 && z2 <= 42));
  // Dimensions fractionnaires : lignes de bord ajoutées
  const frac = structuredClone(def);
  frac.dimensions.width = 44.5;
  assert.ok(gridSegments(frac).some(([x1, , x2]) => x1 === 44.5 && x2 === 44.5));
});

test('corridorBands convertit le format historique en deux bandes pleine largeur', () => {
  const bands = corridorBands(def); // couloirs à y = 4 et y = 38
  assert.equal(bands.length, 2);
  const front = bands.find((b) => b.id === 'C1');
  const back = bands.find((b) => b.id === 'C2');
  assert.equal(front.z, def.corridors.frontY);
  assert.equal(front.label, 'Couloir avant');
  assert.equal(back.z, def.corridors.backY);
  assert.equal(back.label, 'Couloir arrière');
  for (const band of bands) {
    assert.equal(band.width, def.dimensions.width);
    assert.equal(band.x, def.dimensions.width / 2);
    assert.ok(band.depth > 0);
  }
});

test('corridorBands rend les segments horizontaux et verticaux', () => {
  const custom = structuredClone(def);
  custom.corridors = [
    { id: 'C1', label: 'Transversal', x: 4, y: 10, length: 30, width: 2, orientation: 'horizontal' },
    { id: 'C2', label: 'Longitudinal', x: 40, y: 5, length: 20, orientation: 'vertical' },
  ];
  const [h, v] = corridorBands(custom);
  assert.deepEqual({ x: h.x, z: h.z, width: h.width, depth: h.depth }, { x: 19, z: 10, width: 30, depth: 2 });
  assert.deepEqual({ x: v.x, z: v.z, width: v.width, depth: v.depth }, { x: 40, z: 15, width: 1.4, depth: 20 });
});

test('corridorJunctions repère croisements et extrémités coïncidentes', () => {
  const custom = structuredClone(def);
  custom.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, orientation: 'horizontal' },
    // Vertical reliant les deux transversaux : deux croisements
    { id: 'C3', x: 10, y: 4, length: 34, orientation: 'vertical' },
    // Prolongement en coin : extrémité commune avec C2 en (44, 38)
    { id: 'C4', x: 44, y: 20, length: 18, orientation: 'vertical' },
  ];
  const points = corridorJunctions(custom).map((p) => `${p.x},${p.z}`).sort();
  assert.deepEqual(points, ['10,38', '10,4', '44,38']);
  // Format historique : deux couloirs parallèles, aucune jonction
  assert.deepEqual(corridorJunctions(def), []);
});

test('rackBoxes respecte hauteur de niveau et profondeur par rack', () => {
  const custom = structuredClone(def);
  custom.racks[0] = { ...custom.racks[0], levels: 3, levelHeight: 2.5, depth: 2 };
  const box = rackBoxes(custom).find((b) => b.id === custom.racks[0].id);
  assert.equal(box.height, 7.5);
  assert.equal(box.width, 2);
  assert.equal(box.levels, 3);
  assert.equal(box.levelHeight, 2.5);
  // Le rack plus profond s'écarte davantage de l'axe de l'allée
  const aisle = custom.aisles[0];
  assert.ok(Math.abs(box.x - aisle.x) > Math.abs(rackBoxes(def)[0].x - aisle.x));
});

test('obstacleBoxes expose les blocs avec leurs défauts', () => {
  const boxes = obstacleBoxes({
    obstacles: [
      { id: 'OB1', x: 3, y: 20 },
      { id: 'OB2', label: 'Bureau', x: 10, y: 22, width: 4, depth: 3, height: 2.5 },
    ],
  });
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { id: 'OB1', label: 'OB1', x: 3, z: 20, width: 1, depth: 1, height: 3 });
  assert.equal(boxes[1].height, 2.5);
  assert.deepEqual(obstacleBoxes({}), []);
});

test('conveyorBelts rend les bandes horizontales et verticales', () => {
  const belts = conveyorBelts({
    conveyors: [
      { id: 'CV1', x: 10, y: 5, length: 8, orientation: 'horizontal' },
      { id: 'CV2', label: 'Ligne 2', x: 30, y: 10, length: 6, orientation: 'vertical' },
    ],
  });
  assert.deepEqual({ x: belts[0].x, z: belts[0].z, width: belts[0].width, depth: belts[0].depth },
    { x: 14, z: 5, width: 8, depth: 0.9 });
  assert.deepEqual({ x: belts[1].x, z: belts[1].z, width: belts[1].width, depth: belts[1].depth },
    { x: 30, z: 13, width: 0.9, depth: 6 });
  assert.deepEqual(conveyorBelts({}), []);
});
