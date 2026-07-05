// Tests des modèles low-poly des engins (données pures du module de rendu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_MODELS, STATE_COLORS } from '../../../web/public/js/operators.js';
import { VEHICLES } from '../../../sim/vehicles.js';

test('chaque type d’engin du catalogue a un modèle 3D', () => {
  const machineTypes = Object.keys(VEHICLES).filter((t) => t !== 'pieton');
  assert.deepEqual(Object.keys(VEHICLE_MODELS).sort(), machineTypes.sort());
});

test('chaque modèle a un conducteur, des roues, des pièces cohérentes', () => {
  for (const [type, model] of Object.entries(VEHICLE_MODELS)) {
    assert.ok(model.ringR > 0, `${type} : rayon d'anneau requis`);
    assert.ok(model.parts.length >= 8, `${type} : modèle trop pauvre (${model.parts.length} pièces)`);
    assert.equal(model.parts.filter((p) => p.role === 'driver').length, 1,
      `${type} : exactement un conducteur`);
    assert.ok(model.parts.some((p) => p.role === 'wheel'), `${type} : des roues`);
    assert.ok(model.parts.some((p) => p.role === 'fork'), `${type} : des fourches`);
    for (const part of model.parts) {
      assert.ok(part.w > 0 && part.h > 0 && part.d > 0, `${type} : dimensions positives`);
      assert.ok(part.y - part.h / 2 > -1e-9, `${type} : pièce sous le sol`);
    }
  }
});

test('l’état d’attente a sa couleur', () => {
  assert.ok(STATE_COLORS.waiting !== undefined);
});
