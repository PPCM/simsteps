// Tests de la logique pure des fenêtres flottantes : bornage des
// positions, géométrie du glisser, état sérialisé et résumé des KPI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPosition, dragPosition, parsePanelState, serializePanelState, kpiSummaryText,
} from '../../../web/public/js/panels.js';

const viewport = { width: 1280, height: 720 };
const size = { width: 304, height: 400 };

test('clampPosition laisse une position intérieure inchangée', () => {
  assert.deepEqual(clampPosition({ x: 100, y: 50 }, size, viewport), { x: 100, y: 50 });
});

test('clampPosition ramène une fenêtre sortie à droite et en bas', () => {
  const pos = clampPosition({ x: 2000, y: 2000 }, size, viewport);
  assert.deepEqual(pos, { x: 1280 - 304 - 14, y: 720 - 400 - 14 });
});

test('clampPosition ramène une position négative sur la marge', () => {
  assert.deepEqual(clampPosition({ x: -50, y: -50 }, size, viewport), { x: 14, y: 14 });
});

test('clampPosition cale une fenêtre plus grande que la zone sur la marge', () => {
  const pos = clampPosition({ x: 300, y: 300 }, { width: 2000, height: 2000 }, viewport);
  assert.deepEqual(pos, { x: 14, y: 14 });
});

test('dragPosition applique le delta du pointeur à l’origine', () => {
  const pos = dragPosition({ x: 14, y: 14 }, { x: 100, y: 100 }, { x: 130, y: 80 });
  assert.deepEqual(pos, { x: 44, y: -6 });
});

test('parsePanelState relit un état valide', () => {
  assert.deepEqual(
    parsePanelState('{"x":120,"y":40,"collapsed":true}'),
    { x: 120, y: 40, collapsed: true }
  );
});

test('parsePanelState retombe sur les défauts si vide ou invalide', () => {
  const fallback = { x: null, y: null, collapsed: false };
  assert.deepEqual(parsePanelState(null), fallback);
  assert.deepEqual(parsePanelState(''), fallback);
  assert.deepEqual(parsePanelState('pas du JSON'), fallback);
  assert.deepEqual(parsePanelState('{"x":"a","y":10,"collapsed":"oui"}'), fallback);
});

test('serializePanelState puis parsePanelState restituent l’état', () => {
  const state = { x: 33, y: 77, collapsed: true };
  assert.deepEqual(parsePanelState(serializePanelState(state)), state);
  assert.deepEqual(
    parsePanelState(serializePanelState({ x: null, y: null, collapsed: false })),
    { x: null, y: null, collapsed: false }
  );
});

test('kpiSummaryText formate les deux KPI clés à la française', () => {
  assert.equal(kpiSummaryText({ ordersPerHour: 41.23, occupancyRate: 0.821 }), '41,2 cmd/h · 82,1 %');
  assert.equal(kpiSummaryText(null), '');
});
