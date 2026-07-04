// Tests du modèle pur de l'éditeur d'entrepôt : déplacements contraints,
// ajout/suppression, propriétés et validation. Le vrai buildWarehouse du
// moteur est injecté dans validateDefinition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';
import {
  snapToGrid,
  moveAisle,
  moveFacility,
  addAisle,
  removeAisle,
  addWorkshop,
  removeWorkshop,
  updateAisle,
  updateFacility,
  updateGlobals,
  validateDefinition,
  duplicateDefinition,
  minimalDefinition,
} from '../../../web/public/js/editor/model.js';

const def = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

test('snapToGrid arrondit au mètre', () => {
  assert.equal(snapToGrid(2.4), 2);
  assert.equal(snapToGrid(2.6), 3);
  assert.equal(snapToGrid(-0.6), -1);
});

test('moveAisle accroche à la grille et conserve la longueur', () => {
  const next = moveAisle(def, 'A1', { x: 8.4, yStart: 7.6 });
  const aisle = next.aisles.find((a) => a.id === 'A1');
  assert.equal(aisle.x, 8);
  assert.equal(aisle.yStart, 8);
  assert.equal(aisle.yEnd - aisle.yStart, 35 - 7);
});

test('moveAisle borne x à l’emprise des racks', () => {
  const left = moveAisle(def, 'A1', { x: -10 });
  assert.equal(left.aisles[0].x, 2.1);
  const right = moveAisle(def, 'A1', { x: 100 });
  assert.equal(right.aisles[0].x, def.dimensions.width - 2.1);
});

test('moveAisle borne le départ contre les couloirs', () => {
  const next = moveAisle(def, 'A1', { yStart: 0 });
  const aisle = next.aisles.find((a) => a.id === 'A1');
  assert.equal(aisle.yStart, def.corridors.frontY + 1);
  assert.equal(aisle.yEnd, aisle.yStart + (35 - 7));
});

test('moveAisle ne mute pas la définition d’origine', () => {
  const before = JSON.stringify(def);
  moveAisle(def, 'A1', { x: 20 });
  assert.equal(JSON.stringify(def), before);
});

test('moveFacility borne les trois types dans le sol', () => {
  const workshop = moveFacility(def, 'workshop', 'AT1', { x: -5, y: 200 });
  const moved = workshop.workshops.find((w) => w.id === 'AT1');
  assert.equal(moved.x, 2.4);
  assert.equal(moved.y, def.dimensions.depth - 1.5);
  const shipping = moveFacility(def, 'shipping', 'EXP', { x: 100 });
  assert.equal(shipping.shipping.x, def.dimensions.width - 2.4);
  const receiving = moveFacility(def, 'receiving', 'REC', { x: 10.6, y: 10.2 });
  assert.equal(receiving.receiving.x, 11);
  assert.equal(receiving.receiving.y, 10);
});

test('addAisle génère un id unique et deux racks, définition valide', () => {
  const next = addAisle(def);
  assert.equal(next.aisles.length, def.aisles.length + 1);
  const added = next.aisles[next.aisles.length - 1];
  assert.equal(added.id, 'A7');
  const racks = next.racks.filter((r) => r.aisle === 'A7');
  assert.equal(racks.length, 2);
  assert.deepEqual(racks.map((r) => r.side).sort(), ['droite', 'gauche']);
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('removeAisle supprime l’allée et ses racks', () => {
  const next = removeAisle(def, 'A3');
  assert.ok(!next.aisles.some((a) => a.id === 'A3'));
  assert.ok(!next.racks.some((r) => r.aisle === 'A3'));
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('removeAisle refuse la dernière allée', () => {
  let single = def;
  for (const aisle of def.aisles.slice(1)) single = removeAisle(single, aisle.id);
  assert.equal(single.aisles.length, 1);
  assert.throws(() => removeAisle(single, single.aisles[0].id), /dernière allée/);
});

test('addWorkshop et removeWorkshop gèrent id unique et dernier atelier', () => {
  const added = addWorkshop(def);
  assert.equal(added.workshops.length, def.workshops.length + 1);
  assert.equal(added.workshops[added.workshops.length - 1].id, 'AT3');
  const removed = removeWorkshop(added, 'AT3');
  assert.equal(removed.workshops.length, def.workshops.length);
  let single = removeWorkshop(def, 'AT2');
  assert.throws(() => removeWorkshop(single, 'AT1'), /dernier atelier/);
});

test('updateAisle propage le renommage d’id aux racks', () => {
  const next = updateAisle(def, 'A1', { id: 'AX', zone: 'Z9' });
  assert.ok(next.aisles.some((a) => a.id === 'AX' && a.zone === 'Z9'));
  assert.ok(!next.racks.some((r) => r.aisle === 'A1'));
  assert.equal(next.racks.filter((r) => r.aisle === 'AX').length, 2);
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('bays = 1 est rejeté par validateDefinition (coordonnées NaN sinon)', () => {
  const next = updateAisle(def, 'A1', { bays: 1 });
  const errors = validateDefinition(next, buildWarehouse);
  assert.ok(errors.some((e) => e.includes('bays')));
});

test('updateFacility et updateGlobals appliquent les propriétés', () => {
  const facility = updateFacility(def, 'shipping', 'EXP', { label: 'Quai', x: 30 });
  assert.equal(facility.shipping.label, 'Quai');
  assert.equal(facility.shipping.x, 30);
  const globals = updateGlobals(def, { name: 'Test', width: 50, frontY: 5 });
  assert.equal(globals.name, 'Test');
  assert.equal(globals.dimensions.width, 50);
  assert.equal(globals.corridors.frontY, 5);
});

test('validateDefinition accepte l’entrepôt d’exemple', () => {
  assert.deepEqual(validateDefinition(def, buildWarehouse), []);
});

test('validateDefinition détecte les ids en double', () => {
  const dupAisle = structuredClone(def);
  dupAisle.aisles[1].id = 'A1';
  assert.ok(validateDefinition(dupAisle, buildWarehouse).some((e) => e.includes('double')));
  const dupRack = structuredClone(def);
  dupRack.racks[1].id = 'R01';
  assert.ok(validateDefinition(dupRack, buildWarehouse).some((e) => e.includes('double')));
});

test('validateDefinition détecte allée hors couloirs et zone hors sol', () => {
  const outAisle = structuredClone(def);
  outAisle.aisles[0].yStart = 1;
  assert.ok(validateDefinition(outAisle, buildWarehouse).some((e) => e.includes('couloirs')));
  const outZone = structuredClone(def);
  outZone.shipping.x = 500;
  assert.ok(validateDefinition(outZone, buildWarehouse).some((e) => e.includes('hors du sol')));
});

test('validateDefinition remonte les erreurs de construction du graphe', () => {
  const broken = structuredClone(def);
  broken.racks[0].aisle = 'A99';
  const errors = validateDefinition(broken, buildWarehouse);
  assert.ok(errors.some((e) => e.includes('incohérente')));
});

test('duplicateDefinition renomme et clone en profondeur', () => {
  const copy = duplicateDefinition(def);
  assert.equal(copy.name, `Copie de ${def.name}`);
  copy.aisles[0].x = 99;
  assert.notEqual(def.aisles[0].x, 99);
});

test('minimalDefinition est une définition valide', () => {
  assert.deepEqual(validateDefinition(minimalDefinition(), buildWarehouse), []);
});
