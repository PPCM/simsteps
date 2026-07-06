// Tests de la correspondance des colonnes : en-têtes WMS plausibles
// reconnus, priorité aux correspondances exactes, champs obligatoires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHeader, suggestMapping, missingRequired,
  LOCATION_FIELDS, ORDER_FIELDS, MOVEMENT_FIELDS, RECEIVING_FIELDS,
} from '../../../../web/public/js/import/mapping.js';

test('normalisation : accents, ponctuation et casse effacés', () => {
  assert.equal(normalizeHeader('N° Commande'), 'ncommande');
  assert.equal(normalizeHeader('Allée'), 'allee');
  assert.equal(normalizeHeader(' Trav. '), 'trav');
});

test('en-têtes Reflex plausibles du référentiel des emplacements', () => {
  const headers = ['Emplacement', 'Allée', 'Trav.', 'Niv', 'Magasin', 'Type empl.'];
  const mapping = suggestMapping(headers, LOCATION_FIELDS);
  assert.equal(mapping.aisle, 1);
  assert.equal(mapping.bay, 2);
  assert.equal(mapping.level, 3);
  assert.equal(mapping.zone, 4);
  assert.equal(mapping.type, 5);
  assert.equal(mapping.side, null); // absent, sans erreur
});

test('en-têtes anglais reconnus aussi', () => {
  const mapping = suggestMapping(['Order ID', 'Customer', 'Channel', 'Created'], ORDER_FIELDS);
  assert.deepEqual(mapping, { order: 0, client: 1, flow: 2, datetime: 3 });
});

test('les correspondances exactes priment et une colonne ne sert qu’une fois', () => {
  // « Date » exact pour datetime ; « Date validation » reste disponible
  const mapping = suggestMapping(['Mission', 'Date', 'Opérateur'], MOVEMENT_FIELDS);
  assert.equal(mapping.mission, 0);
  assert.equal(mapping.datetime, 1);
  assert.equal(mapping.operator, 2);
  const values = Object.values(mapping).filter((v) => v !== null);
  assert.equal(new Set(values).size, values.length);
});

test('en-tête inconnu : non mappé, signalé si obligatoire', () => {
  const mapping = suggestMapping(['Foo', 'Bar'], RECEIVING_FIELDS);
  assert.deepEqual(mapping, { date: null, pallets: null });
  const errors = missingRequired(mapping, RECEIVING_FIELDS);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Date de réception/);
});
