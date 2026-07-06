// Tests d'intégration du moteur de simulation (sans base ni DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWarehouse } from '../../../sim/warehouse.js';
import { runSimulation, DEFAULT_SCENARIO } from '../../../sim/engine.js';

const spec = JSON.parse(
  await readFile(new URL('../../../demo/warehouse-example.json', import.meta.url), 'utf8')
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

test('les dépôts B2B partent à la zone d’expédition la plus proche', () => {
  // Deux zones d'expédition : une au cœur du couloir avant, une à
  // l'autre bout d'un sol très élargi (toujours plus lointaine)
  const multi = structuredClone(spec);
  multi.dimensions = { ...multi.dimensions, width: 200 };
  multi.shipping = [
    { id: 'EXP-PRES', label: 'Expédition proche', x: 18, y: 2 },
    { id: 'EXP-LOIN', label: 'Expédition lointaine', x: 199, y: 2 },
  ];
  const w = buildWarehouse(multi);
  const targets = new Set();
  runSimulation(
    w,
    { ...BASE, b2cShare: 0 }, // commandes 100 % B2B
    { onTravel: (opId, path) => targets.add(path[path.length - 1]) }
  );
  assert.ok(targets.has('EXP-PRES'), 'les missions doivent déposer à la zone proche');
  assert.ok(!targets.has('EXP-LOIN'), 'la zone lointaine ne doit jamais être choisie');
});

test('les niveaux hauts allongent le temps de prélèvement', () => {
  // Racks à 3 niveaux servis par des préparateurs de commandes (levée
  // 10 m) dans des allées à leur gabarit — les piétons, eux, ne
  // peuvent pas atteindre les niveaux hauts (voir test suivant)
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 2 }));
  // Couloirs au gabarit de l'engin (les couloirs historiques font 1,4 m)
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 3, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 3, orientation: 'horizontal' },
  ];
  // Deux opérateurs conduisent les préparateurs pour les niveaux hauts
  const params = { ...BASE, seed: 7, fleet: { pieton: 2, preparateur: 2 } };
  const noLift = runSimulation(buildWarehouse(tall), { ...params, liftTimePerLevelSec: 0 });
  const withLift = runSimulation(buildWarehouse(tall), { ...params, liftTimePerLevelSec: 30 });
  assert.ok(withLift.kpis.avgCycleTimeSec > noLift.kpis.avgCycleTimeSec,
    `cycle attendu plus long avec élévation : ${withLift.kpis.avgCycleTimeSec} vs ${noLift.kpis.avgCycleTimeSec}`);
  assert.ok(noLift.kpis.ordersCompleted > 0);
});

test('la flotte borne l’accessibilité : levée et gabarit d’allée', () => {
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  // Piétons seuls (levée 1,9 m) : les lignes des niveaux 2-3 sont
  // inaccessibles, une partie des commandes reste en attente
  const walkers = runSimulation(buildWarehouse(tall), { ...BASE, seed: 7 });
  assert.ok(walkers.orders.some((o) => o.lines.some((l) => l.state === 'unreachable')),
    'des lignes hautes doivent être inaccessibles aux piétons');
  // Un frontal (3,4 m de gabarit) ne passe pas dans des allées de
  // 1,4 m : les lignes hautes restent inaccessibles même avec conducteur
  const forklift = runSimulation(buildWarehouse(tall), { ...BASE, seed: 7, fleet: { pieton: 1, frontal: 3 } });
  assert.ok(forklift.orders.some((o) => o.lines.some((l) => l.state === 'unreachable')));
  // Une flotte sans opérateur ne conduit rien : aucune commande traitée
  const noDriver = runSimulation(buildWarehouse(spec), { ...BASE, seed: 7, fleet: { frontal: 3 } });
  assert.equal(noDriver.kpis.ordersCompleted, 0);
  // Le VNA (1,6 m) passe dans des allées de 1,7 m et lève 14 m —
  // conduit par un opérateur venu à pied
  const vnaSpec = structuredClone(tall);
  vnaSpec.aisles = vnaSpec.aisles.map((a) => ({ ...a, width: 1.7 }));
  vnaSpec.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 2, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 2, orientation: 'horizontal' },
  ];
  const vna = runSimulation(buildWarehouse(vnaSpec), { ...BASE, seed: 7, fleet: { pieton: 1, vna: 2 } });
  assert.ok(vna.kpis.ordersCompleted > 0);
  assert.ok(!vna.orders.some((o) => o.lines.some((l) => l.state === 'unreachable')));
  // Les engins ont bien travaillé, conduits par l'opérateur
  assert.ok(vna.operators.some((o) => o.vehicle === 'vna' && o.linesPicked > 0));
});

