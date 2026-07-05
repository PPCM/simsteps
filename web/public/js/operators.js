// Rendu des agents. Piétons (et emballeurs) : capsule colorée selon
// l'état. Engins : modèle low-poly composé de boîtes (châssis, mât,
// fourches, roues, toit…) à la carrosserie orange constante, avec un
// conducteur (capsule) visible dès que l'engin est en mission — debout
// derrière le timon pour les engins accompagnants — et un anneau d'état
// au sol. Les engins pivotent pour faire face à leur direction de
// déplacement. Les positions viennent de la timeline (interpolation).

import * as THREE from 'three';
import { positionAt, stateAt } from './timeline.js';

// Couleur par état (cahier des charges : déplacement, prélèvement,
// dépose, attente, inactif)
export const STATE_COLORS = {
  moving: 0x58a6ff,   // en déplacement : bleu
  picking: 0xffb14e,  // en prélèvement : ambre
  dropping: 0x3f8f78, // en dépose : vert d'eau
  idle: 0x6b737e,     // inactif : gris
  waiting: 0xd95f5f,  // en attente à l'entrée d'une allée : rouge
};

const CAPSULE_RADIUS = 0.35;
const CAPSULE_LENGTH = 0.9;

// Couleurs fixes des pièces d'engin (l'état vit sur l'anneau au sol)
const PART_COLORS = {
  body: 0xd98a1f,      // carrosserie
  steel: 0x98a2b0,     // mât
  darksteel: 0x4a525e, // timon, tourelle
  fork: 0xc9d0da,      // fourches
  wheel: 0x111418,     // roues
  guard: 0x333a45,     // toit et montants de protection, garde-corps
  driver: 0xdfe3e8,    // conducteur
};

// Roue : petit pavé sombre (s : diamètre)
function wheel(x, z, big = false) {
  const s = big ? 0.46 : 0.3;
  return { x, y: s / 2, z, w: s, h: s, d: 0.16, role: 'wheel' };
}

