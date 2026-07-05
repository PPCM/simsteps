// Tests du modèle pur de l'éditeur d'entrepôt : déplacements contraints,
// ajout/suppression, propriétés et validation. Le vrai buildWarehouse du
// moteur est injecté dans validateDefinition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';
import {
  snapToGrid,
  snapEdge,
  moveAisle,
  moveFacility,
  moveCorridor,
  addAisle,
  removeAisle,
  addWorkshop,
  removeWorkshop,
  addShipping,
  addReceiving,
  removeZone,
  updateAisle,
  updateFacility,
  updateGlobals,
  validateDefinition,
  duplicateDefinition,
  minimalDefinition,
  normalizeDefinition,
  displayValue,
  modelValue,
} from '../../../web/public/js/editor/model.js';

const def = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

test('snapToGrid arrondit au mètre', () => {
  assert.equal(snapToGrid(2.4), 2);
  assert.equal(snapToGrid(2.6), 3);
  assert.equal(snapToGrid(-0.6), -1);
});

test('moveAisle aligne le flanc de rack en x, les baies au mètre en y', () => {
  const next = moveAisle(def, 'A1', { x: 8.4, yStart: 7.6 });
  const aisle = next.aisles.find((a) => a.id === 'A1');
  // Flanc extérieur du rack gauche (x − 2.1) sur une ligne de la grille
  assert.equal(aisle.x, 8.1);
  assert.equal(aisle.x - 2.1, 6);
  // Début de baies au mètre entier (champ affiché tel quel)
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
  // Bords gauche/avant (centre − demi-emprise 2.4 / 1.5) sur la grille
  assert.equal(receiving.receiving.x, 10.4);
  assert.equal(receiving.receiving.y, 10.5);
});

test('snapEdge aligne le bord d’un élément sur la grille', () => {
  assert.equal(snapEdge(10.6, 2.4), 10.4); // bord à 8
  assert.equal(snapEdge(10.6, 2), 11); // bord à 9
  assert.equal(snapEdge(5, 1.5), 5.5); // bord à 4
});

