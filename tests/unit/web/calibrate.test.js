// Tests du recalage assisté sur une fonction modèle (KPI décroissant
// avec le temps de prélèvement) : convergence, tolérance, bornes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate } from '../../../web/public/js/calibrate.js';

// Modèle simple : productivité ∝ 1/(trajet fixe + temps de prélèvement)
const model = (pickTime) => 3600 / (30 + pickTime);

test('retrouve la valeur qui produit la cible, en peu de runs', async () => {
  const target = model(15); // cible fabriquée avec pickTime = 15 s
  const result = await calibrate(model, target, { min: 1, max: 120, tolerance: 0.02 });
  assert.equal(result.converged, true);
  assert.ok(Math.abs(result.value - 15) <= 1, `valeur trouvée : ${result.value}`);
  assert.ok(result.iterations <= 12, `${result.iterations} runs`);
  assert.ok(Math.abs(result.achieved - target) <= 0.02 * target);
});

test('cible trop haute (inatteignable même au plus rapide) : non convergé', async () => {
  const result = await calibrate(model, model(1) * 2, { min: 1, max: 120 });
  assert.equal(result.converged, false);
  assert.equal(result.value, 1); // meilleure borne proposée quand même
});

test('cible trop basse (même au plus lent on produit plus) : non convergé', async () => {
  const result = await calibrate(model, model(120) / 2, { min: 1, max: 120 });
  assert.equal(result.converged, false);
  assert.equal(result.value, 120);
});

test('une cible déjà atteinte à une borne converge sans bissection', async () => {
  const result = await calibrate(model, model(1), { min: 1, max: 120 });
  assert.equal(result.converged, true);
  assert.equal(result.value, 1);
  assert.ok(result.iterations <= 2);
});

test('réponse plate (système sous-chargé) : recalage signalé sans objet', async () => {
  // Le KPI ne bouge pas avec le paramètre : demande < capacité
  const result = await calibrate(() => 10, 10, { min: 1, max: 120 });
  assert.equal(result.converged, false);
  assert.equal(result.flat, true);
});

test('cible invalide refusée en français', async () => {
  await assert.rejects(() => calibrate(model, 0), /strictement positif/);
  await assert.rejects(() => calibrate(model, Number.NaN), /strictement positif/);
});

test('accepte une fonction de run asynchrone', async () => {
  const target = model(40);
  const result = await calibrate(async (p) => model(p), target, { tolerance: 0.02 });
  assert.equal(result.converged, true);
  assert.ok(Math.abs(result.value - 40) <= 2);
});
