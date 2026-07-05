// Tests de la logique pure des projets côté client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLIDER_KEYS,
  splitSettings,
  buildSettings,
  mergeProjectParams,
} from '../../../web/public/js/projects.js';

test('splitSettings sépare curseurs et extras', () => {
  const { sliders, extras } = splitSettings({
    operators: 8, b2cShare: 0.9, ordersPerHour: 60,
    strategy: 'zoneWave', seed: 7,
  });
  assert.deepEqual(sliders, { operators: 8, b2cShare: 0.9, ordersPerHour: 60 });
  assert.deepEqual(extras, { strategy: 'zoneWave', seed: 7 });
});

test('splitSettings accepte des paramétrages vides ou absents', () => {
  assert.deepEqual(splitSettings({}), { sliders: {}, extras: {} });
  assert.deepEqual(splitSettings(), { sliders: {}, extras: {} });
});

test('buildSettings recompose extras + curseurs', () => {
  const settings = buildSettings(
    { strategy: 'zoneWave' },
    { operators: 5, b2cShare: 0.4, ordersPerHour: 30 }
  );
  assert.deepEqual(settings, {
    strategy: 'zoneWave', operators: 5, b2cShare: 0.4, ordersPerHour: 30,
  });
});

test('mergeProjectParams : priorité curseurs > extras > scénario', () => {
  const params = mergeProjectParams(
    { operators: 2, strategy: 'orderByOrder', seed: 1 },
    { strategy: 'zoneWave', operators: 4 },
    { operators: 9, b2cShare: 0.5, ordersPerHour: 40 }
  );
  assert.equal(params.operators, 9); // curseur gagne
  assert.equal(params.strategy, 'zoneWave'); // extra gagne sur le scénario
  assert.equal(params.seed, 1); // le scénario reste sinon
  assert.equal(params.b2cShare, 0.5);
});

test('les clés de curseurs couvrent les contrôles du panneau (flotte comprise)', () => {
  assert.deepEqual(SLIDER_KEYS, ['operators', 'fleet', 'b2cShare', 'ordersPerHour', 'slotting',
    'replenishment', 'inboundTrucksPerDay', 'packers', 'corridorExclusion']);
});

test('splitSettings range la flotte côté curseurs', () => {
  const { sliders, extras } = splitSettings({
    fleet: { pieton: 2, vna: 1 }, strategy: 'zoneWave', operators: 2,
  });
  assert.deepEqual(sliders, { fleet: { pieton: 2, vna: 1 }, operators: 2 });
  assert.deepEqual(extras, { strategy: 'zoneWave' });
});
