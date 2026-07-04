// Tests du calcul et du formatage des KPI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKpis, formatKpis, formatDuration } from '../../../sim/kpi.js';

function line(state) {
  return { state };
}

const orders = [
  { createdAt: 0, completedAt: 600, lines: [line('dropped'), line('dropped')] },
  { createdAt: 100, completedAt: 400, lines: [line('dropped')] },
  { createdAt: 200, completedAt: null, lines: [line('picked'), line('pending')] },
  { createdAt: 300, completedAt: null, lines: [line('pending')] },
];

const operators = [
  { distance: 1000, busyTime: 1800, linesPicked: 3 },
  { distance: 500, busyTime: 900, linesPicked: 1 },
];

test('computeKpis agrège correctement un état final', () => {
  const kpis = computeKpis({ orders, operators, durationSec: 3600 });
  assert.equal(kpis.ordersCreated, 4);
  assert.equal(kpis.ordersCompleted, 2);
  assert.equal(kpis.ordersPerHour, 2);
  assert.equal(kpis.linesPicked, 4);
  assert.equal(kpis.linesPerHour, 4);
  assert.equal(kpis.totalDistanceM, 1500);
  assert.equal(kpis.avgDistancePerOperatorM, 750);
  // (1800 + 900) / (2 × 3600)
  assert.equal(kpis.occupancyRate, 0.375);
  // Cycles : 600 et 300 → moyenne 450
  assert.equal(kpis.avgCycleTimeSec, 450);
  assert.equal(kpis.pendingOrders, 2);
  // Seule la commande 4 n'a aucune ligne démarrée
  assert.equal(kpis.waitingOrders, 1);
});

test('computeKpis reste défini sans commande terminée ni opérateur', () => {
  const kpis = computeKpis({ orders: [], operators: [], durationSec: 3600 });
  assert.equal(kpis.ordersCompleted, 0);
  assert.equal(kpis.avgCycleTimeSec, null);
  assert.equal(kpis.occupancyRate, 0);
  assert.equal(kpis.avgDistancePerOperatorM, 0);
});

test('formatKpis produit un tableau lisible en français', () => {
  const text = formatKpis(computeKpis({ orders, operators, durationSec: 3600 }));
  assert.match(text, /Commandes traitées \/ h\s+2\.0/);
  assert.match(text, /Taux d’occupation des opérateurs/);
  assert.match(text, /37\.5 %/);
});

test('formatDuration écrit les durées en minutes et secondes', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(754), '12 min 34 s');
  assert.equal(formatDuration(60), '1 min 00 s');
});
