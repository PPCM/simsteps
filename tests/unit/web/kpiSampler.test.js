// Tests de l'échantillonnage des KPI en direct (module pur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLiveKpis, createKpiSampler, kpiAt } from '../../../web/public/js/kpiSampler.js';

function order(createdAt, completedAt) {
  return { createdAt, completedAt, lines: [] };
}

test('computeLiveKpis agrège l’état instantané', () => {
  const orders = [order(0, 600), order(100, null), order(200, null)];
  const operators = [
    { linesPicked: 4, distance: 500, busyTime: 900, busySince: null },
    { linesPicked: 2, distance: 300, busyTime: 600, busySince: 1500 }, // en mission
  ];
  const k = computeLiveKpis(orders, operators, 1800);
  assert.equal(k.ordersCreated, 3);
  assert.equal(k.ordersCompleted, 1);
  assert.equal(k.ordersPerHour, 2); // 1 commande en 0,5 h
  assert.equal(k.linesPerHour, 12); // 6 lignes en 0,5 h
  assert.equal(k.avgDistancePerOperatorM, 400);
  // (900 + 600 + (1800 − 1500)) / (2 × 1800) = 1800 / 3600
  assert.equal(k.occupancyRate, 0.5);
  assert.equal(k.avgCycleTimeSec, 600);
  assert.equal(k.pendingOrders, 2);
});

test('computeLiveKpis à t = 0 renvoie des valeurs neutres', () => {
  const k = computeLiveKpis([], [], 0);
  assert.equal(k.ordersPerHour, 0);
  assert.equal(k.occupancyRate, 0);
  assert.equal(k.avgCycleTimeSec, null);
});

test('l’échantillonneur capture à intervalle régulier sans doublon de période', () => {
  const sampler = createKpiSampler(10);
  const state = { orders: [], operators: [] };
  // Événements à 3 s, 12 s, 14 s, 31 s : échantillons attendus à 12 et 31 s
  for (const now of [3, 12, 14, 31]) {
    sampler.hooks.onEvent({}, { now, ...state });
  }
  assert.deepEqual(sampler.samples.map((s) => s.t), [0, 12, 31]);
});

test('finish ajoute l’échantillon final à l’horizon', () => {
  const sampler = createKpiSampler(10);
  sampler.finish(7200, [order(0, 100)], []);
  const last = sampler.samples[sampler.samples.length - 1];
  assert.equal(last.t, 7200);
  assert.equal(last.kpis.ordersCompleted, 1);
});

test('kpiAt renvoie le dernier échantillon antérieur ou égal', () => {
  const samples = [
    { t: 0, kpis: { ordersCompleted: 0 } },
    { t: 20, kpis: { ordersCompleted: 2 } },
    { t: 40, kpis: { ordersCompleted: 5 } },
  ];
  assert.equal(kpiAt(samples, 0).ordersCompleted, 0);
  assert.equal(kpiAt(samples, 19).ordersCompleted, 0);
  assert.equal(kpiAt(samples, 20).ordersCompleted, 2);
  assert.equal(kpiAt(samples, 999).ordersCompleted, 5);
});
