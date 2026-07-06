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
  addParking,
  addBuffer,
  addObstacle,
  removeObstacle,
  addConveyor,
  removeConveyor,
  updateConveyor,
  removeBuffer,
  removeParking,
  addReceiving,
  removeZone,
  updateAisle,
  updateFacility,
  addCorridor,
  removeCorridor,
  updateCorridor,
  updateGlobals,
  validateDefinition,
  duplicateDefinition,
  duplicateElement,
  minimalDefinition,
  normalizeDefinition,
  displayValue,
  modelValue,
} from '../../../web/public/js/editor/model.js';

const def = JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
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

test('moveAisle borne le départ dans le sol (connexité vérifiée à part)', () => {
  const next = moveAisle(def, 'A1', { yStart: 0 });
  const aisle = next.aisles.find((a) => a.id === 'A1');
  assert.equal(aisle.yStart, 1);
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
  const globals = updateGlobals(def, { name: 'Test', width: 50 });
  assert.equal(globals.name, 'Test');
  assert.equal(globals.dimensions.width, 50);
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

test('validateDefinition détecte allée sans débouché et zone hors sol', () => {
  // Allée enjambant les deux couloirs : aucun couloir au-delà de ses
  // extrémités → erreur de raccordement remontée par le constructeur
  const outAisle = structuredClone(def);
  outAisle.aisles[0].yStart = 3;
  outAisle.aisles[0].yEnd = 39;
  assert.ok(validateDefinition(outAisle, buildWarehouse).some((e) => e.includes('débouche')));
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

test('moveCorridor accroche au mètre et borne le segment dans le sol', () => {
  const norm = normalizeDefinition(def); // C1 avant (y=4), C2 arrière (y=38), pleine largeur
  assert.equal(moveCorridor(norm, 'C1', { y: 2.4 }).corridors[0].y, 2);
  // Bornes transversales : demi-largeur de voie contre les bords du sol
  assert.equal(moveCorridor(norm, 'C1', { y: -5 }).corridors[0].y, 0.7);
  assert.equal(moveCorridor(norm, 'C1', { y: 100 }).corridors[0].y, def.dimensions.depth - 0.7);
  // Borne longitudinale : le segment pleine largeur ne peut pas sortir du sol
  assert.equal(moveCorridor(norm, 'C1', { x: 10 }).corridors[0].x, 0);
  // Id inconnu refusé, définition d'origine non mutée
  assert.throws(() => moveCorridor(norm, 'CX', { y: 10 }), /Couloir inconnu/);
  const before = JSON.stringify(norm);
  moveCorridor(norm, 'C1', { y: 10 });
  assert.equal(JSON.stringify(norm), before);
});

test('moveCorridor produit une définition valide', () => {
  const norm = normalizeDefinition(def);
  const next = moveCorridor(moveCorridor(norm, 'C1', { y: 5 }), 'C2', { y: 40 });
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('addCorridor / removeCorridor / updateCorridor gèrent la liste', () => {
  const norm = normalizeDefinition(def);
  const added = addCorridor(norm);
  assert.equal(added.corridors.length, 3);
  const corridor = added.corridors[2];
  assert.equal(corridor.id, 'C3');
  assert.equal(corridor.orientation, 'horizontal');
  // Passage en vertical reliant les deux couloirs transversaux
  const vertical = updateCorridor(added, 'C3', {
    orientation: 'vertical', x: 36, y: 4, length: 34,
  });
  assert.deepEqual(validateDefinition(vertical, buildWarehouse), []);
  // Suppression : retour à deux couloirs ; le dernier est protégé
  const removed = removeCorridor(vertical, 'C3');
  assert.equal(removed.corridors.length, 2);
  let single = removeCorridor(removed, 'C2');
  // C2 supprimé : les allées ne débouchent plus que côté avant (impasse autorisée)
  assert.deepEqual(validateDefinition(single, buildWarehouse), []);
  assert.throws(() => removeCorridor(single, 'C1'), /dernier couloir/);
});

test('le magnétisme ferme les petits écarts vers un couloir perpendiculaire', () => {
  // Couloir vertical à x = 10, baies 7..37 : à 1 m du couloir avant (y = 4)
  const norm = normalizeDefinition(def);
  const withV = updateCorridor(addCorridor(norm), 'C3', {
    orientation: 'vertical', x: 10, y: 7, length: 30,
  });
  // Écart de 1 m : aimanté sur l'axe du couloir avant
  assert.equal(moveCorridor(withV, 'C3', { y: 5 }).corridors[2].y, 4);
  // Écart de 2 m : hors de portée, pas d'aimantation
  assert.equal(moveCorridor(withV, 'C3', { y: 6 }).corridors[2].y, 6);
  // Déjà en contact ou en croisement : aucun décalage
  assert.equal(moveCorridor(withV, 'C3', { y: 4 }).corridors[2].y, 4);
});

test('le magnétisme exige que la jonction touche l’étendue de l’autre couloir', () => {
  const norm = normalizeDefinition(def);
  // Couloir avant raccourci (x 0..8) : un vertical à x = 10 ne le touche pas
  const short = updateCorridor(normalizeDefinition(def), 'C1', { length: 8 });
  const withV = updateCorridor(addCorridor(short), 'C3', {
    orientation: 'vertical', x: 10, y: 7, length: 20,
  });
  assert.equal(moveCorridor(withV, 'C3', { y: 5 }).corridors[2].y, 5);
  // Sur l'étendue (x = 6) : aimanté
  const inSpan = updateCorridor(withV, 'C3', { x: 6 });
  assert.equal(moveCorridor(inSpan, 'C3', { y: 5 }).corridors[2].y, 4);
  assert.ok(norm.corridors.length === 2); // fixture intacte
});

test('la bascule d’orientation pivote au centre et reste dans le sol', () => {
  const norm = normalizeDefinition(def);
  // C3 horizontal (17..27, y = 21) → vertical : pivot autour de (22, 21)
  const added = addCorridor(norm);
  const flipped = updateCorridor(added, 'C3', { orientation: 'vertical' });
  const c = flipped.corridors[2];
  assert.deepEqual({ x: c.x, y: c.y }, { x: 22, y: 16 });
  // Près du bord : le segment re-borné ne sort pas du sol
  const nearEdge = updateCorridor(added, 'C3', { x: 0, y: 41 });
  const flippedEdge = updateCorridor(nearEdge, 'C3', { orientation: 'vertical' }).corridors[2];
  assert.ok(flippedEdge.y >= 0);
  assert.ok(flippedEdge.y + flippedEdge.length <= def.dimensions.depth);
  // Une bascule aller-retour sans autre changement revient au départ
  const back = updateCorridor(flipped, 'C3', { orientation: 'horizontal' }).corridors[2];
  assert.deepEqual({ x: back.x, y: back.y }, { x: 17, y: 21 });
});

test('changer la longueur re-borne le segment dans le sol', () => {
  const norm = normalizeDefinition(def);
  const added = updateCorridor(addCorridor(norm), 'C3', { x: 30 }); // 30..40
  const longer = updateCorridor(added, 'C3', { length: 30 }).corridors[2];
  assert.equal(longer.length, 30);
  assert.ok(longer.x + longer.length <= def.dimensions.width);
});

test('updateAisle règle les racks de l’allée (niveaux, hauteur, profondeur)', () => {
  const next = updateAisle(normalizeDefinition(def), 'A1', {
    levels: 4, levelHeight: 1.8, rackDepth: 2.2,
  });
  const racks = next.racks.filter((r) => r.aisle === 'A1');
  assert.equal(racks.length, 2);
  for (const rack of racks) {
    assert.equal(rack.levels, 4);
    assert.equal(rack.levelHeight, 1.8);
    assert.equal(rack.depth, 2.2);
  }
  // Les autres allées ne bougent pas
  assert.ok(next.racks.filter((r) => r.aisle === 'A2').every((r) => r.levels === 1));
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('validateDefinition contrôle niveaux et hauteur sous plafond', () => {
  const badLevels = updateAisle(def, 'A1', { levels: 0 });
  assert.ok(validateDefinition(badLevels, buildWarehouse).some((e) => e.includes('levels')));
  // 4 niveaux × 2 m = 8 m > plafond de 6 m
  const lowCeiling = updateGlobals(updateAisle(normalizeDefinition(def), 'A1', { levels: 4 }), { height: 6 });
  assert.ok(validateDefinition(lowCeiling, buildWarehouse).some((e) => e.includes('plafond')));
  // Plafond suffisant : valide
  const highCeiling = updateGlobals(updateAisle(normalizeDefinition(def), 'A1', { levels: 4 }), { height: 10 });
  assert.deepEqual(validateDefinition(highCeiling, buildWarehouse), []);
});

test('addParking / removeParking : zone optionnelle, zéro autorisé', () => {
  const norm = normalizeDefinition(def);
  assert.deepEqual(norm.parkings, []);
  const added = addParking(norm);
  assert.equal(added.parkings.length, 1);
  assert.equal(added.parkings[0].id, 'PK1');
  assert.ok(added.parkings[0].label.startsWith('Parking'));
  assert.deepEqual(validateDefinition(added, buildWarehouse), []);
  // Redimensionnement et déplacement comme toute zone
  const resized = updateFacility(added, 'parking', 'PK1', { width: 6, depth: 4 });
  assert.equal(resized.parkings[0].width, 6);
  const moved = moveFacility(resized, 'parking', 'PK1', { x: 0, y: 0 });
  assert.equal(moved.parkings[0].x, 3);
  // Suppression jusqu'à zéro : valide (repli sur l'expédition)
  const removed = removeParking(added, 'PK1');
  assert.deepEqual(removed.parkings, []);
  assert.deepEqual(validateDefinition(removed, buildWarehouse), []);
  assert.throws(() => removeParking(removed, 'PK1'), /Parking inconnu/);
});

test('addBuffer / removeBuffer : zone tampon optionnelle', () => {
  const norm = normalizeDefinition(def);
  assert.deepEqual(norm.buffers, []);
  const added = addBuffer(norm);
  assert.equal(added.buffers.length, 1);
  assert.equal(added.buffers[0].id, 'TP1');
  assert.ok(added.buffers[0].label.startsWith('Tampon'));
  assert.deepEqual(validateDefinition(added, buildWarehouse), []);
  const removed = removeBuffer(added, 'TP1');
  assert.deepEqual(removed.buffers, []);
  assert.throws(() => removeBuffer(removed, 'TP1'), /Tampon inconnu/);
});

test('addObstacle / removeObstacle et validation de chevauchement', () => {
  const norm = normalizeDefinition(def);
  assert.deepEqual(norm.obstacles, []);
  const added = addObstacle(norm);
  assert.equal(added.obstacles.length, 1);
  assert.equal(added.obstacles[0].id, 'OB1');
  assert.equal(added.obstacles[0].height, 3);
  assert.deepEqual(validateDefinition(added, buildWarehouse), []);
  // Posé sur une allée : chevauchement signalé
  const clashing = structuredClone(added);
  clashing.obstacles[0].x = clashing.aisles[0].x;
  clashing.obstacles[0].y = (clashing.aisles[0].yStart + clashing.aisles[0].yEnd) / 2;
  assert.ok(validateDefinition(clashing, buildWarehouse)
    .some((e) => e.includes('chevauche')), 'le chevauchement d’allée doit être détecté');
  // Posé sur un couloir : idem
  const onCorridor = structuredClone(added);
  onCorridor.obstacles[0].x = 22;
  onCorridor.obstacles[0].y = onCorridor.corridors[0].y;
  assert.ok(validateDefinition(onCorridor, buildWarehouse)
    .some((e) => e.includes('chevauche le couloir')));
  const removed = removeObstacle(added, 'OB1');
  assert.deepEqual(removed.obstacles, []);
  assert.throws(() => removeObstacle(removed, 'OB1'), /Obstacle inconnu/);
});

test('addConveyor / updateConveyor / removeConveyor', () => {
  const withBuffer = addBuffer(normalizeDefinition(def));
  const added = addConveyor(withBuffer);
  assert.equal(added.conveyors.length, 1);
  assert.equal(added.conveyors[0].id, 'CV1');
  assert.equal(added.conveyors[0].throughputPerMin, 6);
  assert.deepEqual(validateDefinition(added, buildWarehouse), []);
  // Orientation pivotée au centre, débit modifiable
  const updated = updateConveyor(added, 'CV1', { orientation: 'vertical', throughputPerMin: 12 });
  assert.equal(updated.conveyors[0].orientation, 'vertical');
  assert.equal(updated.conveyors[0].throughputPerMin, 12);
  // Débit invalide signalé
  const bad = updateConveyor(added, 'CV1', { throughputPerMin: -1 });
  assert.ok(validateDefinition(bad, buildWarehouse).some((e) => e.includes('débit')));
  const removed = removeConveyor(added, 'CV1');
  assert.deepEqual(removed.conveyors, []);
  assert.throws(() => removeConveyor(removed, 'CV1'), /Convoyeur inconnu/);
});

test('duplicateElement copie une allée avec ses racks sous un id libre', () => {
  const next = duplicateElement(def, 'aisle', 'A1');
  const added = next.aisles[next.aisles.length - 1];
  const source = def.aisles.find((a) => a.id === 'A1');
  // Identifiant libre, mêmes réglages, décalée pour rester saisissable
  assert.ok(!def.aisles.some((a) => a.id === added.id));
  assert.equal(added.bays, source.bays);
  assert.notEqual(added.x, source.x);
  // Les racks suivent, sous des identifiants uniques
  const racks = next.racks.filter((r) => r.aisle === added.id);
  assert.equal(racks.length, def.racks.filter((r) => r.aisle === 'A1').length);
  const ids = next.racks.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  // L'original n'est pas muté
  assert.equal(next.aisles.length, def.aisles.length + 1);
  assert.ok(!def.racks.some((r) => r.aisle === added.id));
});

test('duplicateElement copie une zone « (copie) », plan toujours valide', () => {
  const normalized = normalizeDefinition(def);
  const next = duplicateElement(normalized, 'workshop', normalized.workshops[0].id);
  const added = next.workshops[next.workshops.length - 1];
  assert.match(added.label, / \(copie\)$/);
  assert.equal(added.width, normalized.workshops[0].width);
  assert.notEqual(added.x, normalized.workshops[0].x);
  assert.deepEqual(validateDefinition(next, buildWarehouse), []);
});

test('duplicateElement décale un couloir parallèlement à son axe', () => {
  const normalized = normalizeDefinition(def);
  const front = normalized.corridors[0];
  const next = duplicateElement(normalized, 'corridor', front.id);
  const added = next.corridors[next.corridors.length - 1];
  assert.equal(added.x, front.x);
  assert.notEqual(added.y, front.y);
  assert.equal(added.length, front.length);
});

test('duplicateElement rejette un type ou un élément inconnus', () => {
  assert.throws(() => duplicateElement(def, 'porte', 'X1'), /Type d'élément inconnu/);
  assert.throws(() => duplicateElement(def, 'aisle', 'A99'), /Élément inconnu/);
});
