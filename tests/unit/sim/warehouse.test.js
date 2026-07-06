// Tests de la construction de l'entrepôt d'exemple et de son graphe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';

const spec = JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
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

test('shipping/receiving acceptent un objet unique ou une liste', () => {
  // Format historique : objet unique → liste à un élément
  const single = buildWarehouse(spec);
  assert.equal(single.shippings.length, 1);
  assert.equal(single.receivings.length, 1);
  assert.equal(single.shippingNodeId, 'EXP');

  // Nouveau format : listes ; le premier élément reste le nœud de départ
  const multi = structuredClone(spec);
  multi.shipping = [multi.shipping, { id: 'EXP2', label: 'Expédition 2', x: 40, y: 2 }];
  multi.receiving = [multi.receiving];
  const w = buildWarehouse(multi);
  assert.equal(w.shippings.length, 2);
  assert.equal(w.shippingNodeId, 'EXP');
  assert.ok(w.graph.nodes.has('EXP2'), 'la seconde zone doit avoir son nœud');
  const route = w.graph.shortestPath('EXP', 'EXP2');
  assert.ok(route && route.distance > 0, 'la seconde zone doit être raccordée aux couloirs');
});

test('un réseau de couloirs (liste) relie allées et zones, impasses comprises', () => {
  const multi = structuredClone(spec);
  multi.corridors = [
    // Couloir avant pleine largeur, arrière raccourci (A6 devient une impasse)
    { id: 'C1', label: 'Avant', x: 0, y: 4, length: 44, orientation: 'horizontal' },
    { id: 'C2', label: 'Arrière', x: 0, y: 38, length: 30, orientation: 'horizontal' },
    // Liaison verticale croisant le couloir avant
    { id: 'C3', label: 'Liaison', x: 40, y: 2, length: 40, orientation: 'vertical' },
  ];
  const w = buildWarehouse(multi);
  // Tout le réseau est praticable, de l'expédition à la réception
  assert.ok(w.graph.shortestPath('EXP', 'REC'));
  // L'allée en impasse reste desservie par son seul débouché avant
  assert.ok(w.graph.shortestPath('EXP', 'A6:b17'));
});

test('une allée sans débouché est refusée à la construction', () => {
  const broken = structuredClone(spec);
  // Couloir trop court : ne croise l'axe d'aucune allée (x 0..3, allées à x ≥ 6)
  broken.corridors = [{ id: 'C1', x: 0, y: 4, length: 3, orientation: 'horizontal' }];
  assert.throws(() => buildWarehouse(broken), /ne débouche sur aucun couloir/);
});

test('un réseau non connexe est refusé à la construction', () => {
  const broken = structuredClone(spec);
  broken.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, orientation: 'horizontal' },
    // Couloir isolé : ne croise rien, mais la réception s'y projette
    { id: 'C2', x: 43, y: 20, length: 10, orientation: 'vertical' },
  ];
  assert.throws(() => buildWarehouse(broken), /non connexe/);
});

test('un couloir à sens unique oriente ses arêtes', () => {
  // Couloir avant en sens unique +x : l'aller passe par lui, le retour
  // remonte une allée et redescend par le couloir arrière (connexité
  // forte assurée par les allées bidirectionnelles)
  const oneWaySpec = structuredClone(spec);
  oneWaySpec.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, orientation: 'horizontal', oneWay: 'positif' },
    { id: 'C2', x: 0, y: 38, length: 44, orientation: 'horizontal' },
  ];
  const w = buildWarehouse(oneWaySpec);
  // Entre la première et la dernière allée : l'aller suit le couloir
  // avant, le retour doit remonter par le couloir arrière
  const first = `${oneWaySpec.aisles[0].id}:b1`;
  const last = `${oneWaySpec.aisles[oneWaySpec.aisles.length - 1].id}:b1`;
  const aller = w.graph.shortestPath(first, last).distance;
  const retour = w.graph.shortestPath(last, first).distance;
  assert.ok(retour > aller, `retour ${retour} devrait dépasser l'aller ${aller}`);
});

test('des sens uniques sans retour possible sont rejetés', () => {
  // Expédition à l'ouest, les deux couloirs vers +x : tout est
  // atteignable à l'aller mais rien ne peut revenir vers l'ouest
  const trapped = structuredClone(spec);
  trapped.shipping = [{ id: 'EXP', label: 'Expédition', x: 2, y: 2 }];
  trapped.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, orientation: 'horizontal', oneWay: 'positif' },
    { id: 'C2', x: 0, y: 38, length: 44, orientation: 'horizontal', oneWay: 'positif' },
  ];
  assert.throws(() => buildWarehouse(trapped), /sens uniques incohérents/);
});

test('les valeurs oneWay et access invalides sont rejetées', () => {
  const bad = structuredClone(spec);
  bad.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, orientation: 'horizontal', oneWay: 'gauche' },
    { id: 'C2', x: 0, y: 38, length: 44, orientation: 'horizontal' },
  ];
  assert.throws(() => buildWarehouse(bad), /oneWay/);
  bad.corridors[0].oneWay = undefined;
  bad.corridors[0].access = 'robots';
  assert.throws(() => buildWarehouse(bad), /access/);
});
