// Interactions de l'éditeur 3D : sélection au clic (raycast sur les
// sous-groupes éditables de la scène), glisser-déposer sur le plan du
// sol et surbrillance de la sélection. Coexiste avec OrbitControls :
// le pointerdown est intercepté en phase de capture et OrbitControls
// est désactivé le temps du drag ; un clic dans le vide orbite.

import * as THREE from 'three';

const HIGHLIGHT = new THREE.Color(0xffb14e);
const DRAG_EPSILON = 0.5; // en-deçà, le relâchement est un simple clic

/**
 * @param {{canvas: HTMLCanvasElement, camera: THREE.Camera,
 *          orbit: import('three/addons/controls/OrbitControls.js').OrbitControls,
 *          getPickables: () => THREE.Group[],
 *          onSelect: (sel: {type: string, id: string}|null) => void,
 *          constrainDelta: (type: string, id: string, delta: {dx: number, dz: number}) => {dx: number, dz: number},
 *          onMoved: (type: string, id: string, delta: {dx: number, dz: number}) => void,
 *          onHover?: (point: {x: number, z: number}|null) => void}} options
 *        onHover : point du sol sous le pointeur (throttlé), null hors sol
 * @returns {{setEnabled: (v: boolean) => void,
 *            setSelection: (sel: {type: string, id: string}|null) => void,
 *            dispose: () => void}}
 */
export function createEditorControls({ canvas, camera, orbit, getPickables, onSelect, constrainDelta, onMoved, onHover }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  let enabled = false;
  let selected = null; // sous-groupe surligné
  let savedMaterials = []; // [objet, matériau d'origine] pour restauration
  let drag = null; // { group, type, id, start: Vector3, delta }
  let lastHover = 0;

  function setRayFrom(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  // Remonte du mesh touché au sous-groupe porteur de userData.type
  function pickAt(event) {
    setRayFrom(event);
    const intersections = raycaster.intersectObjects(getPickables(), true);
    for (const { object } of intersections) {
      let node = object;
      while (node && !node.userData?.type) node = node.parent;
      if (node) return node;
    }
    return null;
  }

  function clearHighlight() {
    for (const [object, material] of savedMaterials) {
      // Ne pas disposer la texture : le clone la partage avec l'original
      object.material.dispose();
      object.material = material;
    }
    savedMaterials = [];
    selected = null;
  }

  // Clone les matériaux du groupe pour surligner sans toucher aux
  // matériaux partagés (tous les racks partagent le même)
  function highlight(group) {
    clearHighlight();
    selected = group;
    group.traverse((object) => {
      if (!object.material || !object.material.clone) return;
      savedMaterials.push([object, object.material]);
      const clone = object.material.clone();
      if (clone.emissive) {
        clone.emissive.copy(HIGHLIGHT);
        clone.emissiveIntensity = 0.35;
      } else if (clone.color) {
        clone.color.lerp(HIGHLIGHT, 0.5);
      }
      object.material = clone;
    });
  }

  function select(group) {
    if (group === selected) return;
    clearHighlight();
    if (group) highlight(group);
    onSelect(group ? { ...group.userData } : null);
  }

  function onPointerDown(event) {
    if (!enabled || event.button !== 0) return;
    const group = pickAt(event);
    if (!group) {
      select(null);
      return; // OrbitControls orbite normalement
    }
    // Bloque OrbitControls avant que son handler (phase bouillonnement)
    // ne s'exécute
    orbit.enabled = false;
    select(group);
    if (raycaster.ray.intersectPlane(floorPlane, hit)) {
      drag = {
        group,
        type: group.userData.type,
        id: group.userData.id,
        start: hit.clone(),
        delta: { dx: 0, dz: 0 },
      };
      // La capture peut être indisponible (pointeur synthétique) : le
      // drag fonctionne quand même tant que le pointeur reste sur la page
      try { canvas.setPointerCapture(event.pointerId); } catch { /* ignoré */ }
    }
  }

  function onPointerMove(event) {
    if (!enabled) return;
    if (drag) {
      setRayFrom(event);
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;
      drag.delta = { dx: hit.x - drag.start.x, dz: hit.z - drag.start.z };
      // Aperçu contraint : même accrochage/bornes que le commit
      const { dx, dz } = constrainDelta(drag.type, drag.id, drag.delta);
      drag.group.position.set(dx, 0, dz);
      onHover?.({ x: hit.x, z: hit.z });
      return;
    }
    // Curseur de déplacement au survol d'un élément (raycast throttlé)
    const now = performance.now();
    if (now - lastHover < 80) return;
    lastHover = now;
    canvas.style.cursor = pickAt(event) ? 'move' : '';
    // Coordonnées du pointeur sur le plan du sol (le rayon est déjà posé)
    onHover?.(raycaster.ray.intersectPlane(floorPlane, hit) ? { x: hit.x, z: hit.z } : null);
  }

  function onPointerUp(event) {
    orbit.enabled = true;
    if (!drag) return;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const { type, id, delta } = drag;
    const moved = Math.hypot(delta.dx, delta.dz) > DRAG_EPSILON;
    drag = null;
    if (moved) onMoved(type, id, delta);
  }

  // Phase de capture : s'exécute avant les listeners d'OrbitControls
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  return {
    setEnabled(value) {
      enabled = value;
      if (!value) {
        clearHighlight();
        drag = null;
        orbit.enabled = true;
        canvas.style.cursor = '';
      }
    },
    // Resélectionne un élément après reconstruction de la scène
    setSelection(sel) {
      clearHighlight();
      if (!sel) return;
      const group = getPickables().find(
        (g) => g.userData.type === sel.type && g.userData.id === sel.id
      );
      if (group) highlight(group);
    },
    dispose() {
      clearHighlight();
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    },
  };
}