test('un engin mobilise un opérateur : marche aller, conduite, retour', () => {
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 2 }));
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 3, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 3, orientation: 'horizontal' },
  ];
  // Parking réservé au préparateur, à l'opposé de l'expédition
  tall.parkings = [{ id: 'PK1', label: 'Parking engins', x: 4, y: 40, vehicles: ['preparateur'] }];
  const states = [];
  const { operators } = runSimulation(
    buildWarehouse(tall),
    { ...BASE, seed: 7, ordersPerHour: 10, fleet: { pieton: 1, preparateur: 1 } },
    { onState: (opId, state, t) => states.push({ opId, state, t }) }
  );
  const human = operators.find((o) => o.vehicle === 'pieton');
  const machine = operators.find((o) => o.vehicle === 'preparateur');
  // Le parking filtré : l'engin y démarre, pas l'humain (type non admis)
  assert.equal(machine.startNodeId, 'PK1');
  assert.equal(human.startNodeId, warehouse.shippingNodeId);
  // L'humain est passé par l'état « driving » (monté sur l'engin)
  assert.ok(states.some((s) => s.opId === human.id && s.state === 'driving'));
  // L'engin a travaillé et son conducteur a cumulé du temps occupé
  assert.ok(machine.linesPicked > 0);
  assert.ok(human.busyTime > 0);
});

test('la flotte mixte reste déterministe et rétro-compatible', () => {
  // fleet absent : operators = piétons, identique à l'ancien comportement
  const legacy = runSimulation(warehouse, { ...BASE, seed: 11 });
  const explicit = runSimulation(warehouse, { ...BASE, seed: 11, fleet: { pieton: BASE.operators } });
  assert.deepEqual(legacy.kpis, explicit.kpis);
  // Un transpalette (plus rapide à vide) change les résultats mais reste déterministe
  const mixed = { ...BASE, seed: 11, fleet: { pieton: 2, transpalette: 2 } };
  const a = runSimulation(warehouse, mixed);
  const b = runSimulation(warehouse, mixed);
  assert.deepEqual(a.kpis, b.kpis);
  assert.ok(a.operators.some((o) => o.vehicle === 'transpalette'));
});

test('le rangement ABC réduit la distance par ligne', () => {
  // Mêmes commandes (graine identique), seul le placement des classes
  // change : les rotations fortes près de l'expédition raccourcissent
  // les tournées
  const random = runSimulation(warehouse, { ...BASE, seed: 21, slotting: 'aleatoire' });
  const abc = runSimulation(warehouse, { ...BASE, seed: 21, slotting: 'abc' });
  assert.ok(random.kpis.distancePerLineM > 0);
  assert.ok(abc.kpis.distancePerLineM < random.kpis.distancePerLineM,
    `ABC attendu plus court : ${abc.kpis.distancePerLineM} vs ${random.kpis.distancePerLineM}`);
});

test('les agents démarrent au parking et y retournent à l’inactivité', () => {
  const parked = structuredClone(spec);
  parked.parkings = [{ id: 'PK1', label: 'Parking 1', x: 4, y: 40 }];
  const w = buildWarehouse(parked);
  const { operators, orders } = runSimulation(w, { ...BASE, seed: 5, ordersPerHour: 6 });
  // Départ affecté au parking
  for (const op of operators) assert.equal(op.startNodeId, 'PK1');
  // À la fin d'une journée calme, les agents actifs sont rentrés se garer
  const worked = operators.filter((o) => o.linesPicked > 0 && o.state === 'idle');
  assert.ok(worked.length > 0);
  for (const op of worked) assert.equal(op.nodeId, 'PK1');
  assert.ok(orders.some((o) => o.completedAt !== null));
});

test('sans parking, comportement historique (départ à l’expédition)', () => {
  const { operators } = runSimulation(warehouse, { ...BASE, seed: 5 });
  for (const op of operators) assert.equal(op.startNodeId, warehouse.shippingNodeId);
});

// --- Phase 4 : stock, réapprovisionnement, flux entrants ---

