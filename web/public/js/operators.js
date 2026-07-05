// Rendu des agents : capsule pour le piéton, pavé au gabarit de
// l'engin pour la flotte, colorés selon l'état et positionnés chaque
// frame depuis la timeline (interpolation entre les ticks).

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

// Silhouettes simplifiées des engins : longueur × largeur × hauteur (m)
const VEHICLE_SHAPES = {
  transpalette: [1.6, 0.8, 1.3],
  gerbeur: [1.8, 0.9, 1.9],
  frontal: [2.3, 1.2, 2.1],
  retractable: [2.4, 1.2, 2.2],
  vna: [3.0, 1.4, 2.4],
  preparateur: [2.0, 1.0, 1.7],
};

/**
 * Crée la couche des agents dans la scène.
 * @param {THREE.Scene} scene
 * @param {Map<string, object>} tracks pistes de la timeline (une par agent)
 * @param {Map<string, string>} [vehicles] type d'engin par id d'agent
 *        (absent ou « pieton » : capsule)
 * @returns {{update: (t: number) => void}} update positionne les agents à l'instant t
 */
export function createOperatorLayer(scene, tracks, vehicles = new Map()) {
  const capsuleGeometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 12);
  const vehicleGeometries = new Map(); // une géométrie partagée par type
  const meshes = new Map();

  for (const [opId, track] of tracks) {
    const shape = VEHICLE_SHAPES[vehicles.get(opId)];
    let geometry = capsuleGeometry;
    let groundY = CAPSULE_RADIUS + CAPSULE_LENGTH / 2;
    if (shape) {
      const type = vehicles.get(opId);
      if (!vehicleGeometries.has(type)) {
        // Longueur de l'engin le long de z (le plan est vu du dessus)
        vehicleGeometries.set(type, new THREE.BoxGeometry(shape[1], shape[2], shape[0]));
      }
      geometry = vehicleGeometries.get(type);
      groundY = shape[2] / 2;
    }
    // Matériau individuel : la couleur change avec l'état. L'émissivité
    // garde les agents repérables même en vue éloignée
    const material = new THREE.MeshStandardMaterial({
      color: STATE_COLORS.idle,
      emissive: STATE_COLORS.idle,
      emissiveIntensity: 0.45,
      roughness: 0.55,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.position.set(track.start[0], groundY, track.start[1]);
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
          // Un opérateur au volant est dans la cabine : capsule masquée
          entry.mesh.visible = state !== 'driving';
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
      capsuleGeometry.dispose();
      for (const geometry of vehicleGeometries.values()) geometry.dispose();
    },
  };
}
