// Tests de l'historique d'édition (annuler/rétablir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../../web/public/js/editor/history.js';

test('annuler puis rétablir restituent les états dans l’ordre', () => {
  const history = createHistory();
  history.push('v1'); // édition : v1 → v2
  history.push('v2'); // édition : v2 → v3
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo('v3'), 'v2');
  assert.equal(history.undo('v2'), 'v1');
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo('v1'), null);
  assert.equal(history.redo('v1'), 'v2');
  assert.equal(history.redo('v2'), 'v3');
  assert.equal(history.redo('v3'), null);
});

test('une nouvelle édition efface le futur', () => {
  const history = createHistory();
  history.push('v1');
  history.push('v2');
  assert.equal(history.undo('v3'), 'v2');
  history.push('v2'); // édition divergente : v2 → v4
  assert.equal(history.canRedo(), false);
  assert.equal(history.redo('v4'), null);
  assert.equal(history.undo('v4'), 'v2');
});

test('la profondeur est bornée (les plus anciens états tombent)', () => {
  const history = createHistory(2);
  history.push('v1');
  history.push('v2');
  history.push('v3');
  assert.equal(history.undo('v4'), 'v3');
  assert.equal(history.undo('v3'), 'v2');
  assert.equal(history.undo('v2'), null, 'v1 doit être tombé de la pile');
});

test('reset vide les deux piles', () => {
  const history = createHistory();
  history.push('v1');
  history.undo('v2');
  history.reset();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});