// Entrepôt à 3 niveaux (réserve aux niveaux 2-3) praticable par un
// chariot rétractable, avec un piéton pour les missions à pied
function fluxSpec() {
  const s = structuredClone(spec);
  s.racks = s.racks.map((r) => ({ ...r, levels: 3 }));
  s.aisles = s.aisles.map((a) => ({ ...a, width: 2.8 }));
  s.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 3, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 3, orientation: 'horizontal' },
  ];
  return s;
}
const FLUX = {
  ...BASE,
  seed: 3,
  ordersPerHour: 60,
  fleet: { pieton: 3, retractable: 1 },
  replenishment: true,
  slotCapacityUnits: 10,
  durationHours: 3,
};

test('le réapprovisionnement descend la réserve vers le picking', () => {
  const { kpis, orders } = runSimulation(buildWarehouse(fluxSpec()), FLUX);
  assert.ok(kpis.replenishments > 0, 'des réappros doivent avoir lieu');
  assert.ok(kpis.ordersCompleted > 0);
  // Les commandes ne visent que les emplacements picking (niveau 1)
  for (const order of orders) {
    for (const line of order.lines) assert.equal(line.level, 1);
  }
});

test('sans engin, pas de réappro : le stock s’épuise', () => {
  const { kpis } = runSimulation(buildWarehouse(fluxSpec()), {
    ...FLUX, fleet: { pieton: 3 },
  });
  assert.equal(kpis.replenishments, 0);
  assert.ok(kpis.stockouts > 0, 'des commandes doivent être perdues faute de stock');
});

test('les camions entrants alimentent la réserve (putaway)', () => {
  // Deux engins et une demande plus calme : le réappro (prioritaire)
  // laisse du temps machine au rangement des palettes
  const { kpis } = runSimulation(buildWarehouse(fluxSpec()), {
    ...FLUX,
    ordersPerHour: 40,
    slotCapacityUnits: 20,
    fleet: { pieton: 3, retractable: 3 },
    inboundTrucksPerDay: 48,
    palletsPerTruck: 6,
  });
  assert.ok(kpis.putaways > 0, 'des palettes doivent être rangées en réserve');
  assert.ok(kpis.replenishments > 0);
});

test('les flux sont déterministes et absents du mode historique', () => {
  const a = runSimulation(buildWarehouse(fluxSpec()), { ...FLUX, inboundTrucksPerDay: 24 });
  const b = runSimulation(buildWarehouse(fluxSpec()), { ...FLUX, inboundTrucksPerDay: 24 });
  assert.deepEqual(a.kpis, b.kpis);
  const legacy = runSimulation(warehouse, { ...BASE, seed: 3 });
  assert.equal(legacy.kpis.replenishments, undefined);
  assert.equal(legacy.kpis.stockouts, undefined);
});

test('tampon + emballeurs : le picking est découplé de l’emballage', () => {
  const buffered = structuredClone(spec);
  buffered.buffers = [{ id: 'TP1', label: 'Tampon emballage', x: 14, y: 40 }];
  const w = buildWarehouse(buffered);
  const params = { ...BASE, seed: 9, b2cShare: 1, packers: 2 };
  const packed = runSimulation(w, params);
  // Les emballeurs existent, travaillent, et les commandes aboutissent
  const packers = packed.operators.filter((o) => o.role === 'packer');
  assert.equal(packers.length, 2);
  assert.ok(packers.some((p) => p.busyTime > 0), 'les emballeurs doivent travailler');
  assert.ok(packed.kpis.ordersCompleted > 0);
  // Sans zone tampon, packers est ignoré : aucun emballeur créé
  const legacy = runSimulation(warehouse, params);
  assert.equal(legacy.operators.filter((o) => o.role === 'packer').length, 0);
  // L'étape d'emballage allonge le cycle moyen à demande identique
  const noPack = runSimulation(w, { ...params, packers: 0 });
  assert.ok(packed.kpis.avgCycleTimeSec > noPack.kpis.avgCycleTimeSec,
    `cycle attendu plus long avec emballage : ${packed.kpis.avgCycleTimeSec} vs ${noPack.kpis.avgCycleTimeSec}`);
});

test('une voie réservée aux piétons bloque les engins', () => {
  // Réseau large praticable par un rétractable, mais couloir arrière
  // réservé aux piétons : les allées ne débouchant que sur lui restent
  // inaccessibles à l'engin (test via un entrepôt 3 niveaux : les
  // missions hautes exigent l'engin)
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 2.8 }));
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 3, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 3, orientation: 'horizontal' },
  ];
  const open = runSimulation(buildWarehouse(tall), {
    ...BASE, seed: 13, fleet: { pieton: 2, retractable: 1 },
  });
  assert.ok(!open.orders.some((o) => o.lines.some((l) => l.state === 'unreachable')));
  const restricted = structuredClone(tall);
  restricted.corridors = restricted.corridors.map((c) => ({ ...c, access: 'pietons' }));
  const closed = runSimulation(buildWarehouse(restricted), {
    ...BASE, seed: 13, fleet: { pieton: 2, retractable: 1 },
  });
  // L'engin ne peut plus circuler : les lignes hautes sont inaccessibles
  assert.ok(closed.orders.some((o) => o.lines.some((l) => l.state === 'unreachable')));
});

