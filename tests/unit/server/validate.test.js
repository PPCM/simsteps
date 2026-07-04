// Tests de la validation des entrées de l'API (fonctions pures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateWarehouseDefinition,
  validateScenarioParams,
  validateProjectPayload,
} from '../../../server/validate.js';

const validWarehouse = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

test('l’entrepôt d’exemple est accepté', () => {
  assert.deepEqual(validateWarehouseDefinition(validWarehouse), []);
});

test('une définition d’entrepôt non-objet est rejetée', () => {
  assert.ok(validateWarehouseDefinition(null).length > 0);
  assert.ok(validateWarehouseDefinition([1, 2]).length > 0);
});

test('les champs obligatoires manquants sont tous signalés', () => {
  const errors = validateWarehouseDefinition({});
  assert.ok(errors.some((e) => e.includes('name')));
  assert.ok(errors.some((e) => e.includes('aisles')));
  assert.ok(errors.some((e) => e.includes('racks')));
  assert.ok(errors.some((e) => e.includes('workshops')));
  assert.ok(errors.some((e) => e.includes('shipping')));
  assert.ok(errors.some((e) => e.includes('receiving')));
});

test('une incohérence topologique est détectée à la construction', () => {
  const broken = {
    ...validWarehouse,
    racks: [{ id: 'RX', aisle: 'A99', side: 'gauche', levels: 1 }],
  };
  const errors = validateWarehouseDefinition(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /incohérente/);
});

test('des paramètres de scénario valides sont acceptés', () => {
  assert.deepEqual(
    validateScenarioParams({
      name: 'Test', seed: 7, operators: 3, ordersPerHour: 12,
      b2cShare: 0.5, strategy: 'zoneWave', waveSize: 10,
    }),
    []
  );
  // L'objet vide est valide : tous les paramètres ont des défauts
  assert.deepEqual(validateScenarioParams({}), []);
});

test('les paramètres hors bornes sont rejetés', () => {
  assert.ok(validateScenarioParams({ b2cShare: 1.5 }).length > 0);
  assert.ok(validateScenarioParams({ operators: 0 }).length > 0);
  assert.ok(validateScenarioParams({ operators: 2.5 }).length > 0);
  assert.ok(validateScenarioParams({ speedMps: -1 }).length > 0);
  assert.ok(validateScenarioParams({ durationHours: 'deux' }).length > 0);
});

test('une stratégie inconnue et un paramètre inconnu sont rejetés', () => {
  assert.ok(validateScenarioParams({ strategy: 'magique' }).length > 0);
  assert.ok(validateScenarioParams({ vitesse: 2 }).length > 0);
});

test('un scénario non-objet est rejeté', () => {
  assert.ok(validateScenarioParams(null).length > 0);
  assert.ok(validateScenarioParams('rapide').length > 0);
});

test('un projet valide est accepté (settings partiels ou vides)', () => {
  assert.deepEqual(
    validateProjectPayload({ name: 'P', warehouseId: 1, scenarioId: 2, settings: { strategy: 'zoneWave' } }),
    []
  );
  assert.deepEqual(validateProjectPayload({ name: 'P', warehouseId: 1, settings: {} }), []);
  assert.deepEqual(validateProjectPayload({ name: 'P', warehouseId: 1, scenarioId: null }), []);
});

test('un projet sans nom ou sans entrepôt est rejeté', () => {
  assert.ok(validateProjectPayload({ warehouseId: 1 }).some((e) => e.includes('name')));
  assert.ok(validateProjectPayload({ name: '  ', warehouseId: 1 }).some((e) => e.includes('name')));
  assert.ok(validateProjectPayload({ name: 'P' }).some((e) => e.includes('warehouseId')));
  assert.ok(validateProjectPayload({ name: 'P', warehouseId: 0 }).some((e) => e.includes('warehouseId')));
});

test('un scenarioId invalide est rejeté', () => {
  assert.ok(validateProjectPayload({ name: 'P', warehouseId: 1, scenarioId: 'a' }).length > 0);
  assert.ok(validateProjectPayload({ name: 'P', warehouseId: 1, scenarioId: 0 }).length > 0);
});

test('les settings de projet passent par la validation de scénario et refusent « name »', () => {
  assert.ok(validateProjectPayload({ name: 'P', warehouseId: 1, settings: { operators: 0 } }).length > 0);
  assert.ok(validateProjectPayload({ name: 'P', warehouseId: 1, settings: { inconnu: 1 } }).length > 0);
  const errors = validateProjectPayload({ name: 'P', warehouseId: 1, settings: { name: 'X' } });
  assert.ok(errors.some((e) => e.includes('settings')));
});
