// Rendu des opérateurs : capsules colorées selon l'état, positionnées
// chaque frame depuis la timeline (interpolation entre les ticks).

import * as THREE from 'three';
import { positionAt, stateAt } from './timeline.js';

// Couleur par état (cahier des charges : déplacement, prélèvement,
// dépose, inactif)
export const STATE_COLORS = {
  moving: 0x58a6ff,   // en déplacement : bleu
  picking: 0xffb14e,  // en prélèvement : ambre
  dropping: 0x3f8f78, // en dépose : vert d'eau
  idle: 0x6b737e,     // inactif : gris
};

const CAPSULE_RADIUS = 0.35;
const CAPSULE_LENGTH = 0.9;

/**
 * Crée la couche des opérateurs dans la scène.
 * @param {THREE.Scene} scene
 * @param {Map<string, object>} tracks pistes de la timeline (une par opérateur)
 * @returns {{update: (t: number) => void}} update positionne les capsules à l'instant t
 */
export function createOperatorLayer(scene, tracks) {
  const geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 12);
  const meshes = new Map();

  for (const [opId, track] of tracks) {
    // Matériau individuel : la couleur change avec l'état. L'émissivité
    // garde les opérateurs repérables même en vue éloignée
    const material = new THREE.MeshStandardMaterial({
      color: STATE_COLORS.idle,
      emissive: STATE_COLORS.idle,
      emissiveIntensity: 0.45,
      roughness: 0.55,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.position.set(track.start[0], CAPSULE_RADIUS + CAPSULE_LENGTH / 2, track.start[1]);
    scene.add(mesh);
    meshes.set(opId, { mesh, track, lastState: 'idle' });
  }

  return {
    update(t) {
      for (const entry of meshes.values()) {
        const { x, y } = positionAt(entry.track, t);
        entry.mesh.position.x = x;
        entry.mesh.position.z = y;
        const state = stateAt(entry.track, t);
        if (state !== entry.lastState) {
          const color = STATE_COLORS[state] ?? STATE_COLORS.idle;
          entry.mesh.material.color.setHex(color);
          entry.mesh.material.emissive.setHex(color);
          entry.lastState = state;
        }
      }
    },
    dispose() {
      for (const entry of meshes.values()) {
        scene.remove(entry.mesh);
        entry.mesh.material.dispose();
      }
      geometry.dispose();
    },
  };
}
