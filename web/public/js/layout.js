// Calculs de géométrie 3D à partir d'une définition d'entrepôt (format
// warehouse.json). Module pur, sans DOM ni Three.js : testable sous Node.
// Convention : les coordonnées (x, y) du plan de l'entrepôt deviennent
// (x, z) dans la scène 3D, la hauteur est portée par l'axe Y.

// Décalages latéraux des racks par rapport à l'axe de l'allée (mètres),
// identiques à la projection utilisée par le moteur
const RACK_OFFSETS = { gauche: -2.1, droite: 0.7 };
const RACK_WIDTH = 1.4;
const RACK_MARGIN = 0.9; // dépassement au-delà des baies en bout d'allée

/** Dimensions du sol. */
export function floorSize(def) {
  return { width: def.dimensions.width, depth: def.dimensions.depth };
}

/**
 * Volumes des racks : un pavé par rack, positionné le long de son allée.
 * @returns {Array<{id: string, x: number, z: number, width: number, depth: number, height: number}>}
 *          x/z : centre du pavé au sol
 */
export function rackBoxes(def) {
  const aisleById = new Map(def.aisles.map((a) => [a.id, a]));
  return def.racks.map((rack) => {
    const aisle = aisleById.get(rack.aisle);
    if (!aisle) throw new Error(`Rack ${rack.id} : allée inconnue ${rack.aisle}`);
    const offset = RACK_OFFSETS[rack.side];
    if (offset === undefined) throw new Error(`Rack ${rack.id} : côté inconnu ${rack.side}`);
    const depth = aisle.yEnd - aisle.yStart + 2 * RACK_MARGIN;
    return {
      id: rack.id,
      x: aisle.x + offset + RACK_WIDTH / 2,
      z: (aisle.yStart + aisle.yEnd) / 2,
      width: RACK_WIDTH,
      depth,
      height: Math.max(2.4, 1 + rack.levels * 1.2),
    };
  });
}

/**
 * Zones colorées au sol : ateliers, expédition, réception.
 * @returns {Array<{id: string, label: string, kind: 'workshop'|'shipping'|'receiving',
 *                  x: number, z: number, width: number, depth: number}>}
 */
export function zonePatches(def) {
  const patch = (f, kind) => ({
    id: f.id,
    label: f.label ?? f.id,
    kind,
    x: f.x,
    z: f.y,
    width: 4.8,
    depth: 3,
  });
  return [
    ...def.workshops.map((w) => patch(w, 'workshop')),
    patch(def.shipping, 'shipping'),
    patch(def.receiving, 'receiving'),
  ];
}

/**
 * Étiquettes des allées, placées en tête d'allée.
 * @returns {Array<{id: string, x: number, z: number}>}
 */
export function aisleLabels(def) {
  return def.aisles.map((a) => ({ id: a.id, x: a.x, z: a.yStart - 1.6 }));
}

/** Nombre total d'emplacements picking décrits par la définition. */
export function slotCount(def) {
  const aisleById = new Map(def.aisles.map((a) => [a.id, a]));
  return def.racks.reduce((sum, rack) => {
    const aisle = aisleById.get(rack.aisle);
    if (!aisle) throw new Error(`Rack ${rack.id} : allée inconnue ${rack.aisle}`);
    return sum + aisle.bays * rack.levels;
  }, 0);
}
