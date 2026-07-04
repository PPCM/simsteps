// Tests d'intégration du moteur de simulation (sans base ni DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';
import { runSimulation, DEFAULT_SCENARIO } from '../../../sim/engine.js';

const spec = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);
const warehouse = buildWarehouse(spec);

const BASE = { seed: 42, durationHours: 1, operators: 4, ordersPerHour: 24, b2cShare: 0.7 };

test('un run complet produit des KPI cohérents', () => {
  const { kpis, operators } = runSimulation(warehouse, BASE);
  assert.ok(kpis.ordersCreated > 0, 'des commandes doivent arriver');
  assert.ok(kpis.ordersCompleted > 0, 'des commandes doivent être traitées');
  assert.ok(kpis.ordersCompleted <= kpis.ordersCreated);
  assert.ok(kpis.linesPicked > 0);
  assert.ok(kpis.avgDistancePerOperatorM > 0, 'les opérateurs doivent se déplacer');
  assert.ok(kpis.occupancyRate > 0 && kpis.occupancyRate <= 1, `occupation : ${kpis.occupancyRate}`);
  assert.ok(kpis.avgCycleTimeSec > 0);
  assert.equal(kpis.pendingOrders, kpis.ordersCreated - kpis.ordersCompleted);
  assert.equal(operators.length, 4);
});

test('la simulation est reproductible à graine identique', () => {
  const a = runSimulation(warehouse, BASE);
  const b = runSimulation(warehouse, BASE);
  assert.deepEqual(a.kpis, b.kpis);
});

test('une graine différente produit un run différent', () => {
  const a = runSimulation(warehouse, BASE);
  const b = runSimulation(warehouse, { ...BASE, seed: 43 });
  assert.notDeepEqual(a.kpis, b.kpis);
});

test('chaque commande terminée a toutes ses lignes déposées', () => {
  const { orders } = runSimulation(warehouse, BASE);
  for (const order of orders) {
    if (order.completedAt !== null) {
      assert.ok(order.lines.every((l) => l.state === 'dropped'), `commande ${order.id} incohérente`);
      assert.ok(order.completedAt >= order.createdAt);
    }
  }
});

test('la stratégie par vagues fonctionne de bout en bout', () => {
  const { kpis } = runSimulation(warehouse, { ...BASE, strategy: 'zoneWave', waveSize: 15 });
  assert.ok(kpis.ordersCompleted > 0);
  assert.ok(kpis.occupancyRate > 0 && kpis.occupancyRate <= 1);
});

test('plus d’opérateurs traite au moins autant de commandes', () => {
  const few = runSimulation(warehouse, { ...BASE, operators: 2 });
  const many = runSimulation(warehouse, { ...BASE, operators: 8 });
  assert.ok(many.kpis.ordersCompleted >= few.kpis.ordersCompleted);
});

test('le hook onEvent observe le déroulé de la simulation', () => {
  const types = new Set();
  runSimulation(warehouse, { ...BASE, durationHours: 0.5 }, {
    onEvent: (event) => types.add(event.type),
  });
  for (const expected of ['orderArrival', 'opArrive', 'opPickDone', 'opDropDone']) {
    assert.ok(types.has(expected), `événement ${expected} jamais observé`);
  }
});

test('le trafic agrégé par arête est exposé et cohérent', () => {
  const { traffic, operators } = runSimulation(warehouse, BASE);
  assert.ok(traffic.length > 0, 'du trafic doit être enregistré');
  for (const edge of traffic) {
    assert.ok(warehouse.graph.nodes.has(edge.from), `nœud inconnu : ${edge.from}`);
    assert.ok(warehouse.graph.nodes.has(edge.to), `nœud inconnu : ${edge.to}`);
    assert.ok(edge.count > 0);
    // Clé canonique : une seule entrée par paire de nœuds
    assert.ok(edge.from < edge.to);
  }
  // La distance totale reconstituée depuis le trafic doit correspondre
  // aux distances accumulées par les opérateurs
  const fromTraffic = traffic.reduce(
    (sum, e) => sum + e.count * warehouse.graph.distance(e.from, e.to), 0
  );
  const fromOperators = operators.reduce((sum, op) => sum + op.distance, 0);
  assert.ok(Math.abs(fromTraffic - fromOperators) < 1e-6);
});

test('les hooks onTravel et onState alimentent une timeline cohérente', () => {
  const travels = [];
  const states = [];
  runSimulation(warehouse, { ...BASE, durationHours: 0.5 }, {
    onTravel: (opId, path, t0, distance, duration) => travels.push({ opId, path, t0, distance, duration }),
    onState: (opId, state, t) => states.push({ opId, state, t }),
  });
  assert.ok(travels.length > 0);
  for (const travel of travels) {
    assert.ok(travel.path.length >= 1);
    assert.ok(travel.duration >= 0);
    // durée = distance / vitesse (1,2 m/s par défaut)
    assert.ok(Math.abs(travel.duration - travel.distance / 1.2) < 1e-9);
  }
  const kinds = new Set(states.map((s) => s.state));
  assert.deepEqual([...kinds].sort(), ['dropping', 'idle', 'moving', 'picking']);
  // Les instants d'un même opérateur sont croissants
  const byOp = new Map();
  for (const s of states) {
    assert.ok(s.t >= (byOp.get(s.opId) ?? 0), `retour en arrière pour ${s.opId}`);
    byOp.set(s.opId, s.t);
  }
});

test('une stratégie inconnue est rejetée', () => {
  assert.throws(() => runSimulation(warehouse, { ...BASE, strategy: 'magique' }), /Stratégie inconnue/);
});

test('les valeurs par défaut du scénario couvrent tous les paramètres', () => {
  for (const key of ['operators', 'ordersPerHour', 'b2cShare', 'strategy', 'speedMps', 'pickTimePerLineSec', 'dropTimeSec', 'waveSize']) {
    assert.ok(key in DEFAULT_SCENARIO, `paramètre par défaut manquant : ${key}`);
  }
});
