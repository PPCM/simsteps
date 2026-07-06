// Tests des statistiques d'historique WMS : dates FR/ISO, cadence de
// commandes, part B2C, médiane du temps de prélèvement, réceptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateTime, median, distinctValues, orderStats, movementStats, receivingStats,
} from '../../../../web/public/js/import/stats.js';

test('dates ISO et françaises, avec ou sans heure', () => {
  const iso = parseDateTime('2026-05-04 08:30:00');
  assert.equal(iso, new Date(2026, 4, 4, 8, 30, 0).getTime());
  assert.equal(parseDateTime('2026-05-04T08:30'), new Date(2026, 4, 4, 8, 30).getTime());
  assert.equal(parseDateTime('04/05/2026 08:30'), iso - 0);
  assert.equal(parseDateTime('04/05/2026'), new Date(2026, 4, 4).getTime());
  assert.equal(parseDateTime('n/a'), null);
  assert.equal(parseDateTime(''), null);
});

test('médiane robuste (impair, pair, vide)', () => {
  assert.equal(median([5, 1, 9]), 5);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), null);
});

test('valeurs distinctes triées par fréquence', () => {
  const rows = [['B2C'], ['B2B'], ['B2C'], ['WEB'], ['B2C']];
  assert.deepEqual(distinctValues(rows, 0), [
    { value: 'B2C', count: 3 }, { value: 'B2B', count: 1 }, { value: 'WEB', count: 1 },
  ]);
});

test('commandes : cadence, part B2C, clients B2B, lignes par commande', () => {
  const mapping = { order: 0, client: 1, flow: 2, datetime: 3 };
  const rows = [];
  // 2 jours ouvrés, 32 commandes/jour : 16 B2C (2 lignes chacune) + 16 B2B (4 clients)
  for (const day of ['2026-05-04', '2026-05-05']) {
    for (let i = 0; i < 16; i++) {
      rows.push([`C-${day}-${i}`, `WEB${i}`, 'E-COMMERCE', `${day} 08:0${i % 10}`]);
      rows.push([`C-${day}-${i}`, `WEB${i}`, 'E-COMMERCE', `${day} 08:0${i % 10}`]); // 2e ligne
      rows.push([`B-${day}-${i}`, `CLI${i % 4}`, 'MAGASIN', `${day} 09:0${i % 10}`]);
    }
  }
  const { params, explanations } = orderStats(rows, mapping, { 'E-COMMERCE': 'b2c', MAGASIN: 'b2b' }, 8);
  assert.equal(params.ordersPerHour, 4); // 64 commandes / (2 j × 8 h)
  assert.equal(params.b2cShare, 0.5);
  assert.equal(params.b2bClients, 4);
  assert.ok(explanations.some((e) => e.includes('64 commandes sur 2 jour(s)')));
  assert.ok(explanations.some((e) => e.includes('1,5'.replace(',', '.')) || e.includes('1.5')));
});

test('commandes sans date exploitable : erreur française', () => {
  const mapping = { order: 0, client: null, flow: 1, datetime: 2 };
  assert.throws(() => orderStats([['C1', 'B2C', 'invalide']], mapping, {}, 8), /Aucune commande datée/);
});

test('mouvements : médiane des écarts d’une même mission, aberrations exclues', () => {
  const mapping = { mission: 0, datetime: 1, operator: 2 };
  const rows = [
    // Mission M1 : écarts 20 s, 30 s, 40 s (+ un trou de 2 h exclu)
    ['M1', '2026-05-04 08:00:00', 'OP1'],
    ['M1', '2026-05-04 08:00:20', 'OP1'],
    ['M1', '2026-05-04 08:00:50', 'OP1'],
    ['M1', '2026-05-04 08:01:30', 'OP1'],
    ['M1', '2026-05-04 10:01:30', 'OP1'],
    // Mission M2 : écart 30 s ; deuxième opérateur sur la même heure
    ['M2', '2026-05-04 08:05:00', 'OP2'],
    ['M2', '2026-05-04 08:05:30', 'OP2'],
  ];
  const { params, explanations } = movementStats(rows, mapping);
  assert.equal(params.pickTimePerLineSec, 30); // médiane de [20, 30, 40, 30]
  assert.equal(params.operators, 2); // OP1 et OP2 actifs sur 8 h ; OP1 seul sur 10 h → moyenne 1,5 → 2
  assert.ok(explanations[0].includes('30 s'));
});

test('mouvements inexploitables : erreur française', () => {
  const mapping = { mission: 0, datetime: 1, operator: 2 };
  assert.throws(() => movementStats([['M1', '2026-05-04 08:00', 'OP1']], mapping),
    /Aucun écart de prélèvement/);
});

test('réceptions : camions par jour et palettes par camion', () => {
  const mapping = { date: 0, pallets: 1 };
  const rows = [
    ['04/05/2026', '8'], ['04/05/2026', '10'], // jour 1 : 2 camions, 18 palettes
    ['05/05/2026', '12'], // jour 2 : 1 camion
  ];
  const { params } = receivingStats(rows, mapping);
  assert.equal(params.inboundTrucksPerDay, 2); // 3 camions / 2 jours → arrondi 2
  assert.equal(params.palletsPerTruck, 10); // 30 palettes / 3 camions
});

test('réceptions sans ligne datée : erreur française', () => {
  assert.throws(() => receivingStats([['?', 'x']], { date: 0, pallets: 1 }), /Aucune réception datée/);
});
