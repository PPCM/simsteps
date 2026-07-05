// Tests du tableau comparatif de KPI (module pur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonRows, KPI_ROWS } from '../../../web/public/js/compare.js';

const baseKpis = {
  ordersCompleted: 63,
  ordersPerHour: 31.5,
  linesPerHour: 425.5,
  avgDistancePerOperatorM: 1922.3,
  distancePerLineM: 4.5,
  occupancyRate: 0.5416,
  avgCycleTimeSec: 312.8,
  pendingOrders: 3,
};

test('une ligne par indicateur défini', () => {
  const rows = buildComparisonRows(baseKpis, baseKpis);
  assert.equal(rows.length, KPI_ROWS.length);
});

test('des KPI identiques donnent un écart « = » sans jugement', () => {
  for (const row of buildComparisonRows(baseKpis, baseKpis)) {
    assert.equal(row.delta, '=');
    assert.equal(row.improved, null);
  }
});

test('une amélioration est signée et orientée selon l’indicateur', () => {
  const better = { ...baseKpis, ordersPerHour: 34.65, avgCycleTimeSec: 224.1 };
  const rows = buildComparisonRows(baseKpis, better);
  const oph = rows.find((r) => r.label === 'Commandes / h');
  assert.equal(oph.delta, '+10 %');
  assert.equal(oph.improved, true); // plus de commandes/h = mieux
  const cycle = rows.find((r) => r.label === 'Cycle moyen');
  assert.ok(cycle.delta.startsWith('-'));
  assert.equal(cycle.improved, true); // cycle plus court = mieux
});

test('une dégradation est marquée improved = false', () => {
  const worse = { ...baseKpis, pendingOrders: 9 };
  const row = buildComparisonRows(baseKpis, worse).find((r) => r.label === 'Non terminées');
  assert.equal(row.improved, false);
});

test('la distance est neutre : jamais de jugement', () => {
  const different = { ...baseKpis, avgDistancePerOperatorM: 2500 };
  const row = buildComparisonRows(baseKpis, different).find((r) => r.label === 'Distance moy. / op.');
  assert.notEqual(row.delta, '=');
  assert.equal(row.improved, null);
});

test('un cycle moyen absent (null) est affiché « — » sans écart', () => {
  const noCycle = { ...baseKpis, avgCycleTimeSec: null };
  const row = buildComparisonRows(noCycle, baseKpis).find((r) => r.label === 'Cycle moyen');
  assert.equal(row.a, '—');
  assert.equal(row.delta, '—');
  assert.equal(row.improved, null);
});

test('les valeurs sont mises en forme en français', () => {
  const rows = buildComparisonRows(baseKpis, baseKpis);
  assert.equal(rows.find((r) => r.label === 'Occupation').a, '54,2 %');
  assert.equal(rows.find((r) => r.label === 'Cycle moyen').a, '5 min 13 s');
  assert.match(rows.find((r) => r.label === 'Distance moy. / op.').a, /^1[\s ]922 m$/);
});
