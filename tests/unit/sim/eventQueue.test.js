// Tests de la file d'événements (tas binaire min, stable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventQueue } from '../../../sim/eventQueue.js';

test('les événements sortent par temps croissant', () => {
  const q = new EventQueue();
  q.push(5, 'c');
  q.push(1, 'a');
  q.push(3, 'b');
  assert.equal(q.pop().type, 'a');
  assert.equal(q.pop().type, 'b');
  assert.equal(q.pop().type, 'c');
});

test('deux événements simultanés sortent dans leur ordre d’insertion', () => {
  const q = new EventQueue();
  q.push(2, 'premier');
  q.push(2, 'deuxième');
  q.push(2, 'troisième');
  assert.equal(q.pop().type, 'premier');
  assert.equal(q.pop().type, 'deuxième');
  assert.equal(q.pop().type, 'troisième');
});

test('pop sur une file vide renvoie null', () => {
  const q = new EventQueue();
  assert.equal(q.pop(), null);
});

test('peekTime, size et isEmpty reflètent le contenu', () => {
  const q = new EventQueue();
  assert.ok(q.isEmpty());
  assert.equal(q.peekTime(), null);
  q.push(4, 'x');
  q.push(2, 'y');
  assert.equal(q.size, 2);
  assert.equal(q.peekTime(), 2);
  assert.ok(!q.isEmpty());
});

test('le payload est restitué intact', () => {
  const q = new EventQueue();
  q.push(1, 'ev', { opId: 'op-3', n: 42 });
  assert.deepEqual(q.pop().payload, { opId: 'op-3', n: 42 });
});

test('ordre correct sur un grand volume mélangé', () => {
  const q = new EventQueue();
  const times = Array.from({ length: 500 }, (_, i) => (i * 7919) % 500);
  for (const t of times) q.push(t, 'ev');
  let previous = -Infinity;
  while (!q.isEmpty()) {
    const { time } = q.pop();
    assert.ok(time >= previous);
    previous = time;
  }
});
