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

test('les zones shipping/receiving acceptent un objet ou une liste non vide', () => {
  const base = JSON.parse(JSON.stringify(validWarehouse));
  base.shipping = [base.shipping, { id: 'EXP2', label: 'Expédition 2', x: 40, y: 2 }];
  assert.deepEqual(validateWarehouseDefinition(base), []);

  const empty = JSON.parse(JSON.stringify(validWarehouse));
  empty.shipping = [];
  assert.ok(validateWarehouseDefinition(empty).some((e) => e.includes('shipping')));

  const noId = JSON.parse(JSON.stringify(validWarehouse));
  noId.receiving = [{ label: 'Sans id', x: 1, y: 1 }];
  assert.ok(validateWarehouseDefinition(noId).some((e) => e.includes('receiving')));
});

test('le paramètre fleet est validé (types connus, entiers, total ≥ 1)', () => {
  assert.deepEqual(validateScenarioParams({ fleet: { pieton: 2, retractable: 1 } }), []);
  assert.ok(validateScenarioParams({ fleet: { drone: 2 } }).some((e) => e.includes('engin inconnu')));
  assert.ok(validateScenarioParams({ fleet: { pieton: 1.5 } }).some((e) => e.includes('entier')));
  assert.ok(validateScenarioParams({ fleet: { pieton: 0 } }).some((e) => e.includes('au moins un agent')));
  assert.ok(validateScenarioParams({ fleet: [2] }).some((e) => e.includes('objet')));
});

test('les paramètres de flux sont validés', () => {
  assert.deepEqual(validateScenarioParams({
    replenishment: true, inboundTrucksPerDay: 24, palletsPerTruck: 10,
    packers: 2, packTimePerOrderSec: 60, slotCapacityUnits: 60,
    replenishThresholdShare: 0.25, palletHandlingSec: 30,
  }), []);
  assert.ok(validateScenarioParams({ replenishment: 'oui' }).some((e) => e.includes('booléen')));
  assert.ok(validateScenarioParams({ packers: -1 }).length > 0);
});

test('les zones tampon d’un entrepôt sont validées', () => {
  const def = structuredClone(validWarehouse);
  def.buffers = [{ id: 'TP1', label: 'Tampon', x: 14, y: 40 }];
  assert.deepEqual(validateWarehouseDefinition(def), []);
  def.buffers = [{ label: 'sans id' }];
  assert.ok(validateWarehouseDefinition(def).some((e) => e.includes('buffers')));
});