test('une zone de dimensions entières remplit des carreaux entiers après drag', () => {
  const norm = normalizeDefinition(def);
  const resized = updateFacility(norm, 'shipping', 'EXP', { width: 4, depth: 2 });
  const moved = moveFacility(resized, 'shipping', 'EXP', { x: 10.6, y: 10.2 });
  const zone = moved.shipping.find((z) => z.id === 'EXP');
  // Bords sur des lignes entières : 9..13 en x, 9..11 en y
  assert.equal(zone.x - 2, 9);
  assert.equal(zone.x + 2, 13);
  assert.equal(zone.y - 1, 9);
  assert.equal(zone.y + 1, 11);
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
  assert.ok(validateDefinition(outZone, buildWarehouse).some((e) => e.includes('dépasse le sol')));
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

test('normalizeDefinition passe les zones en listes avec dimensions explicites', () => {
  const next = normalizeDefinition(def);
  assert.ok(Array.isArray(next.shipping));
  assert.equal(next.shipping[0].id, 'EXP');
  assert.equal(next.shipping[0].width, 4.8);
  assert.equal(next.shipping[0].depth, 3);
  assert.ok(Array.isArray(next.receiving));
  assert.equal(next.aisles[0].width, 1.4);
  assert.equal(next.workshops[0].width, 4.8);
  // Idempotente, et la définition d'origine n'est pas mutée
  assert.deepEqual(normalizeDefinition(next), next);
  assert.ok(!Array.isArray(def.shipping));
});

test('addShipping / addReceiving ajoutent une zone avec identifiant unique', () => {
  const next = addShipping(normalizeDefinition(def));
  assert.equal(next.shipping.length, 2);
  const added = next.shipping[1];
  assert.equal(added.id, 'EXP1');
  assert.ok(added.label.startsWith('Expédition'));
  assert.equal(added.width, 4.8);
  assert.ok(added.x >= added.width / 2);
  // Placement bord-aligné dès l'ajout : coordonnées affichées entières
  assert.ok(Number.isInteger(displayValue('shipping', added, 'x')));
  assert.ok(Number.isInteger(displayValue('shipping', added, 'y')));
  const more = addReceiving(next);
  assert.equal(more.receiving.length, 2);
  assert.equal(more.receiving[1].id, 'REC1');
  // Toujours valide après ajout
  assert.deepEqual(validateDefinition(more, buildWarehouse), []);
});

test('removeZone refuse de supprimer la dernière zone de chaque type', () => {
  const norm = normalizeDefinition(def);
  assert.throws(() => removeZone(norm, 'shipping', 'EXP'), /dernière zone d’expédition/);
  assert.throws(() => removeZone(norm, 'receiving', 'REC'), /dernière zone de réception/);
  const two = addShipping(norm);
  const back = removeZone(two, 'shipping', 'EXP1');
  assert.equal(back.shipping.length, 1);
  assert.equal(back.shipping[0].id, 'EXP');
});

test('updateFacility redimensionne une zone et moveFacility borne sur son emprise', () => {
  const norm = normalizeDefinition(def);
  const resized = updateFacility(norm, 'shipping', 'EXP', { width: 10, depth: 6 });
  const zone = resized.shipping.find((z) => z.id === 'EXP');
  assert.equal(zone.width, 10);
  assert.equal(zone.depth, 6);
  const moved = moveFacility(resized, 'shipping', 'EXP', { x: 0, y: 0 });
  const clamped = moved.shipping.find((z) => z.id === 'EXP');
  assert.equal(clamped.x, 5); // demi-largeur de la zone redimensionnée
  assert.equal(clamped.y, 3); // demi-profondeur
});

test('updateAisle règle la largeur du couloir, contrôlée par la validation', () => {
  const norm = normalizeDefinition(def);
  const wider = updateAisle(norm, 'A1', { width: 2.5 });
  assert.equal(wider.aisles[0].width, 2.5);
  assert.deepEqual(validateDefinition(wider, buildWarehouse), []);
  const invalid = updateAisle(norm, 'A1', { width: -1 });
  assert.ok(validateDefinition(invalid, buildWarehouse).some((e) => e.includes('largeur')));
});

test('validateDefinition exige au moins une zone de chaque type et borne les emprises', () => {
  const norm = normalizeDefinition(def);
  const noShipping = structuredClone(norm);
  noShipping.shipping = [];
  assert.ok(validateDefinition(noShipping, buildWarehouse).some((e) => e.includes('expédition')));
  const bigZone = updateFacility(norm, 'receiving', 'REC', { width: 30 });
  assert.ok(validateDefinition(bigZone, buildWarehouse).some((e) => e.includes('dépasse le sol')));
});

test('la définition minimale normalisée reste valide', () => {
  assert.deepEqual(validateDefinition(minimalDefinition(), buildWarehouse), []);
  assert.deepEqual(validateDefinition(normalizeDefinition(def), buildWarehouse), []);
});

test('displayValue / modelValue convertissent bords ↔ modèle', () => {
  const norm = normalizeDefinition(def);
  const aisle = norm.aisles[0]; // yStart 7, yEnd 35 : affichés tels quels
  assert.equal(displayValue('aisle', aisle, 'yStart'), 7);
  assert.equal(displayValue('aisle', aisle, 'yEnd'), 35);
  assert.equal(modelValue('aisle', aisle, 'yStart', 8), 8);
  const zone = norm.shipping[0]; // centre (28, 2), emprise 4.8 × 3
  assert.equal(displayValue('shipping', zone, 'x'), 25.6);
  assert.equal(displayValue('shipping', zone, 'y'), 0.5);
  assert.equal(modelValue('shipping', zone, 'x', 26), 28.4);
  assert.equal(modelValue('shipping', zone, 'y', 1), 2.5);
  // Les autres clés passent inchangées
  assert.equal(displayValue('aisle', aisle, 'bays'), 17);
  assert.equal(modelValue('shipping', zone, 'width', 6), 6);
});

test('après accrochage du drag, les coordonnées affichées sont entières', () => {
  const norm = normalizeDefinition(def);
  const moved = moveFacility(norm, 'shipping', 'EXP', { x: 10.6, y: 10.2 });
  const zone = moved.shipping.find((z) => z.id === 'EXP');
  assert.ok(Number.isInteger(displayValue('shipping', zone, 'x')));
  assert.ok(Number.isInteger(displayValue('shipping', zone, 'y')));
  // Allée raccourcie pour ne pas buter contre le couloir arrière
  const short = updateAisle(norm, 'A1', { yStart: 7, yEnd: 15 });
  const dragged = moveAisle(short, 'A1', { yStart: 12.4 }).aisles[0];
  assert.equal(displayValue('aisle', dragged, 'yStart'), 12);
  assert.equal(displayValue('aisle', dragged, 'yEnd'), 20);
});

test('moveCorridor accroche au mètre et borne entre sol et allées', () => {
  // Couloir avant : borné par le bord du sol (1) et le débouché des allées
  const front = moveCorridor(def, 'front', { y: 2.4 });
  assert.equal(front.corridors.frontY, 2);
  assert.equal(moveCorridor(def, 'front', { y: -5 }).corridors.frontY, 1);
  // Allées de 7 à 35 : le couloir avant ne dépasse pas yStart − 1
  assert.equal(moveCorridor(def, 'front', { y: 20 }).corridors.frontY, 6);
  // Couloir arrière : entre yEnd + 1 et profondeur − 1
  assert.equal(moveCorridor(def, 'back', { y: 39.6 }).corridors.backY, 40);
  assert.equal(moveCorridor(def, 'back', { y: 10 }).corridors.backY, 36);
  assert.equal(moveCorridor(def, 'back', { y: 100 }).corridors.backY, def.dimensions.depth - 1);
  // Id inconnu refusé, définition d'origine non mutée
  assert.throws(() => moveCorridor(def, 'middle', { y: 10 }), /Couloir inconnu/);
  assert.equal(def.corridors.frontY, 4);
});

test('moveCorridor produit une définition valide', () => {
  const next = moveCorridor(moveCorridor(def, 'front', { y: 5 }), 'back', { y: 40 });
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});
