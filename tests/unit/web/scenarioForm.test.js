// Tests du descripteur de paramètres de scénario : complétude vis-à-vis
// du moteur (aucun paramètre oublié, défauts alignés), analyse des
// saisies et groupes de rendu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIO_FIELDS, parseFieldValue, fieldGroups } from '../../../web/public/js/scenarioForm.js';
import { SLIDER_KEYS } from '../../../web/public/js/projects.js';
import { DEFAULT_SCENARIO } from '../../../sim/engine.js';

test('descripteur + contrôles existants = tous les paramètres du moteur', () => {
  const covered = new Set([
    ...SCENARIO_FIELDS.map((f) => f.key),
    ...SLIDER_KEYS,
    'name', // métadonnée, pas un paramètre de simulation
  ]);
  const engine = Object.keys(DEFAULT_SCENARIO);
  const missing = engine.filter((key) => !covered.has(key));
  assert.deepEqual(missing, [], `paramètres moteur absents du panneau : ${missing.join(', ')}`);
  const unknown = SCENARIO_FIELDS.filter((f) => !engine.includes(f.key)).map((f) => f.key);
  assert.deepEqual(unknown, [], `champs sans paramètre moteur : ${unknown.join(', ')}`);
});

test('aucun champ du panneau ne double un contrôle existant', () => {
  const overlap = SCENARIO_FIELDS.filter((f) => SLIDER_KEYS.includes(f.key)).map((f) => f.key);
  assert.deepEqual(overlap, []);
});

test('les défauts du descripteur suivent DEFAULT_SCENARIO', () => {
  for (const field of SCENARIO_FIELDS) {
    assert.equal(field.default, DEFAULT_SCENARIO[field.key], field.key);
  }
});

test('les nombres sont bornés, la virgule décimale acceptée', () => {
  const speed = SCENARIO_FIELDS.find((f) => f.key === 'speedMps');
  assert.equal(parseFieldValue(speed, '1,5'), 1.5);
  assert.equal(parseFieldValue(speed, '99'), speed.max);
  assert.equal(parseFieldValue(speed, '0'), speed.min);
});

test('une saisie invalide retombe sur le défaut du champ', () => {
  const pick = SCENARIO_FIELDS.find((f) => f.key === 'pickTimePerLineSec');
  assert.equal(parseFieldValue(pick, 'abc'), pick.default);
  assert.equal(parseFieldValue(pick, ''), pick.default);
});

test('les valeurs des listes déroulantes passent telles quelles', () => {
  const strategy = SCENARIO_FIELDS.find((f) => f.key === 'strategy');
  assert.equal(parseFieldValue(strategy, 'zoneWave'), 'zoneWave');
});

test('les groupes couvrent tous les champs dans l’ordre du descripteur', () => {
  const groups = fieldGroups();
  const flattened = [...groups.values()].flat();
  assert.deepEqual(flattened, SCENARIO_FIELDS);
  assert.ok(groups.size >= 4);
});
