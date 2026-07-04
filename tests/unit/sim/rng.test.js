// Tests du générateur pseudo-aléatoire déterministe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, randInt, randExponential, randChoice } from '../../../sim/rng.js';

test('mulberry32 est déterministe pour une même graine', () => {
  const a = mulberry32(123);
  const b = mulberry32(123);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('mulberry32 produit des valeurs dans [0, 1)', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `valeur hors bornes : ${v}`);
  }
});

test('randInt respecte les bornes incluses', () => {
  const rng = mulberry32(9);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = randInt(rng, 2, 5);
    assert.ok(v >= 2 && v <= 5);
    seen.add(v);
  }
  // Les deux bornes doivent être atteignables
  assert.ok(seen.has(2) && seen.has(5));
});

test('randExponential renvoie des délais strictement positifs de moyenne 1/taux', () => {
  const rng = mulberry32(11);
  const rate = 0.5;
  let sum = 0;
  const n = 10000;
  for (let i = 0; i < n; i++) {
    const v = randExponential(rng, rate);
    assert.ok(v > 0);
    sum += v;
  }
  const mean = sum / n;
  // Moyenne théorique 1/0,5 = 2 s, tolérance large
  assert.ok(Math.abs(mean - 2) < 0.2, `moyenne inattendue : ${mean}`);
});

test('randChoice renvoie toujours un élément du tableau', () => {
  const rng = mulberry32(13);
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) {
    assert.ok(items.includes(randChoice(rng, items)));
  }
});
