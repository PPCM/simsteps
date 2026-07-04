// Calculs de géométrie 3D à partir d'une définition d'entrepôt (format
// warehouse.json). Module pur, sans DOM ni Three.js : testable sous Node.
// Convention : les coordonnées (x, y) du plan de l'entrepôt deviennent
// (x, z) dans la scène 3D, la hauteur est portée par l'axe Y.

const RACK_WIDTH = 1.4;
const RACK_MARGIN = 0.9; // dépassement au-delà des baies en bout d'allée
// Largeur par défaut du couloir d'une allée (entre ses deux racks) et
// dimensions par défaut des zones au sol — surchargables par élément
export const DEFAULT_AISLE_WIDTH = 1.4;
export const DEFAULT_ZONE_SIZE = { width: 4.8, depth: 3 };

// Zones d'expédition/réception : objet unique (format historique) ou liste
const asList = (value) => (Array.isArray(value) ? value : [value]);

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
    // Racks de part et d'autre du couloir de circulation de l'allée
    const half = (aisle.width ?? DEFAULT_AISLE_WIDTH) / 2;
    const offsets = { gauche: -half - RACK_WIDTH, droite: half };
    const offset = offsets[rack.side];
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
    width: f.width ?? DEFAULT_ZONE_SIZE.width,
    depth: f.depth ?? DEFAULT_ZONE_SIZE.depth,
  });
  return [
    ...def.workshops.map((w) => patch(w, 'workshop')),
    ...asList(def.shipping).map((s) => patch(s, 'shipping')),
    ...asList(def.receiving).map((r) => patch(r, 'receiving')),
  ];
}

/**
 * Bandes des couloirs transversaux (avant/arrière) : les allées
 * débouchent dessus et les opérateurs y circulent ; les matérialiser
 * au sol rend visible la borne de déplacement des allées.
 * @returns {Array<{id: 'front'|'back', label: string, x: number, z: number, width: number, depth: number}>}
 */
export function corridorBands(def) {
  const { width } = def.dimensions;
  const band = (id, label, y) => ({ id, label, x: width / 2, z: y, width, depth: DEFAULT_AISLE_WIDTH });
  return [
    band('front', 'Couloir avant', def.corridors.frontY),
    band('back', 'Couloir arrière', def.corridors.backY),
  ];
}

/**
 * Segments de la grille au mètre, couvrant exactement le sol (et rien
 * que lui : une grille carrée déborderait d'un sol rectangulaire et
 * ferait croire que les deux dimensions changent ensemble).
 * @returns {Array<[number, number, number, number]>} segments [x1, z1, x2, z2]
 */
export function gridSegments(def) {
  const { width, depth } = def.dimensions;
  const lines = [];
  for (let x = 0; x <= width; x++) lines.push([x, 0, x, depth]);
  if (!Number.isInteger(width)) lines.push([width, 0, width, depth]);
  for (let z = 0; z <= depth; z++) lines.push([0, z, width, z]);
  if (!Number.isInteger(depth)) lines.push([0, depth, width, depth]);
  return lines;
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