// --- Phase 5 : exclusivité d'allée et files d'attente ---

test('un engin au gabarit serré verrouille son allée : les autres attendent', () => {
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 1.7 }));
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 2, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 2, orientation: 'horizontal' },
  ];
  const states = new Set();
  const { kpis, operators } = runSimulation(buildWarehouse(tall), {
    ...BASE, seed: 17, ordersPerHour: 60, durationHours: 2,
    fleet: { pieton: 3, vna: 2 },
  }, { onState: (opId, state) => states.add(state) });
  assert.ok(states.has('waiting'), 'des attentes aux entrées d’allées doivent survenir');
  assert.ok(kpis.waitingTimeSec > 0);
  assert.equal(kpis.waitingTimeSec,
    operators.reduce((sum, op) => sum + op.waitTime, 0));
  assert.ok(kpis.ordersCompleted > 0);
});

test('sans engin au gabarit serré, aucune attente (comportement historique)', () => {
  const { kpis } = runSimulation(warehouse, { ...BASE, seed: 17 });
  assert.equal(kpis.waitingTimeSec, 0);
});

test('la congestion est déterministe à graine identique', () => {
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 1.7 }));
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 2, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 2, orientation: 'horizontal' },
  ];
  const params = { ...BASE, seed: 17, ordersPerHour: 60, fleet: { pieton: 3, vna: 2 } };
  const a = runSimulation(buildWarehouse(tall), params);
  const b = runSimulation(buildWarehouse(tall), params);
  assert.deepEqual(a.kpis, b.kpis);
});

// --- Exclusivité des couloirs (option corridorExclusion) ---

// Allées larges (aucun verrou d'allée possible) mais couloirs étroits :
// seule l'option corridorExclusion peut y créer de l'attente
function narrowCorridorSpec() {
  const tall = structuredClone(spec);
  tall.racks = tall.racks.map((r) => ({ ...r, levels: 3 }));
  tall.aisles = tall.aisles.map((a) => ({ ...a, width: 3.4 }));
  tall.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 2, orientation: 'horizontal' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 2, orientation: 'horizontal' },
  ];
  return tall;
}

test('l’exclusivité des couloirs fait attendre les agents qui s’y croisent', () => {
  const params = {
    ...BASE, seed: 17, ordersPerHour: 60, durationHours: 2,
    fleet: { pieton: 3, vna: 2 },
  };
  // Sans l'option : allées larges, couloirs non gérés — aucune attente
  const off = runSimulation(buildWarehouse(narrowCorridorSpec()), params);
  assert.equal(off.kpis.waitingTimeSec, 0);
  const states = new Set();
  const on = runSimulation(buildWarehouse(narrowCorridorSpec()),
    { ...params, corridorExclusion: true },
    { onState: (opId, state) => states.add(state) });
  assert.ok(states.has('waiting'), 'des attentes en couloir doivent survenir');
  assert.ok(on.kpis.waitingTimeSec > 0);
  assert.ok(on.kpis.ordersCompleted > 0);
});

test('l’exclusivité des couloirs est déterministe et sans effet pour les piétons', () => {
  const params = {
    ...BASE, seed: 17, ordersPerHour: 60,
    fleet: { pieton: 3, vna: 2 }, corridorExclusion: true,
  };
  const a = runSimulation(buildWarehouse(narrowCorridorSpec()), params);
  const b = runSimulation(buildWarehouse(narrowCorridorSpec()), params);
  assert.deepEqual(a.kpis, b.kpis);
  // Flotte 100 % piétonne : les piétons ne verrouillent jamais, l'option
  // activée reproduit exactement le run historique
  const legacy = runSimulation(warehouse, { ...BASE, seed: 17 });
  const walkers = runSimulation(warehouse, { ...BASE, seed: 17, corridorExclusion: true });
  assert.deepEqual(walkers.kpis, legacy.kpis);
});

// --- Phase 6 : engins automatisés (AGV/AMR) ---

