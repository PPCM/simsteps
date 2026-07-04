// Tests de la construction de l'entrepôt d'exemple et de son graphe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';

const spec = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

test('l’entrepôt d’exemple respecte le cahier des charges', () => {
  const w = buildWarehouse(spec);
  assert.equal(w.aisles.length, 6, '6 allées attendues');
  assert.ok(w.slots.size >= 200, `au moins 200 emplacements attendus, obtenu ${w.slots.size}`);
  assert.equal(w.workshops.length, 2, '2 ateliers attendus');
  assert.ok(w.shippingNodeId, 'zone expédition attendue');
  assert.ok(w.receivingNodeId, 'zone réception attendue');
});

test('chaque emplacement est projeté sur un nœud existant du graphe', () => {
  const w = buildWarehouse(spec);
  for (const slot of w.slots.values()) {
    assert.ok(w.graph.nodes.has(slot.nodeId), `nœud manquant pour ${slot.id}`);
  }
});

test('tous les emplacements sont atteignables depuis l’expédition', () => {
  const w = buildWarehouse(spec);
  for (const slot of w.slots.values()) {
    const route = w.graph.shortestPath(w.shippingNodeId, slot.nodeId);
    assert.ok(route !== null, `${slot.id} inatteignable depuis l’expédition`);
    assert.ok(route.distance > 0);
  }
});

test('les ateliers et la réception sont atteignables depuis l’expédition', () => {
  const w = buildWarehouse(spec);
  for (const workshop of w.workshops) {
    assert.ok(w.graph.shortestPath(w.shippingNodeId, workshop.nodeId));
  }
  assert.ok(w.graph.shortestPath(w.shippingNodeId, w.receivingNodeId));
});

test('chaque emplacement porte sa zone et son allée', () => {
  const w = buildWarehouse(spec);
  const zones = new Set();
  for (const slot of w.slots.values()) {
    assert.ok(slot.zone, `zone manquante pour ${slot.id}`);
    assert.ok(slot.aisleId, `allée manquante pour ${slot.id}`);
    zones.add(slot.zone);
  }
  assert.ok(zones.size >= 2, 'plusieurs zones attendues pour la stratégie par vagues');
});

test('un rack référençant une allée inconnue lève une erreur', () => {
  const broken = {
    ...spec,
    racks: [{ id: 'RX', aisle: 'A99', side: 'gauche', levels: 1 }],
  };
  assert.throws(() => buildWarehouse(broken), /allée inconnue/);
});
