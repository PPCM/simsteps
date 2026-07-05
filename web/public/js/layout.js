// Calculs de géométrie 3D à partir d'une définition d'entrepôt (format
// warehouse.json). Module pur, sans DOM ni Three.js : testable sous Node.
// Convention : les coordonnées (x, y) du plan de l'entrepôt deviennent
// (x, z) dans la scène 3D, la hauteur est portée par l'axe Y.

const RACK_MARGIN = 0.9; // dépassement au-delà des baies en bout d'allée
// Défauts des racks (surchargables par rack) : profondeur (extension
// perpendiculaire à l'allée) et hauteur d'un niveau de stockage
export const DEFAULT_RACK_DEPTH = 1.4;
export const DEFAULT_LEVEL_HEIGHT = 2.0;
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
 * La hauteur vaut niveaux × hauteur de niveau ; la profondeur du rack
 * (extension perpendiculaire à l'allée) est propre à chaque rack.
 * @returns {Array<{id: string, x: number, z: number, width: number, depth: number,
 *                  height: number, levels: number, levelHeight: number}>}
 *          x/z : centre du pavé au sol
 */
export function rackBoxes(def) {
  const aisleById = new Map(def.aisles.map((a) => [a.id, a]));
  return def.racks.map((rack) => {
    const aisle = aisleById.get(rack.aisle);
    if (!aisle) throw new Error(`Rack ${rack.id} : allée inconnue ${rack.aisle}`);
    // Racks de part et d'autre du couloir de circulation de l'allée
    const half = (aisle.width ?? DEFAULT_AISLE_WIDTH) / 2;
    const rackDepth = rack.depth ?? DEFAULT_RACK_DEPTH;
    const levelHeight = rack.levelHeight ?? DEFAULT_LEVEL_HEIGHT;
    const offsets = { gauche: -half - rackDepth, droite: half };
    const offset = offsets[rack.side];
    if (offset === undefined) throw new Error(`Rack ${rack.id} : côté inconnu ${rack.side}`);
    const depth = aisle.yEnd - aisle.yStart + 2 * RACK_MARGIN;
    return {
      id: rack.id,
      x: aisle.x + offset + rackDepth / 2,
      z: (aisle.yStart + aisle.yEnd) / 2,
      width: rackDepth,
      depth,
      height: rack.levels * levelHeight,
      levels: rack.levels,
      levelHeight,
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

// Couloirs : objet historique { frontY, backY } (deux couloirs pleine
// largeur) ou liste de segments — même conversion que sim/warehouse.js
function corridorsOf(def) {
  const corridors = def.corridors;
  if (Array.isArray(corridors)) return corridors;
  return [
    { id: 'C1', label: 'Couloir avant', x: 0, y: corridors.frontY, length: def.dimensions.width, width: 1.4, orientation: 'horizontal' },
    { id: 'C2', label: 'Couloir arrière', x: 0, y: corridors.backY, length: def.dimensions.width, width: 1.4, orientation: 'horizontal' },
  ];
}

/**
 * Bandes des couloirs : les allées y débouchent, les opérateurs y
 * circulent et elles se connectent entre elles à leurs croisements.
 * @returns {Array<{id: string, label: string, x: number, z: number, width: number, depth: number}>}
 *          x/z : centre de la bande au sol
 */
export function corridorBands(def) {
  return corridorsOf(def).map((c) => {
    const lane = c.width ?? DEFAULT_AISLE_WIDTH;
    const horizontal = c.orientation !== 'vertical';
    return {
      id: c.id,
      label: c.label ?? c.id,
      x: horizontal ? c.x + c.length / 2 : c.x,
      z: horizontal ? c.y : c.y + c.length / 2,
      width: horizontal ? c.length : lane,
      depth: horizontal ? lane : c.length,
    };
  });
}

/**
 * Points de jonction du réseau de couloirs : croisements entre segments
 * horizontaux et verticaux, et extrémités coïncidentes de deux
 * couloirs — là où la circulation se connecte.
 * @returns {Array<{x: number, z: number}>} points dédupliqués
 */
export function corridorJunctions(def) {
  const eps = 1e-6;
  const corridors = corridorsOf(def);
  const points = new Map();
  const add = (x, y) => points.set(`${Math.round(x * 1000)},${Math.round(y * 1000)}`, { x, z: y });

  const horizontals = corridors.filter((c) => c.orientation !== 'vertical');
  const verticals = corridors.filter((c) => c.orientation === 'vertical');
  for (const h of horizontals) {
    for (const v of verticals) {
      const crosses = v.x >= h.x - eps && v.x <= h.x + h.length + eps
        && h.y >= v.y - eps && h.y <= v.y + v.length + eps;
      if (crosses) add(v.x, h.y);
    }
  }

  // Extrémités coïncidentes (prolongement ou coin entre deux couloirs)
  const ends = (c) => (c.orientation !== 'vertical'
    ? [[c.x, c.y], [c.x + c.length, c.y]]
    : [[c.x, c.y], [c.x, c.y + c.length]]);
  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      for (const [x1, y1] of ends(corridors[i])) {
        for (const [x2, y2] of ends(corridors[j])) {
          if (Math.abs(x1 - x2) < eps && Math.abs(y1 - y2) < eps) add(x1, y1);
        }
      }
    }
  }
  return [...points.values()];
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
