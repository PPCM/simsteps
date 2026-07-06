// Tests du parseur CSV tolérant : encodages, BOM, séparateurs,
// guillemets, nombres français.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsv, detectDelimiter, parseCsv, toNumber } from '../../../../web/public/js/import/csv.js';

test('UTF-8 avec BOM décodé, BOM retiré', () => {
  const bytes = new TextEncoder().encode('﻿Allée;Niveau\nA1;2\n');
  const text = decodeCsv(bytes.buffer);
  assert.equal(text.startsWith('Allée'), true);
});

test('latin-1 (export Windows) : les accents restent lisibles', () => {
  // « Allée » encodé latin-1 : 0xE9 pour é — invalide en UTF-8 strict
  const bytes = Uint8Array.from([0x41, 0x6c, 0x6c, 0xe9, 0x65, 0x3b, 0x78, 0x0a]);
  assert.equal(decodeCsv(bytes.buffer), 'Allée;x\n');
});

test('séparateur détecté : point-virgule, virgule, tabulation', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  // La virgule décimale entre guillemets ne trompe pas la détection
  assert.equal(detectDelimiter('"1,5";x;y'), ';');
});

test('champs entre guillemets : séparateur et guillemets littéraux', () => {
  const { headers, rows } = parseCsv('nom;note\n"Dupont; Jean";"il a dit ""ok"""\n');
  assert.deepEqual(headers, ['nom', 'note']);
  assert.deepEqual(rows, [['Dupont; Jean', 'il a dit "ok"']]);
});

test('lignes vides ignorées, cellules épurées, CRLF accepté', () => {
  const { headers, rows } = parseCsv('a,b\r\n 1 , 2 \r\n\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [['1', '2'], ['3', '4']]);
});

test('fichier vide refusé en français', () => {
  assert.throws(() => parseCsv('\n\n'), /CSV est vide/);
});

test('nombres français : virgule décimale et espaces de milliers', () => {
  assert.equal(toNumber('1 234,5'), 1234.5);
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber('8.25'), 8.25);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(''), null);
});
