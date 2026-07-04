// Heatmap au sol : chaque arête du graphe de circulation est matérialisée
// par une bande colorée selon sa fréquentation (trafic du run courant).

import * as THREE from 'three';

const HEAT_LOW = new THREE.Color(0x35322c);
const HEAT_HIGH = new THREE.Color(0xffb14e);
const BAND_WIDTH = 0.8;
const BAND_Y = 0.05; // au-dessus du sol et de la grille

/**
 * Crée la couche heatmap (masquée par défaut, activable via le panneau).
 * @param {THREE.Scene} scene
 * @param {{nodes: Map<string, {x: number, y: number}>}} graph
 * @param {Array<{from: string, to: string, count: number}>} traffic
 * @returns {{setVisible: (v: boolean) => void, dispose: () => void}}
 */
export function createHeatmapLayer(scene, graph, traffic) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const max = Math.max(1, ...traffic.map((e) => e.count));
  for (const { from, to, count } of traffic) {
    const a = graph.nodes.get(from);
    const b = graph.nodes.get(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;

    const geometry = new THREE.PlaneGeometry(length + BAND_WIDTH / 2, BAND_WIDTH);
    geometry.rotateX(-Math.PI / 2);
    // Échelle racine carrée : garde les segments moyens lisibles
    const color = HEAT_LOW.clone().lerp(HEAT_HIGH, Math.sqrt(count / max));
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Après rotateX, la longueur de la bande suit l'axe X local :
    // orientation autour de Y vers la direction a → b
    mesh.rotation.y = Math.atan2(-(b.y - a.y), b.x - a.x);
    mesh.position.set((a.x + b.x) / 2, BAND_Y, (a.y + b.y) / 2);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  return {
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      scene.remove(group);
      for (const mesh of group.children) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