// Modèles par type d'engin : pièces { x, y, z, w, h, d, role } en mètres,
// x = longueur (avant vers +x), y = hauteur, z = largeur. Le rôle
// « driver » est une capsule, visible seulement en mission. `ringR` :
// rayon de l'anneau d'état au sol.
export const VEHICLE_MODELS = {
  transpalette: {
    ringR: 1.1,
    parts: [
      { x: -1.02, y: 0.72, z: 0, w: 0.32, h: 0.8, d: 0.36, role: 'driver' },
      wheel(-0.55, -0.26, true), wheel(-0.55, 0.26, true), wheel(0.72, -0.2), wheel(0.72, 0.2),
      { x: -0.55, y: 0.42, z: 0, w: 0.55, h: 0.62, d: 0.72, role: 'body' },
      { x: -0.55, y: 0.95, z: 0, w: 0.13, h: 0.66, d: 0.13, role: 'darksteel' },
      { x: -0.55, y: 1.3, z: 0, w: 0.16, h: 0.13, d: 0.5, role: 'darksteel' },
      { x: 0.28, y: 0.14, z: -0.2, w: 1.15, h: 0.12, d: 0.19, role: 'fork' },
      { x: 0.28, y: 0.14, z: 0.2, w: 1.15, h: 0.12, d: 0.19, role: 'fork' },
    ],
  },
  gerbeur: {
    ringR: 1.2,
    parts: [
      { x: -1.08, y: 0.72, z: 0, w: 0.32, h: 0.8, d: 0.36, role: 'driver' },
      wheel(-0.6, -0.3, true), wheel(-0.6, 0.3, true), wheel(0.75, -0.22), wheel(0.75, 0.22),
      { x: -0.6, y: 0.42, z: 0, w: 0.6, h: 0.62, d: 0.8, role: 'body' },
      { x: -0.6, y: 1.0, z: 0, w: 0.13, h: 0.6, d: 0.13, role: 'darksteel' },
      { x: -0.6, y: 1.32, z: 0, w: 0.16, h: 0.13, d: 0.48, role: 'darksteel' },
      { x: -0.13, y: 0.95, z: -0.26, w: 0.12, h: 1.9, d: 0.13, role: 'steel' },
      { x: -0.13, y: 0.95, z: 0.26, w: 0.12, h: 1.9, d: 0.13, role: 'steel' },
      { x: -0.13, y: 1.78, z: 0, w: 0.12, h: 0.1, d: 0.62, role: 'steel' },
      { x: -0.13, y: 1.1, z: 0, w: 0.12, h: 0.1, d: 0.62, role: 'steel' },
      { x: 0.42, y: 0.42, z: -0.2, w: 1.0, h: 0.11, d: 0.18, role: 'fork' },
      { x: 0.42, y: 0.42, z: 0.2, w: 1.0, h: 0.11, d: 0.18, role: 'fork' },
    ],
  },
  frontal: {
    ringR: 1.5,
    parts: [
      wheel(-0.75, -0.5, true), wheel(-0.75, 0.5, true), wheel(0.45, -0.5, true), wheel(0.45, 0.5, true),
      { x: -0.78, y: 0.55, z: 0, w: 0.62, h: 0.85, d: 1.05, role: 'body' },
      { x: -0.05, y: 0.52, z: 0, w: 1.15, h: 0.5, d: 1.1, role: 'body' },
      { x: -0.28, y: 1.0, z: 0, w: 0.42, h: 0.42, d: 0.62, role: 'guard' },
      { x: -0.2, y: 1.25, z: 0, w: 0.3, h: 0.62, d: 0.34, role: 'driver' },
      { x: -0.52, y: 1.35, z: -0.45, w: 0.08, h: 1.15, d: 0.08, role: 'guard' },
      { x: -0.52, y: 1.35, z: 0.45, w: 0.08, h: 1.15, d: 0.08, role: 'guard' },
      { x: 0.32, y: 1.35, z: -0.45, w: 0.08, h: 1.15, d: 0.08, role: 'guard' },
      { x: 0.32, y: 1.35, z: 0.45, w: 0.08, h: 1.15, d: 0.08, role: 'guard' },
      { x: -0.1, y: 1.95, z: 0, w: 1.0, h: 0.09, d: 1.02, role: 'guard' },
      { x: 0.78, y: 1.0, z: -0.3, w: 0.12, h: 2.0, d: 0.13, role: 'steel' },
      { x: 0.78, y: 1.0, z: 0.3, w: 0.12, h: 2.0, d: 0.13, role: 'steel' },
      { x: 0.78, y: 1.85, z: 0, w: 0.12, h: 0.1, d: 0.7, role: 'steel' },
      { x: 0.78, y: 0.9, z: 0, w: 0.12, h: 0.1, d: 0.7, role: 'steel' },
      { x: 1.4, y: 0.1, z: -0.25, w: 1.05, h: 0.1, d: 0.17, role: 'fork' },
      { x: 1.4, y: 0.1, z: 0.25, w: 1.05, h: 0.1, d: 0.17, role: 'fork' },
    ],
  },
  retractable: {
    ringR: 1.5,
    parts: [
      wheel(-0.7, 0, true), wheel(1.05, -0.45), wheel(1.05, 0.45),
      { x: 0.55, y: 0.16, z: -0.45, w: 1.5, h: 0.2, d: 0.2, role: 'body' },
      { x: 0.55, y: 0.16, z: 0.45, w: 1.5, h: 0.2, d: 0.2, role: 'body' },
      { x: -0.62, y: 0.62, z: 0, w: 1.0, h: 1.0, d: 1.05, role: 'body' },
      { x: -0.55, y: 1.45, z: 0, w: 0.3, h: 0.6, d: 0.34, role: 'driver' },
      { x: -0.85, y: 1.6, z: -0.45, w: 0.08, h: 0.95, d: 0.08, role: 'guard' },
      { x: -0.85, y: 1.6, z: 0.45, w: 0.08, h: 0.95, d: 0.08, role: 'guard' },
      { x: -0.3, y: 1.6, z: -0.45, w: 0.08, h: 0.95, d: 0.08, role: 'guard' },
      { x: -0.3, y: 1.6, z: 0.45, w: 0.08, h: 0.95, d: 0.08, role: 'guard' },
      { x: -0.58, y: 2.08, z: 0, w: 0.72, h: 0.09, d: 1.0, role: 'guard' },
      { x: 0.3, y: 1.05, z: -0.32, w: 0.13, h: 2.1, d: 0.14, role: 'steel' },
      { x: 0.3, y: 1.05, z: 0.32, w: 0.13, h: 2.1, d: 0.14, role: 'steel' },
      { x: 0.3, y: 1.95, z: 0, w: 0.13, h: 0.1, d: 0.72, role: 'steel' },
      { x: 0.3, y: 1.0, z: 0, w: 0.13, h: 0.1, d: 0.72, role: 'steel' },
      { x: 0.95, y: 0.5, z: -0.25, w: 1.0, h: 0.1, d: 0.17, role: 'fork' },
      { x: 0.95, y: 0.5, z: 0.25, w: 1.0, h: 0.1, d: 0.17, role: 'fork' },
    ],
  },
  vna: {
    ringR: 1.8,
    parts: [
      wheel(-1.05, -0.4), wheel(-1.05, 0.4), wheel(0.9, -0.4), wheel(0.9, 0.4),
      { x: -0.55, y: 0.36, z: 0, w: 1.9, h: 0.55, d: 1.3, role: 'body' },
      { x: -1.0, y: 1.15, z: 0, w: 0.85, h: 1.0, d: 1.2, role: 'body' },
      { x: -1.0, y: 1.4, z: 0, w: 0.3, h: 0.6, d: 0.34, role: 'driver' },
      { x: -1.0, y: 1.85, z: 0, w: 0.8, h: 0.08, d: 1.1, role: 'guard' },
      { x: 0.45, y: 1.2, z: -0.35, w: 0.14, h: 2.3, d: 0.15, role: 'steel' },
      { x: 0.45, y: 1.2, z: 0.35, w: 0.14, h: 2.3, d: 0.15, role: 'steel' },
      { x: 0.45, y: 2.2, z: 0, w: 0.14, h: 0.1, d: 0.82, role: 'steel' },
      { x: 0.45, y: 1.2, z: 0, w: 0.14, h: 0.1, d: 0.82, role: 'steel' },
      { x: 0.85, y: 0.85, z: 0.15, w: 0.5, h: 0.5, d: 0.4, role: 'darksteel' },
      { x: 0.72, y: 0.68, z: 0.75, w: 0.16, h: 0.1, d: 0.85, role: 'fork' },
      { x: 1.0, y: 0.68, z: 0.75, w: 0.16, h: 0.1, d: 0.85, role: 'fork' },
    ],
  },
  preparateur: {
    ringR: 1.3,
    parts: [
      wheel(-0.6, -0.35), wheel(-0.6, 0.35), wheel(0.55, -0.35), wheel(0.55, 0.35),
      { x: -0.1, y: 0.3, z: 0, w: 1.5, h: 0.42, d: 0.95, role: 'body' },
      { x: -0.8, y: 1.0, z: -0.32, w: 0.1, h: 1.15, d: 0.1, role: 'steel' },
      { x: -0.8, y: 1.0, z: 0.32, w: 0.1, h: 1.15, d: 0.1, role: 'steel' },
      { x: -0.8, y: 1.5, z: 0, w: 0.1, h: 0.09, d: 0.72, role: 'steel' },
      { x: -0.1, y: 0.58, z: 0, w: 1.0, h: 0.12, d: 0.85, role: 'body' },
      { x: -0.1, y: 1.05, z: 0, w: 0.3, h: 0.62, d: 0.34, role: 'driver' },
      { x: 0.32, y: 1.0, z: -0.4, w: 0.07, h: 0.75, d: 0.07, role: 'guard' },
      { x: 0.32, y: 1.0, z: 0.4, w: 0.07, h: 0.75, d: 0.07, role: 'guard' },
      { x: 0.35, y: 1.3, z: 0, w: 0.08, h: 0.08, d: 0.85, role: 'guard' },
      { x: 1.15, y: 0.2, z: -0.22, w: 0.75, h: 0.1, d: 0.17, role: 'fork' },
      { x: 1.15, y: 0.2, z: 0.22, w: 0.75, h: 0.1, d: 0.17, role: 'fork' },
    ],
  },
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
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const ringGeometries = new Map(); // rayon → géométrie partagée
  // Matériaux fixes partagés entre tous les engins
  const partMaterials = new Map(Object.entries(PART_COLORS).map(([role, color]) => [
    role,
    new THREE.MeshStandardMaterial({ color, roughness: role === 'fork' ? 0.35 : 0.65 }),
  ]));
  const entries = new Map();

  // Assemble le modèle low-poly d'un engin (groupe orientable)
  function buildVehicle(type) {
    const model = VEHICLE_MODELS[type];
    const group = new THREE.Group();
    group.userData = { vehicleType: type };
    let driver = null;
    for (const part of model.parts) {
      let mesh;
      if (part.role === 'driver') {
        mesh = new THREE.Mesh(capsuleGeometry, partMaterials.get('driver'));
        // La capsule (rayon 0,35, longueur 0,9) est ramenée au gabarit
        const height = part.h + part.w * 1.2;
        mesh.scale.set(part.w / (CAPSULE_RADIUS * 2), height / (CAPSULE_LENGTH + CAPSULE_RADIUS * 2), part.d / (CAPSULE_RADIUS * 2));
        driver = mesh;
      } else {
        mesh = new THREE.Mesh(unitBox, partMaterials.get(part.role));
        mesh.scale.set(part.w, part.h, part.d);
      }
      mesh.position.set(part.x, part.y, part.z);
      mesh.castShadow = true;
      group.add(mesh);
    }
    // Anneau d'état au sol (matériau propre : sa couleur suit l'état)
    if (!ringGeometries.has(model.ringR)) {
      ringGeometries.set(model.ringR, new THREE.RingGeometry(model.ringR - 0.12, model.ringR, 28));
    }
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: STATE_COLORS.idle, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometries.get(model.ringR), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    // Au-dessus des bandes de couloir (0,03) et de la heatmap (0,05)
    ring.position.y = 0.07;
    group.add(ring);
    return { group, driver, ringMaterial };
  }

  let vehicleIndex = 0;
  for (const [opId, track] of tracks) {
    const type = vehicles.get(opId);
    if (type !== undefined && type !== 'pieton' && VEHICLE_MODELS[type] !== undefined) {
      const { group, driver, ringMaterial } = buildVehicle(type);
      group.position.set(track.start[0], 0, track.start[1]);
      scene.add(group);
      // Place de stationnement : les engins d'un même parking partagent
      // un nœud unique — à l'arrêt, chacun glisse vers un décalage
      // propre (grille 4 × n) pour ne pas s'interpénétrer
      const parkOffset = {
        x: (vehicleIndex % 4) * 2.8 - 4.2,
        z: Math.floor(vehicleIndex / 4) * 2.0 - 1.0,
      };
      vehicleIndex++;
      entries.set(opId, {
        kind: 'vehicle', object: group, driver, ringMaterial, track,
        lastState: null, lastX: track.start[0], lastZ: track.start[1],
        parkOffset, offsetX: 0, offsetZ: 0,
      });
    } else {
      // Piéton (préparateur à pied, emballeur) : capsule d'état
      const material = new THREE.MeshStandardMaterial({
        color: STATE_COLORS.idle,
        emissive: STATE_COLORS.idle,
        emissiveIntensity: 0.45,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(capsuleGeometry, material);
      mesh.castShadow = true;
      mesh.position.set(track.start[0], CAPSULE_RADIUS + CAPSULE_LENGTH / 2, track.start[1]);
      scene.add(mesh);
      entries.set(opId, { kind: 'walker', object: mesh, track, lastState: null });
    }
  }

  return {
    update(t) {
      for (const entry of entries.values()) {
        const { x, y } = positionAt(entry.track, t);
        const state = stateAt(entry.track, t);
        if (entry.kind === 'walker') {
          entry.object.position.x = x;
          entry.object.position.z = y;
          if (state !== entry.lastState) {
            const color = STATE_COLORS[state] ?? STATE_COLORS.idle;
            entry.object.material.color.setHex(color);
            entry.object.material.emissive.setHex(color);
            entry.lastState = state;
          }
          continue;
        }
        // Engin : position, orientation vers la direction de déplacement
        // (l'avant du modèle est le +x local), anneau d'état, conducteur
        // visible seulement en mission. À l'arrêt, l'engin glisse vers
        // sa place de stationnement (décalage amorti)
        const targetX = state === 'idle' ? entry.parkOffset.x : 0;
        const targetZ = state === 'idle' ? entry.parkOffset.z : 0;
        entry.offsetX += (targetX - entry.offsetX) * 0.06;
        entry.offsetZ += (targetZ - entry.offsetZ) * 0.06;
        entry.object.position.x = x + entry.offsetX;
        entry.object.position.z = y + entry.offsetZ;
        const dx = x - entry.lastX;
        const dz = y - entry.lastZ;
        if (dx * dx + dz * dz > 1e-4) {
          entry.object.rotation.y = Math.atan2(-dz, dx);
          entry.lastX = x;
          entry.lastZ = y;
        }
        if (state !== entry.lastState) {
          entry.ringMaterial.color.setHex(STATE_COLORS[state] ?? STATE_COLORS.idle);
          if (entry.driver !== null) entry.driver.visible = state !== 'idle';
          entry.lastState = state;
        }
      }
    },
    dispose() {
      for (const entry of entries.values()) {
        scene.remove(entry.object);
        if (entry.kind === 'walker') entry.object.material.dispose();
        else entry.ringMaterial.dispose();
      }
      capsuleGeometry.dispose();
      unitBox.dispose();
      for (const geometry of ringGeometries.values()) geometry.dispose();
      for (const material of partMaterials.values()) material.dispose();
    },
  };
}
