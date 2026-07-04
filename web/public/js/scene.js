// Construction de la scène 3D statique de l'entrepôt : sol, racks,
// zones colorées et étiquettes, éclairage et caméra orbitale.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { floorSize, rackBoxes, zonePatches, aisleLabels } from './layout.js';
import { makeTextSprite } from './labels.js';

// Palette de la scène (thème sombre)
const COLORS = {
  background: 0x14171c,
  floor: 0x1b2027,
  grid: 0x262c35,
  gridCenter: 0x2e3540,
  rack: 0x3a4250,
  rackEdge: 0x161a20,
  zones: {
    workshop: 0x3f8f78, // ateliers : vert d'eau
    shipping: 0xffb14e, // expédition : ambre (accent SimSteps)
    receiving: 0x7a8fd4, // réception : bleu acier
  },
};

/**
 * Initialise le rendu 3D dans un canvas et construit l'entrepôt.
 * @param {HTMLCanvasElement} canvas
 * @param {object} definition définition JSON de l'entrepôt
 * @returns {{scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer,
 *            controls: OrbitControls, dispose: () => void}}
 */
export function createWarehouseScene(canvas, definition) {
  const { width, depth } = floorSize(definition);
  const center = new THREE.Vector3(width / 2, 0, depth / 2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, 90, 220);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(width * 1.05, 34, depth * 1.25);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // ne pas passer sous le sol
  controls.minDistance = 8;
  controls.maxDistance = 160;

  // --- Éclairage ---
  scene.add(new THREE.HemisphereLight(0x8a9db8, 0x1a1d22, 0.75));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(width * 0.8, 45, -depth * 0.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = Math.max(width, depth) * 0.75;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.far = 150;
  sun.target.position.copy(center);
  scene.add(sun, sun.target);

  // --- Sol et grille au mètre ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const gridSize = Math.max(width, depth);
  const grid = new THREE.GridHelper(gridSize, gridSize, COLORS.gridCenter, COLORS.grid);
  grid.position.set(width / 2, 0.02, depth / 2);
  scene.add(grid);

  // --- Racks : volumes simples avec arêtes marquées ---
  const rackMaterial = new THREE.MeshStandardMaterial({ color: COLORS.rack, roughness: 0.8 });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.rackEdge });
  for (const box of rackBoxes(definition)) {
    const geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    const mesh = new THREE.Mesh(geometry, rackMaterial);
    mesh.position.set(box.x, box.height / 2, box.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    edges.position.copy(mesh.position);
    scene.add(edges);
  }

  // --- Zones colorées au sol + étiquettes flottantes ---
  for (const zone of zonePatches(definition)) {
    const color = COLORS.zones[zone.kind];
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.width, zone.depth),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.32, roughness: 1 })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(zone.x, 0.03, zone.z);
    scene.add(patch);

    const label = makeTextSprite(zone.label, {
      color: `#${color.toString(16).padStart(6, '0')}`,
      worldHeight: 1.3,
    });
    label.position.set(zone.x, 2.4, zone.z);
    scene.add(label);
  }

  // --- Étiquettes d'allées ---
  for (const aisle of aisleLabels(definition)) {
    const label = makeTextSprite(aisle.id, { color: '#9aa3ad', worldHeight: 1.1 });
    label.position.set(aisle.x, 0.8, aisle.z);
    scene.add(label);
  }

  function dispose() {
    controls.dispose();
    renderer.dispose();
  }

  return { scene, camera, renderer, controls, dispose };
}
