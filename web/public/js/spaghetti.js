// Diagramme spaghetti 3D : la trajectoire de chaque opérateur est une
// polyligne colorée, révélée progressivement jusqu'à l'instant courant
// de la relecture (setDrawRange).

import * as THREE from 'three';

// Une couleur par opérateur, en ordre fixe (jamais recyclée au sein
// d'un même run : au-delà de 8 opérateurs, le cycle reprend)
export const TRAIL_COLORS = [
  0x58a6ff, 0xffb14e, 0x6fce9a, 0xe07070,
  0xb48ead, 0x7a8fd4, 0xd4a13f, 0x63c5cf,
];

/**
 * Crée la couche des traînées (masquée par défaut).
 * @param {THREE.Scene} scene
 * @param {Map<string, object>} tracks pistes de la timeline
 * @returns {{setVisible: Function, update: (t: number) => void, dispose: Function}}
 */
export function createTrailLayer(scene, tracks) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const entries = [];
  let index = 0;
  for (const track of tracks.values()) {
    // Aplatissement des segments en une polyligne horodatée. Les segments
    // sont contigus (l'opérateur ne se téléporte pas), la ligne est continue.
    const positions = [];
    const times = [];
    const y = 0.12 + (index % TRAIL_COLORS.length) * 0.015; // limite le z-fighting
    for (const seg of track.segments) {
      for (const [x, z, cum] of seg.pts) {
        const t = seg.t1 === seg.t0 ? seg.t0 : seg.t0 + (cum / seg.dist) * (seg.t1 - seg.t0);
        positions.push(x, y, z);
        times.push(t);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      color: TRAIL_COLORS[index % TRAIL_COLORS.length],
      transparent: true,
      opacity: 0.8,
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);
    entries.push({ line, times, drawn: 0 });
    index++;
  }

  // Nombre de points dont l'horodatage est <= t (dichotomie)
  function countAtOrBefore(times, t) {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  return {
    setVisible(visible) {
      group.visible = visible;
    },
    update(t) {
      if (!group.visible) return;
      for (const entry of entries) {
        const n = countAtOrBefore(entry.times, t);
        if (n !== entry.drawn) {
          entry.line.geometry.setDrawRange(0, n);
          entry.drawn = n;
        }
      }
    },
    dispose() {
      scene.remove(group);
      for (const entry of entries) {
        entry.line.geometry.dispose();
        entry.line.material.dispose();
      }
    },
  };
}
