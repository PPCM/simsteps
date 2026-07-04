// Tests de l'enregistrement/relecture des trajectoires (module pur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, positionAt, stateAt } from '../../../web/public/js/timeline.js';

// Graphe minimal : a(0,0) — b(3,0) — c(3,4), départ en « exp » (10, 0)
const graph = {
  nodes: new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 3, y: 0 }],
    ['c', { x: 3, y: 4 }],
    ['exp', { x: 10, y: 0 }],
  ]),
};

function recordedTrack() {
  const recorder = createRecorder(graph);
  // Déplacement a → b → c : 7 m en 7 s (1 m/s), départ à t = 10
  recorder.hooks.onState('op-1', 'moving', 10);
  recorder.hooks.onTravel('op-1', ['a', 'b', 'c'], 10, 7, 7);
  recorder.hooks.onState('op-1', 'picking', 17);
  recorder.hooks.onState('op-1', 'idle', 29);
  return recorder.finish('exp').get('op-1');
}

test('avant le premier déplacement, l’opérateur est à son point de départ', () => {
  const track = recordedTrack();
  assert.deepEqual(positionAt(track, 0), { x: 10, y: 0 });
  assert.equal(stateAt(track, 0), 'idle');
});

test('la position est interpolée le long du chemin à vitesse constante', () => {
  const track = recordedTrack();
  assert.deepEqual(positionAt(track, 10), { x: 0, y: 0 }); // départ
  assert.deepEqual(positionAt(track, 11.5), { x: 1.5, y: 0 }); // milieu de a→b
  assert.deepEqual(positionAt(track, 13), { x: 3, y: 0 }); // virage en b
  assert.deepEqual(positionAt(track, 15), { x: 3, y: 2 }); // milieu de b→c
  assert.deepEqual(positionAt(track, 17), { x: 3, y: 4 }); // arrivée
});

test('après l’arrivée, l’opérateur reste immobile à sa destination', () => {
  const track = recordedTrack();
  assert.deepEqual(positionAt(track, 25), { x: 3, y: 4 });
  assert.deepEqual(positionAt(track, 10000), { x: 3, y: 4 });
});

test('l’état suit les transitions enregistrées', () => {
  const track = recordedTrack();
  assert.equal(stateAt(track, 9.9), 'idle');
  assert.equal(stateAt(track, 12), 'moving');
  assert.equal(stateAt(track, 20), 'picking');
  assert.equal(stateAt(track, 30), 'idle');
});

test('un déplacement de durée nulle place directement à destination', () => {
  const recorder = createRecorder(graph);
  recorder.hooks.onTravel('op-1', ['a'], 5, 0, 0);
  const track = recorder.finish('exp').get('op-1');
  assert.deepEqual(positionAt(track, 5), { x: 0, y: 0 });
  assert.deepEqual(positionAt(track, 6), { x: 0, y: 0 });
});

test('plusieurs segments successifs se relisent dans l’ordre', () => {
  const recorder = createRecorder(graph);
  recorder.hooks.onTravel('op-1', ['a', 'b'], 0, 3, 3);
  recorder.hooks.onTravel('op-1', ['b', 'c'], 10, 4, 4);
  const track = recorder.finish('exp').get('op-1');
  assert.deepEqual(positionAt(track, 5), { x: 3, y: 0 }); // pause en b
  assert.deepEqual(positionAt(track, 12), { x: 3, y: 2 }); // en route vers c
});