// Couloirs réservés aux engins : les piétons ne peuvent rien faire,
// seuls les automatisés (sans conducteur) peuvent travailler
function automatedSpec() {
  const s = structuredClone(spec);
  s.corridors = [
    { id: 'C1', x: 0, y: 4, length: 44, width: 2, orientation: 'horizontal', access: 'engins' },
    { id: 'C2', x: 0, y: 38, length: 44, width: 2, orientation: 'horizontal', access: 'engins' },
  ];
  return s;
}

test('un engin automatisé part en mission sans conducteur', () => {
  const { kpis, operators } = runSimulation(buildWarehouse(automatedSpec()), {
    ...BASE, seed: 19, fleet: { pieton: 1, amr: 2 },
  });
  assert.ok(kpis.ordersCompleted > 0, 'les AMR doivent traiter des commandes');
  const walker = operators.find((o) => o.vehicle === 'pieton');
  assert.equal(walker.linesPicked, 0, 'le piéton ne peut rien atteindre');
  assert.equal(walker.busyTime, 0, 'aucun couplage conducteur ne doit avoir lieu');
  assert.ok(operators.filter((o) => o.vehicle === 'amr').every((o) => o.busyTime > 0));
});

test('la batterie impose des cycles de recharge', () => {
  const states = new Set();
  const { kpis, operators } = runSimulation(buildWarehouse(automatedSpec()), {
    ...BASE, seed: 19, durationHours: 2, ordersPerHour: 40,
    fleet: { pieton: 1, amr: 2 },
    agvAutonomyHours: 0.1, // 6 min d'autonomie : recharges fréquentes
  }, { onState: (opId, state) => states.add(state) });
  assert.ok(states.has('charging'), 'l’état de recharge doit être observé');
  assert.ok(kpis.chargingTimeSec > 0);
  assert.equal(kpis.chargingTimeSec,
    operators.reduce((sum, op) => sum + op.chargeTime, 0));
  // Les commandes continuent d'aboutir entre les recharges
  assert.ok(kpis.ordersCompleted > 0);
});

test('sans engin automatisé, aucun temps de recharge', () => {
  const { kpis } = runSimulation(warehouse, { ...BASE, seed: 19 });
  assert.equal(kpis.chargingTimeSec, 0);
});

test('un convoyeur transporte le picking B2C du tampon à l’atelier', () => {
  const buffered = structuredClone(spec);
  buffered.buffers = [{ id: 'TP1', label: 'Tampon', x: 14, y: 40 }];
  buffered.conveyors = [
    { id: 'CV1', label: 'Convoyeur', x: 12, y: 20, length: 16, orientation: 'vertical', throughputPerMin: 12 },
  ];
  const w = buildWarehouse(buffered);
  assert.equal(w.conveyors[0].sourceBufferId, 'TP1');
  const params = { ...BASE, seed: 9, b2cShare: 1, packers: 2 };
  const fast = runSimulation(w, params);
  assert.ok(fast.kpis.conveyed > 0, 'des travaux doivent transiter par le convoyeur');
  assert.ok(fast.kpis.ordersCompleted > 0);
  // Un débit d'entrée étranglé allonge le cycle à demande identique
  const slowSpec = structuredClone(buffered);
  slowSpec.conveyors[0].throughputPerMin = 0.5;
  const slow = runSimulation(buildWarehouse(slowSpec), params);
  assert.ok(slow.kpis.avgCycleTimeSec > fast.kpis.avgCycleTimeSec,
    `cycle attendu plus long au débit étranglé : ${slow.kpis.avgCycleTimeSec} vs ${fast.kpis.avgCycleTimeSec}`);
  // Sans convoyeur, pas de compteur
  assert.equal(runSimulation(warehouse, BASE).kpis.conveyed, undefined);
});

test('un convoyeur sans tampon ou atelier est rejeté', () => {
  const bad = structuredClone(spec);
  bad.conveyors = [{ id: 'CV1', x: 12, y: 20, length: 10, orientation: 'vertical' }];
  assert.throws(() => buildWarehouse(bad), /zone tampon/);
});

test('une flotte 100 % automatisée travaille sans aucun piéton', () => {
  const { kpis, operators } = runSimulation(buildWarehouse(automatedSpec()), {
    ...BASE, seed: 23, fleet: { amr: 3 },
  });
  assert.ok(kpis.ordersCompleted > 0, 'les AMR seuls doivent traiter des commandes');
  assert.ok(operators.every((o) => o.vehicle === 'amr'));
  assert.ok(operators.some((o) => o.busyTime > 0));
});
