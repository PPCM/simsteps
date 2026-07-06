// Tests de l'agrégation du référentiel des emplacements et de
// l'entrepôt provisoire : l'entrepôt généré doit passer la validation
// ET le constructeur du moteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLocations, draftWarehouse } from '../../../../web/public/js/import/topology.js';
import { validateDefinition } from '../../../../web/public/js/editor/model.js';
import { buildWarehouse } from '../../../../sim/warehouse.js';

const MAPPING = { aisle: 0, bay: 1, level: 2, zone: 3 };

// Site fictif : 6 allées × 17 travées × 2 niveaux, 2 zones (204 adresses)
function fixtureRows() {
  const rows = [];
  for (let a = 1; a <= 6; a++) {
    for (let bay = 1; bay <= 17; bay++) {
      for (let level = 1; level <= 2; level++) {
        rows.push([`A0${a}`, String(bay).padStart(2, '0'), String(level), a <= 3 ? 'PICKING' : 'RESERVE']);
      }
    }
  }
  return rows;
}

test('agrégat exact du site fictif', () => {
  const { aisles, anomalies, locations } = aggregateLocations(fixtureRows(), MAPPING);
  assert.equal(locations, 204 * 2 / 2); // 6 × 17 × 2
  assert.equal(aisles.length, 6);
  assert.deepEqual(aisles[0], { id: 'A01', bays: 17, levels: 2, zone: 'PICKING' });
  assert.deepEqual(aisles[5], { id: 'A06', bays: 17, levels: 2, zone: 'RESERVE' });
  assert.deepEqual(anomalies, []);
});

test('anomalies signalées : lignes incomplètes et allée mono-travée', () => {
  const rows = [
    ['A1', '01', '1', 'Z'], ['A1', '02', '1', 'Z'],
    ['A2', '01', '1', 'Z'], // une seule travée
    ['', '03', '1', 'Z'], ['A3', '', '1', 'Z'], // incomplètes
  ];
  const { aisles, anomalies } = aggregateLocations(rows, MAPPING);
  assert.equal(aisles.length, 2);
  assert.ok(anomalies.some((a) => a.includes('2 ligne(s) sans allée ou sans travée')));
  assert.ok(anomalies.some((a) => a.includes('« A2 » : une seule travée')));
});

test('niveaux lettrés : nombre de valeurs distinctes', () => {
  const rows = [
    ['A1', '01', 'A', ''], ['A1', '01', 'B', ''], ['A1', '01', 'C', ''],
    ['A1', '02', 'A', ''],
  ];
  const { aisles } = aggregateLocations(rows, MAPPING);
  assert.equal(aisles[0].levels, 3);
});

test('l’entrepôt provisoire passe la validation et le moteur', () => {
  const aggregate = aggregateLocations(fixtureRows(), MAPPING);
  const definition = draftWarehouse(aggregate, { name: 'Site fictif' });
  assert.equal(definition.name, 'Site fictif');
  assert.equal(definition.aisles.length, 6);
  assert.equal(definition.racks.length, 12);
  assert.equal(definition.racks[0].levels, 2);
  assert.equal(definition.aisles[0].zone, 'PICKING');
  // Zéro erreur de validation, et le graphe se construit
  assert.deepEqual(validateDefinition(definition, buildWarehouse), []);
  const warehouse = buildWarehouse(definition);
  assert.ok(warehouse.slots.size >= 6 * 17 * 2);
});

test('une allée mono-travée est posée avec 2 travées (minimum moteur)', () => {
  const { aisles } = aggregateLocations([
    ['A1', '01', '1', ''], ['A1', '02', '1', ''], ['A2', '01', '1', ''],
  ], MAPPING);
  const definition = draftWarehouse({ aisles, locations: 3 });
  assert.equal(definition.aisles[1].bays, 2);
  assert.deepEqual(validateDefinition(definition, buildWarehouse), []);
});

test('agrégat vide refusé à la génération', () => {
  assert.throws(() => draftWarehouse({ aisles: [] }), /Aucune allée/);
});
