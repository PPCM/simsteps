// Construction de la scène 3D statique de l'entrepôt : sol, racks,
// zones colorées et étiquettes, éclairage et caméra orbitale.
// Les statiques sont regroupés dans un THREE.Group reconstructible
// (changement d'entrepôt, éditeur) ; chaque élément métier éditable
// (allée, atelier, zone) vit dans un sous-groupe porteur de userData.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { floorSize, rackBoxes, zonePatches, aisleLabels, gridSegments, corridorBands } from './layout.js';
import { makeTextSprite } from './labels.js';

// Palette de la scène (thème sombre)
const COLORS = {
  background: 0x14171c,
  floor: 0x1b2027,
  grid: 0x262c35,
  rack: 0x3a4250,
  rackEdge: 0x161a20,
  corridor: 0x8b95a3, // couloirs transversaux : gris de marquage au sol

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
 *            controls: OrbitControls, setDefinition: (def: object) => void,
 *            getPickables: () => THREE.Group[], dispose: () => void}}
 */
export function createWarehouseScene(canvas, definition) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, 90, 220);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // ne pas passer sous le sol
  controls.minDistance = 8;
  controls.maxDistance = 160;

  // Éclairage d'ambiance, indépendant de la définition
  scene.add(new THREE.HemisphereLight(0x8a9db8, 0x1a1d22, 0.75));

  let statics = null; // groupe des statiques dépendants de la définition
  let pickables = []; // sous-groupes éditables (allées, ateliers, zones)
  let corridorGroups = []; // couloirs : désignables au clic mais non éditables
  let labelEntries = []; // sprites de libellé : { sprite, type, id }
  let labelsVisible = true; // interrupteur global des libellés
  let revealed = null; // libellé révélé au clic quand les libellés sont masqués

  // Applique l'état de visibilité aux sprites (interrupteur + révélation)
  function applyLabelVisibility() {
    for (const { sprite, type, id } of labelEntries) {
      sprite.visible = labelsVisible || (revealed?.type === type && revealed?.id === id);
    }
  }

  // Construit le groupe des statiques pour une définition donnée
  function buildStatics(def) {
    const { width, depth } = floorSize(def);
    const center = new THREE.Vector3(width / 2, 0, depth / 2);
    const group = new THREE.Group();
    pickables = [];
    corridorGroups = [];
    labelEntries = [];

    // --- Soleil : position et emprise d'ombre calées sur le sol ---
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
    group.add(sun, sun.target);

    // --- Sol et grille au mètre ---
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, 0, depth / 2);
    floor.receiveShadow = true;
    group.add(floor);

    // Grille rectangulaire au mètre, calée exactement sur le sol
    const gridPositions = [];
    for (const [x1, z1, x2, z2] of gridSegments(def)) {
      gridPositions.push(x1, 0, z1, x2, 0, z2);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
    const grid = new THREE.LineSegments(
      gridGeometry, new THREE.LineBasicMaterial({ color: COLORS.grid })
    );
    grid.position.y = 0.02;
    group.add(grid);

    // --- Couloirs transversaux : bandes translucides étiquetées,
    // désignables au clic (révélation de libellé) mais hors éditeur ---
    for (const band of corridorBands(def)) {
      const corridorGroup = new THREE.Group();
      corridorGroup.userData = { type: 'corridor', id: band.id };
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(band.width, band.depth),
        new THREE.MeshStandardMaterial({
          color: COLORS.corridor, transparent: true, opacity: 0.14, roughness: 1,
        })
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(band.x, 0.025, band.z);
      corridorGroup.add(strip);

      // Étiquettes posées là où rien ne se superpose dans la vue par
      // défaut : à droite des racks, plus à l'intérieur pour l'avant
      const label = makeTextSprite(band.label, { color: '#8b95a3', worldHeight: 1 });
      const labelX = band.id === 'front'
        ? Math.max(band.width - 8, band.width / 2)
        : Math.max(band.width - 4, band.width / 2);
      label.position.set(labelX, 0.7, band.z);
      corridorGroup.add(label);
      labelEntries.push({ sprite: label, type: 'corridor', id: band.id });
      group.add(corridorGroup);
      corridorGroups.push(corridorGroup);
    }

    // --- Allées : un sous-groupe par allée (racks + arêtes + étiquette) ---
    const rackMaterial = new THREE.MeshStandardMaterial({ color: COLORS.rack, roughness: 0.8 });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.rackEdge });
    const aisleGroups = new Map();
    for (const aisle of def.aisles) {
      const aisleGroup = new THREE.Group();
      aisleGroup.userData = { type: 'aisle', id: aisle.id };
      aisleGroups.set(aisle.id, aisleGroup);
      group.add(aisleGroup);
      pickables.push(aisleGroup);
    }
    const boxes = rackBoxes(def);
    def.racks.forEach((rack, i) => {
      const box = boxes[i];
      const aisleGroup = aisleGroups.get(rack.aisle);
      const geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
      const mesh = new THREE.Mesh(geometry, rackMaterial);
      mesh.position.set(box.x, box.height / 2, box.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      aisleGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
      edges.position.copy(mesh.position);
      aisleGroup.add(edges);
    });
    for (const aisle of aisleLabels(def)) {
      const label = makeTextSprite(aisle.id, { color: '#9aa3ad', worldHeight: 1.1 });
      label.position.set(aisle.x, 0.8, aisle.z);
      aisleGroups.get(aisle.id)?.add(label);
      labelEntries.push({ sprite: label, type: 'aisle', id: aisle.id });
    }

    // --- Zones : un sous-groupe par zone (patch coloré + étiquette) ---
    for (const zone of zonePatches(def)) {
      const zoneGroup = new THREE.Group();
      zoneGroup.userData = { type: zone.kind, id: zone.id };
      const color = COLORS.zones[zone.kind];
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(zone.width, zone.depth),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.32, roughness: 1 })
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(zone.x, 0.03, zone.z);
      zoneGroup.add(patch);

      const label = makeTextSprite(zone.label, {
        color: `#${color.toString(16).padStart(6, '0')}`,
        worldHeight: 1.3,
      });
      label.position.set(zone.x, 2.4, zone.z);
      zoneGroup.add(label);
      group.add(zoneGroup);
      pickables.push(zoneGroup);
      labelEntries.push({ sprite: label, type: zone.kind, id: zone.id });
    }

    return group;
  }

  // Libère géométries, matériaux, textures et shadow maps d'un groupe
  function disposeStatics(group) {
    group.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        object.material.map?.dispose();
        object.material.dispose();
      }
      object.shadow?.map?.dispose();
    });
  }

  // Reconstruit les statiques ; recadre la caméra sur le nouveau plan
  // sauf demande contraire (édition : l'orientation choisie est conservée)
  function setDefinition(def, { recenter = true } = {}) {
    if (statics) {
      scene.remove(statics);
      disposeStatics(statics);
    }
    statics = buildStatics(def);
    scene.add(statics);
    applyLabelVisibility();
    if (!recenter) return;
    // Recul et hauteur proportionnels au sol : le terrain entier tient
    // dans le champ, y compris le bord proche pour les grandes profondeurs
    const { width, depth } = floorSize(def);
    const span = Math.max(width, depth);
    camera.position.set(width / 2 + span * 0.5, span * 1.05, depth / 2 + span * 0.95);
    controls.target.set(width / 2, 0, depth / 2);
  }

  setDefinition(definition);

  function dispose() {
    controls.dispose();
    renderer.dispose();
  }

  // Sélection au clic hors édition : sous-groupe éditable sous le pointeur
  const pickRaycaster = new THREE.Raycaster();
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    pickRaycaster.setFromCamera(pointer, camera);
    // Les couloirs sont désignables ici (libellés) mais restent hors
    // des pickables de l'éditeur (non déplaçables)
    for (const { object } of pickRaycaster.intersectObjects([...pickables, ...corridorGroups], true)) {
      let node = object;
      while (node && !node.userData?.type) node = node.parent;
      if (node) return { ...node.userData };
    }
    return null;
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    setDefinition,
    getPickables: () => pickables,
    // Libellés : interrupteur global et révélation d'un seul au clic
    setLabelsVisible(value) {
      labelsVisible = value;
      if (value) revealed = null;
      applyLabelVisibility();
    },
    revealLabel(sel) {
      revealed = sel;
      applyLabelVisibility();
    },
    labelStats: () => ({
      total: labelEntries.length,
      visible: labelEntries.filter((e) => e.sprite.visible).length,
    }),
    pick,
    dispose,
  };
}
