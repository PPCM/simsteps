// Modèle pur de l'éditeur d'entrepôt : opérations sur une définition
// (déplacement contraint, ajout/suppression, propriétés, validation).
// Chaque opération clone la définition et retourne le clone : la
// définition d'origine n'est jamais mutée. Module sans DOM ni Three.js.

// Dimensions par défaut, identiques à layout.js : profondeur et hauteur
// de niveau des racks, largeur du couloir d'une allée (entre ses deux
// racks) et emprise des zones au sol
const DEFAULT_RACK_DEPTH = 1.4;
const DEFAULT_LEVEL_HEIGHT = 2.0;
const DEFAULT_AISLE_WIDTH = 1.4;
const DEFAULT_ZONE_WIDTH = 4.8;
const DEFAULT_ZONE_DEPTH = 3;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
// Zones d'expédition/réception : objet unique (format historique) ou liste
const asList = (value) => (Array.isArray(value) ? value : [value]);
// Couloirs : objet historique { frontY, backY } converti en deux
// couloirs transversaux pleine largeur — même règle que sim/warehouse.js
function corridorsAsList(def) {
  const corridors = def.corridors;
  if (Array.isArray(corridors)) return corridors;
  return [
    { id: 'C1', label: 'Couloir avant', x: 0, y: corridors.frontY, length: def.dimensions.width, width: DEFAULT_AISLE_WIDTH, orientation: 'horizontal' },
    { id: 'C2', label: 'Couloir arrière', x: 0, y: corridors.backY, length: def.dimensions.width, width: DEFAULT_AISLE_WIDTH, orientation: 'horizontal' },
  ];
}
// Demi-emprise latérale d'une allée (couloir + le rack le plus profond
// de chaque côté), arrondie au millimètre pour des bornes sans bruit
function aisleHalfWidth(def, aisle) {
  const depths = def.racks
    .filter((r) => r.aisle === aisle?.id)
    .map((r) => r.depth ?? DEFAULT_RACK_DEPTH);
  const deepest = depths.length > 0 ? Math.max(...depths) : DEFAULT_RACK_DEPTH;
  return Math.round(((aisle?.width ?? DEFAULT_AISLE_WIDTH) + 2 * deepest) * 500) / 1000;
}
const zoneHalfWidth = (f) => (f?.width ?? DEFAULT_ZONE_WIDTH) / 2;
const zoneHalfDepth = (f) => (f?.depth ?? DEFAULT_ZONE_DEPTH) / 2;

/**
 * Normalise une définition pour l'édition : expédition/réception en
 * listes et dimensions par défaut rendues explicites (largeur d'allée,
 * emprise des zones). Le clone retourné devient le nouveau format
 * enregistré ; l'ancien format (objets uniques, tailles implicites)
 * reste accepté partout en lecture.
 * @returns {object} nouvelle définition
 */
export function normalizeDefinition(def) {
  const next = structuredClone(def);
  next.aisles = next.aisles.map((a) => ({ width: DEFAULT_AISLE_WIDTH, ...a }));
  next.racks = next.racks.map((r) => ({
    depth: DEFAULT_RACK_DEPTH, levelHeight: DEFAULT_LEVEL_HEIGHT, ...r,
  }));
  const zone = (z) => ({ width: DEFAULT_ZONE_WIDTH, depth: DEFAULT_ZONE_DEPTH, ...z });
  next.workshops = next.workshops.map(zone);
  next.shipping = asList(next.shipping).map(zone);
  next.receiving = asList(next.receiving).map(zone);
  next.parkings = (next.parkings ?? []).map(zone);
  next.buffers = (next.buffers ?? []).map(zone);
  next.corridors = corridorsAsList(next).map((c) => ({
    width: DEFAULT_AISLE_WIDTH, orientation: 'horizontal', label: c.id, ...c,
  }));
  return next;
}

/** Accroche une coordonnée à la grille au mètre. */
export function snapToGrid(v) {
  return Math.round(v);
}

/**
 * Accroche un centre pour que le bord (centre − demi-emprise) tombe sur
 * une ligne de la grille : un élément de dimension entière remplit
 * alors des carreaux entiers. Le pas reste de 1 m.
 */
export function snapEdge(center, half) {
  return Math.round(center - half) + half;
}

// Arrondi au millimètre : élimine le bruit flottant des conversions
const mm = (v) => Math.round(v * 1000) / 1000;

// Types d'engins connus — synchronisé avec sim/vehicles.js (ce module
// pur ne peut pas importer /sim/ depuis les tests Node)
const VEHICLE_TYPES = ['pieton', 'transpalette', 'gerbeur', 'frontal', 'retractable', 'vna', 'preparateur'];

/**
 * Valeur affichée dans le panneau pour un champ : les coordonnées des
 * zones sont exprimées en bords (gauche/avant), entiers après
 * accrochage, alors que le modèle stocke les centres. Les allées
 * affichent directement leur étendue de baies (entière).
 */
export function displayValue(kind, element, key) {
  if (['workshop', 'shipping', 'receiving', 'parking', 'buffer'].includes(kind)) {
    if (key === 'x') return mm(element.x - zoneHalfWidth(element));
    if (key === 'y') return mm(element.y - zoneHalfDepth(element));
  }
  if (kind === 'corridor') {
    if (key === 'oneWay') return element.oneWay ?? 'non';
    if (key === 'access') return element.access ?? 'mixte';
  }
  return element[key];
}

/**
 * Conversion inverse de displayValue : valeur de modèle correspondant
 * à une saisie du panneau (bord → centre pour les zones).
 */
export function modelValue(kind, element, key, value) {
  if (['workshop', 'shipping', 'receiving', 'parking', 'buffer'].includes(kind)) {
    if (key === 'x') return mm(value + zoneHalfWidth(element));
    if (key === 'y') return mm(value + zoneHalfDepth(element));
  }
  return value;
}

/** Borne l'axe x d'une allée pour que ses racks restent dans le sol. */
export function clampAisleX(def, x, aisle) {
  const half = aisleHalfWidth(def, aisle);
  return clamp(x, half, def.dimensions.width - half);
}

/**
 * Borne le départ d'une allée dans le sol, longueur conservée. Le
 * raccordement aux couloirs n'est plus une borne de drag : c'est la
 * validation de connexité du réseau qui le contrôle.
 */
export function clampAisleY(def, yStart, length) {
  const min = 1;
  const max = def.dimensions.depth - 1 - length;
  return clamp(yStart, min, Math.max(min, max));
}

/**
 * Déplace une allée (axe x et/ou départ y), avec accrochage à la grille
 * et bornes ; la longueur de l'allée est conservée.
 * @returns {object} nouvelle définition
 */
export function moveAisle(def, aisleId, { x, yStart }) {
  const next = structuredClone(def);
  const aisle = next.aisles.find((a) => a.id === aisleId);
  if (!aisle) throw new Error(`Allée inconnue : ${aisleId}`);
  const length = aisle.yEnd - aisle.yStart;
  // En x, flanc extérieur du rack gauche aligné sur la grille ; en y,
  // début de baies au mètre entier (les champs Début/Fin restent entiers)
  if (x !== undefined) aisle.x = clampAisleX(next, snapEdge(x, aisleHalfWidth(next, aisle)), aisle);
  if (yStart !== undefined) {
    aisle.yStart = clampAisleY(next, snapToGrid(yStart), length);
    aisle.yEnd = aisle.yStart + length;
  }
  return next;
}

// Retrouve l'objet d'une installation (atelier ou zone) dans une définition
function facilityOf(def, kind, id) {
  if (kind === 'workshop') {
    const workshop = def.workshops.find((w) => w.id === id);
    if (!workshop) throw new Error(`Atelier inconnu : ${id}`);
    return workshop;
  }
  if (kind === 'shipping' || kind === 'receiving') {
    const zone = asList(def[kind]).find((z) => z.id === id);
    if (!zone) throw new Error(`Zone inconnue : ${id}`);
    return zone;
  }
  if (kind === 'parking') {
    const parking = (def.parkings ?? []).find((p) => p.id === id);
    if (!parking) throw new Error(`Parking inconnu : ${id}`);
    return parking;
  }
  if (kind === 'buffer') {
    const buffer = (def.buffers ?? []).find((b) => b.id === id);
    if (!buffer) throw new Error(`Tampon inconnu : ${id}`);
    return buffer;
  }
  throw new Error(`Type d'élément inconnu : ${kind}`);
}

/**
 * Déplace un atelier ou une zone (expédition/réception), avec accrochage
 * à la grille et bornes dans le sol.
 * @returns {object} nouvelle définition
 */
export function moveFacility(def, kind, id, { x, y }) {
  const next = structuredClone(def);
  const facility = facilityOf(next, kind, id);
  const hw = zoneHalfWidth(facility);
  const hd = zoneHalfDepth(facility);
  // Bords gauche/avant alignés sur la grille
  if (x !== undefined) {
    facility.x = clamp(snapEdge(x, hw), hw, next.dimensions.width - hw);
  }
  if (y !== undefined) {
    facility.y = clamp(snapEdge(y, hd), hd, next.dimensions.depth - hd);
  }
  return next;
}

// Retrouve un couloir dans une définition (couloirs normalisés en liste)
function corridorOf(def, id) {
  const corridor = corridorsAsList(def).find((c) => c.id === id);
  if (!corridor) throw new Error(`Couloir inconnu : ${id}`);
  return corridor;
}

// Portée du magnétisme des extrémités de couloir (mètres)
const MAGNET_RANGE = 1.5;
const EPS = 1e-6;

// Magnétisme : décalage le long de l'axe du couloir déplacé qui amène
// son extrémité la plus proche sur l'axe d'un couloir perpendiculaire
// (jonction en T), si l'écart est dans la portée. 0 sinon.
function magnetShift(corridors, moved) {
  const horizontal = moved.orientation !== 'vertical';
  const start = horizontal ? moved.x : moved.y;
  const end = start + moved.length;
  const across = horizontal ? moved.y : moved.x;
  let best = 0;
  for (const other of corridors) {
    if (other.id === moved.id) continue;
    const otherHorizontal = other.orientation !== 'vertical';
    if (otherHorizontal === horizontal) continue; // perpendiculaires seulement
    // La jonction doit toucher l'autre couloir sur son étendue
    const spanFrom = otherHorizontal ? other.x : other.y;
    if (across < spanFrom - EPS || across > spanFrom + other.length + EPS) continue;
    const axis = otherHorizontal ? other.y : other.x;
    let gap;
    if (axis > end + EPS) gap = axis - end;
    else if (axis < start - EPS) gap = axis - start;
    else continue; // déjà en croisement ou en contact
    if (Math.abs(gap) <= MAGNET_RANGE && (best === 0 || Math.abs(gap) < Math.abs(best))) {
      best = gap;
    }
  }
  return best;
}

/**
 * Déplace un couloir (les deux axes) : accrochage au mètre de son axe,
 * segment borné dans le sol. Le raccordement au reste du réseau est
 * contrôlé par la validation de connexité, pas par le drag.
 * @returns {object} nouvelle définition
 */
export function moveCorridor(def, corridorId, { x, y }) {
  const next = structuredClone(def);
  next.corridors = corridorsAsList(next);
  const corridor = corridorOf(next, corridorId);
  const lane = (corridor.width ?? DEFAULT_AISLE_WIDTH) / 2;
  const horizontal = corridor.orientation !== 'vertical';
  const { width, depth } = next.dimensions;
  if (x !== undefined) {
    corridor.x = horizontal
      ? clamp(snapToGrid(x), 0, Math.max(0, width - corridor.length))
      : clamp(snapToGrid(x), lane, width - lane);
  }
  if (y !== undefined) {
    corridor.y = horizontal
      ? clamp(snapToGrid(y), lane, depth - lane)
      : clamp(snapToGrid(y), 0, Math.max(0, depth - corridor.length));
  }
  // Magnétisme : ferme les petits écarts vers un couloir perpendiculaire
  const shift = magnetShift(next.corridors, corridor);
  if (shift !== 0) {
    if (horizontal) corridor.x = clamp(corridor.x + shift, 0, Math.max(0, width - corridor.length));
    else corridor.y = clamp(corridor.y + shift, 0, Math.max(0, depth - corridor.length));
  }
  return next;
}

/**
 * Ajoute un couloir horizontal au centre du sol.
 * @returns {object} nouvelle définition
 */
export function addCorridor(def) {
  const next = structuredClone(def);
  next.corridors = corridorsAsList(next);
  const id = nextId('C', next.corridors.map((c) => c.id));
  const length = Math.min(10, next.dimensions.width);
  next.corridors.push({
    id,
    label: `Couloir ${id.slice(1)}`,
    x: snapToGrid((next.dimensions.width - length) / 2),
    y: snapToGrid(next.dimensions.depth / 2),
    length,
    width: DEFAULT_AISLE_WIDTH,
    orientation: 'horizontal',
  });
  return next;
}

/**
 * Supprime un couloir. Refuse de supprimer le dernier (le réseau de
 * circulation exige au moins un couloir).
 * @returns {object} nouvelle définition
 */
export function removeCorridor(def, corridorId) {
  const list = corridorsAsList(def);
  if (!list.some((c) => c.id === corridorId)) throw new Error(`Couloir inconnu : ${corridorId}`);
  if (list.length <= 1) throw new Error('Impossible de supprimer le dernier couloir');
  const next = structuredClone(def);
  next.corridors = corridorsAsList(next).filter((c) => c.id !== corridorId);
  return next;
}

/**
 * Met à jour les propriétés d'un couloir (id, label, x, y, length,
 * width, orientation). Une bascule d'orientation pivote le segment
 * autour de son centre ; tout changement de géométrie (orientation,
 * longueur, largeur) re-borne le segment dans le sol.
 * @returns {object} nouvelle définition
 */
export function updateCorridor(def, corridorId, props) {
  const next = structuredClone(def);
  next.corridors = corridorsAsList(next);
  const corridor = corridorOf(next, corridorId);
  const wasHorizontal = corridor.orientation !== 'vertical';
  for (const key of ['id', 'label', 'x', 'y', 'length', 'width', 'orientation', 'access']) {
    if (props[key] !== undefined) corridor[key] = props[key];
  }
  // Sens unique : « non » (défaut) signifie l'absence du champ
  if ('oneWay' in props) {
    if (props.oneWay === undefined || props.oneWay === 'non') delete corridor.oneWay;
    else corridor.oneWay = props.oneWay;
  }
  if (corridor.access === 'mixte') delete corridor.access;
  const horizontal = corridor.orientation !== 'vertical';
  if (horizontal !== wasHorizontal) {
    // Pivot autour du centre du segment
    const half = corridor.length / 2;
    if (horizontal) {
      corridor.x = mm(corridor.x - half);
      corridor.y = mm(corridor.y + half);
    } else {
      corridor.x = mm(corridor.x + half);
      corridor.y = mm(corridor.y - half);
    }
  }
  if (props.orientation !== undefined || props.length !== undefined || props.width !== undefined) {
    const lane = (corridor.width ?? DEFAULT_AISLE_WIDTH) / 2;
    const { width, depth } = next.dimensions;
    if (horizontal) {
      corridor.x = clamp(corridor.x, 0, Math.max(0, width - corridor.length));
      corridor.y = clamp(corridor.y, lane, depth - lane);
    } else {
      corridor.x = clamp(corridor.x, lane, width - lane);
      corridor.y = clamp(corridor.y, 0, Math.max(0, depth - corridor.length));
    }
  }
  return next;
}

// Premier identifiant libre de la forme <préfixe><n> (n ≥ 1)
function nextId(prefix, existing, pad = 0) {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `${prefix}${String(n).padStart(pad, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Ajoute une allée à droite de la dernière (propriétés copiées), avec
 * ses deux racks gauche/droite.
 * @returns {object} nouvelle définition
 */
export function addAisle(def) {
  const next = structuredClone(def);
  const last = next.aisles[next.aisles.length - 1];
  const id = nextId('A', next.aisles.map((a) => a.id));
  const aisle = last
    ? { id, x: clampAisleX(next, last.x + 5, last), yStart: last.yStart, yEnd: last.yEnd, bays: last.bays, zone: last.zone, width: last.width ?? DEFAULT_AISLE_WIDTH }
    : { id, x: clampAisleX(next, 5), yStart: 3, yEnd: Math.max(5, next.dimensions.depth - 3), bays: 5, zone: 'Z1', width: DEFAULT_AISLE_WIDTH };
  next.aisles.push(aisle);
  const rackIds = next.racks.map((r) => r.id);
  const lastRack = next.racks[next.racks.length - 1];
  const levels = lastRack?.levels ?? 1;
  const levelHeight = lastRack?.levelHeight ?? DEFAULT_LEVEL_HEIGHT;
  const rackDepth = lastRack?.depth ?? DEFAULT_RACK_DEPTH;
  for (const side of ['gauche', 'droite']) {
    const rackId = nextId('R', rackIds, 2);
    rackIds.push(rackId);
    next.racks.push({ id: rackId, aisle: id, side, levels, levelHeight, depth: rackDepth });
  }
  return next;
}

/**
 * Supprime une allée et ses racks. Refuse de supprimer la dernière allée.
 * @returns {object} nouvelle définition
 */
export function removeAisle(def, aisleId) {
  if (def.aisles.length <= 1) throw new Error('Impossible de supprimer la dernière allée');
  const next = structuredClone(def);
  if (!next.aisles.some((a) => a.id === aisleId)) throw new Error(`Allée inconnue : ${aisleId}`);
  next.aisles = next.aisles.filter((a) => a.id !== aisleId);
  next.racks = next.racks.filter((r) => r.aisle !== aisleId);
  return next;
}

/**
 * Ajoute un atelier près du couloir avant.
 * @returns {object} nouvelle définition
 */
export function addWorkshop(def) {
  const next = structuredClone(def);
  const id = nextId('AT', next.workshops.map((w) => w.id));
  const n = id.slice(2);
  const last = next.workshops[next.workshops.length - 1];
  const width = last?.width ?? DEFAULT_ZONE_WIDTH;
  const depth = last?.depth ?? DEFAULT_ZONE_DEPTH;
  const x = clamp(snapEdge((last?.x ?? 4) + 6, width / 2), width / 2, next.dimensions.width - width / 2);
  const y = clamp(
    snapEdge(last?.y ?? 2, depth / 2),
    depth / 2, next.dimensions.depth - depth / 2
  );
  next.workshops.push({ id, label: `Atelier ${n}`, x, y, width, depth });
  return next;
}

// Libellés français des types de zone (messages et libellés générés)
const ZONE_KINDS = {
  shipping: { prefix: 'EXP', label: 'Expédition' },
  receiving: { prefix: 'REC', label: 'Réception' },
};

// Ajoute une zone d'expédition ou de réception près de la dernière du même type
function addZone(def, kind) {
  const { prefix, label } = ZONE_KINDS[kind];
  const next = structuredClone(def);
  const list = asList(next[kind]);
  const last = list[list.length - 1];
  const id = nextId(prefix, list.map((z) => z.id));
  const width = last?.width ?? DEFAULT_ZONE_WIDTH;
  const depth = last?.depth ?? DEFAULT_ZONE_DEPTH;
  const x = clamp(snapEdge((last?.x ?? 4) + width + 2, width / 2), width / 2, next.dimensions.width - width / 2);
  const y = clamp(
    snapEdge(last?.y ?? 2, depth / 2),
    depth / 2, next.dimensions.depth - depth / 2
  );
  list.push({ id, label: `${label} ${id.slice(prefix.length)}`, x, y, width, depth });
  next[kind] = list;
  return next;
}

/**
 * Ajoute une zone d'expédition près de la dernière.
 * @returns {object} nouvelle définition
 */
export function addShipping(def) {
  return addZone(def, 'shipping');
}

/**
 * Ajoute une zone de réception près de la dernière.
 * @returns {object} nouvelle définition
 */
export function addReceiving(def) {
  return addZone(def, 'receiving');
}

/**
 * Ajoute un parking d'agents (stationnement/point d'appel) près du
 * dernier — les agents y démarrent et y retournent à l'inactivité.
 * @returns {object} nouvelle définition
 */
export function addParking(def) {
  const next = structuredClone(def);
  const list = next.parkings ?? [];
  const last = list[list.length - 1];
  const id = nextId('PK', list.map((p) => p.id));
  const width = last?.width ?? DEFAULT_ZONE_WIDTH;
  const depth = last?.depth ?? DEFAULT_ZONE_DEPTH;
  const x = clamp(snapEdge((last?.x ?? 4) + width + 2, width / 2), width / 2, next.dimensions.width - width / 2);
  const y = clamp(
    snapEdge(last?.y ?? next.dimensions.depth - 2, depth / 2),
    depth / 2, next.dimensions.depth - depth / 2
  );
  list.push({ id, label: `Parking ${id.slice(2)}`, x, y, width, depth });
  next.parkings = list;
  return next;
}

/**
 * Supprime un parking (les parkings sont optionnels : zéro autorisé —
 * les agents retombent alors sur l'expédition).
 * @returns {object} nouvelle définition
 */
export function removeParking(def, parkingId) {
  if (!(def.parkings ?? []).some((p) => p.id === parkingId)) {
    throw new Error(`Parking inconnu : ${parkingId}`);
  }
  const next = structuredClone(def);
  next.parkings = next.parkings.filter((p) => p.id !== parkingId);
  return next;
}

/**
 * Ajoute une zone tampon (dépose du picking avant emballage) près de
 * la dernière — active le rôle emballeur quand le scénario en compte.
 * @returns {object} nouvelle définition
 */
export function addBuffer(def) {
  const next = structuredClone(def);
  const list = next.buffers ?? [];
  const last = list[list.length - 1];
  const id = nextId('TP', list.map((b) => b.id));
  const width = last?.width ?? DEFAULT_ZONE_WIDTH;
  const depth = last?.depth ?? DEFAULT_ZONE_DEPTH;
  const x = clamp(snapEdge((last?.x ?? 10) + width + 2, width / 2), width / 2, next.dimensions.width - width / 2);
  const y = clamp(
    snapEdge(last?.y ?? 2, depth / 2),
    depth / 2, next.dimensions.depth - depth / 2
  );
  list.push({ id, label: `Tampon ${id.slice(2)}`, x, y, width, depth });
  next.buffers = list;
  return next;
}

/**
 * Supprime une zone tampon (optionnelle : zéro autorisé — la dépose
 * B2C retourne alors directement aux ateliers).
 * @returns {object} nouvelle définition
 */
export function removeBuffer(def, bufferId) {
  if (!(def.buffers ?? []).some((b) => b.id === bufferId)) {
    throw new Error(`Tampon inconnu : ${bufferId}`);
  }
  const next = structuredClone(def);
  next.buffers = next.buffers.filter((b) => b.id !== bufferId);
  return next;
}

/**
 * Supprime une zone d'expédition ou de réception. Refuse de supprimer
 * la dernière de son type (le moteur exige au moins une de chaque).
 * @returns {object} nouvelle définition
 */
export function removeZone(def, kind, zoneId) {
  const { label } = ZONE_KINDS[kind] ?? {};
  if (!label) throw new Error(`Type d'élément inconnu : ${kind}`);
  const list = asList(def[kind]);
  if (!list.some((z) => z.id === zoneId)) throw new Error(`Zone inconnue : ${zoneId}`);
  if (list.length <= 1) {
    throw new Error(`Impossible de supprimer la dernière zone ${kind === 'shipping' ? 'd’expédition' : 'de réception'}`);
  }
  const next = structuredClone(def);
  next[kind] = asList(next[kind]).filter((z) => z.id !== zoneId);
  return next;
}

/**
 * Supprime un atelier. Refuse de supprimer le dernier.
 * @returns {object} nouvelle définition
 */
export function removeWorkshop(def, workshopId) {
  if (def.workshops.length <= 1) throw new Error('Impossible de supprimer le dernier atelier');
  const next = structuredClone(def);
  if (!next.workshops.some((w) => w.id === workshopId)) throw new Error(`Atelier inconnu : ${workshopId}`);
  next.workshops = next.workshops.filter((w) => w.id !== workshopId);
  return next;
}

/**
 * Met à jour les propriétés d'une allée (id, zone, bays, yStart, yEnd,
 * width) et de ses racks (levels, levelHeight, rackDepth — appliqués
 * aux deux racks, dérivés de l'allée). Le renommage d'id est propagé
 * aux racks.
 * @returns {object} nouvelle définition
 */
export function updateAisle(def, aisleId, props) {
  const next = structuredClone(def);
  const aisle = next.aisles.find((a) => a.id === aisleId);
  if (!aisle) throw new Error(`Allée inconnue : ${aisleId}`);
  const { id, zone, bays, yStart, yEnd, width, levels, levelHeight, rackDepth } = props;
  for (const rack of next.racks) {
    if (rack.aisle !== aisle.id) continue;
    if (levels !== undefined) rack.levels = levels;
    if (levelHeight !== undefined) rack.levelHeight = levelHeight;
    if (rackDepth !== undefined) rack.depth = rackDepth;
  }
  if (id !== undefined && id !== aisle.id) {
    for (const rack of next.racks) {
      if (rack.aisle === aisle.id) rack.aisle = id;
    }
    aisle.id = id;
  }
  if (zone !== undefined) aisle.zone = zone;
  if (bays !== undefined) aisle.bays = bays;
  if (yStart !== undefined) aisle.yStart = yStart;
  if (yEnd !== undefined) aisle.yEnd = yEnd;
  if (width !== undefined) aisle.width = width;
  return next;
}

/**
 * Met à jour les propriétés d'un atelier ou d'une zone (id, label, x, y,
 * width, depth).
 * @returns {object} nouvelle définition
 */
export function updateFacility(def, kind, id, props) {
  const next = structuredClone(def);
  const facility = facilityOf(next, kind, id);
  for (const key of ['id', 'label', 'x', 'y', 'width', 'depth']) {
    if (props[key] !== undefined) facility[key] = props[key];
  }
  // Engins admis (parkings) : la clé peut être effacée (undefined = tous)
  if (kind === 'parking' && 'vehicles' in props) {
    if (props.vehicles === undefined) delete facility.vehicles;
    else facility.vehicles = props.vehicles;
  }
  return next;
}

/**
 * Met à jour les propriétés globales (name, description, dimensions —
 * height est la hauteur sous plafond, optionnelle, qui borne les racks).
 * Les couloirs sont des objets à part entière et se modifient via
 * moveCorridor / updateCorridor.
 * @returns {object} nouvelle définition
 */
export function updateGlobals(def, props) {
  const next = structuredClone(def);
  if (props.name !== undefined) next.name = props.name;
  if (props.description !== undefined) next.description = props.description;
  if (props.width !== undefined) next.dimensions.width = props.width;
  if (props.depth !== undefined) next.dimensions.depth = props.depth;
  if (props.height !== undefined) next.dimensions.height = props.height;
  return next;
}

// Vérifie l'unicité des identifiants d'une collection
function checkUnique(items, label, errors) {
  const seen = new Set();
  for (const id of items) {
    if (seen.has(id)) errors.push(`${label} en double : ${id}`);
    seen.add(id);
  }
}

/**
 * Valide une définition côté client : contraintes géométriques que le
 * serveur ne vérifie pas (bornes, couloirs, unicité des ids, bays ≥ 2),
 * puis tentative de construction du graphe.
 * @param {object} def
 * @param {(def: object) => unknown} buildWarehouse constructeur du graphe,
 *        injecté pour rester testable sous Node (le navigateur passe
 *        celui de /sim/warehouse.js)
 * @returns {string[]} messages d'erreur (vide = valide)
 */
export function validateDefinition(def, buildWarehouse) {
  const errors = [];
  const { width, depth } = def.dimensions ?? {};
  if (!(width > 0) || !(depth > 0)) {
    errors.push('les dimensions doivent être des nombres positifs');
    return errors;
  }
  const corridorsL = def.corridors ? corridorsAsList(def) : [];
  if (corridorsL.length === 0) errors.push('au moins un couloir est requis');
  checkUnique(corridorsL.map((c) => c.id), 'identifiant de couloir', errors);
  for (const c of corridorsL) {
    if (!(c.length > 0) || (c.width !== undefined && !(c.width > 0))) {
      errors.push(`couloir ${c.id} : longueur et largeur doivent être des nombres positifs`);
      continue;
    }
    if (c.orientation !== undefined && c.orientation !== 'horizontal' && c.orientation !== 'vertical') {
      errors.push(`couloir ${c.id} : orientation « horizontal » ou « vertical » attendue`);
      continue;
    }
    const lane = (c.width ?? 1.4) / 2;
    const horizontal = c.orientation !== 'vertical';
    const outOfFloor = horizontal
      ? (c.x < 0 || c.x + c.length > width || c.y - lane < 0 || c.y + lane > depth)
      : (c.y < 0 || c.y + c.length > depth || c.x - lane < 0 || c.x + lane > width);
    if (outOfFloor) errors.push(`couloir ${c.id} : l’emprise dépasse le sol`);
  }
  const shippings = asList(def.shipping);
  const receivings = asList(def.receiving);
  const parkings = def.parkings ?? [];
  const buffers = def.buffers ?? [];
  if (shippings.length === 0) errors.push('au moins une zone d’expédition est requise');
  if (receivings.length === 0) errors.push('au moins une zone de réception est requise');
  checkUnique(def.aisles.map((a) => a.id), 'identifiant d’allée', errors);
  checkUnique(def.racks.map((r) => r.id), 'identifiant de rack', errors);
  checkUnique(
    [...def.workshops, ...shippings, ...receivings, ...parkings, ...buffers].map((z) => z.id),
    'identifiant de zone',
    errors
  );
  for (const rack of def.racks) {
    if (!Number.isInteger(rack.levels) || rack.levels < 1) {
      errors.push(`rack ${rack.id} : « levels » doit être un entier ≥ 1`);
      continue;
    }
    if ((rack.levelHeight !== undefined && !(rack.levelHeight > 0))
        || (rack.depth !== undefined && !(rack.depth > 0))) {
      errors.push(`rack ${rack.id} : hauteur de niveau et profondeur doivent être des nombres positifs`);
      continue;
    }
    const rackHeight = rack.levels * (rack.levelHeight ?? DEFAULT_LEVEL_HEIGHT);
    if (def.dimensions.height !== undefined && rackHeight > def.dimensions.height) {
      errors.push(`rack ${rack.id} : ${rackHeight} m dépasse la hauteur sous plafond (${def.dimensions.height} m)`);
    }
  }
  for (const aisle of def.aisles) {
    if (!Number.isInteger(aisle.bays) || aisle.bays < 2) {
      errors.push(`allée ${aisle.id} : « bays » doit être un entier ≥ 2`);
    }
    if (aisle.width !== undefined && !(aisle.width > 0)) {
      errors.push(`allée ${aisle.id} : la largeur doit être un nombre positif`);
    }
    if (!(aisle.yStart < aisle.yEnd)) {
      errors.push(`allée ${aisle.id} : yStart doit être inférieur à yEnd`);
    }
    if (aisle.yStart < 0 || aisle.yEnd > depth) {
      errors.push(`allée ${aisle.id} : l’allée doit rester dans le sol`);
    }
    if (aisle.x < 0 || aisle.x > width) {
      errors.push(`allée ${aisle.id} : x hors du sol`);
    }
  }
  for (const p of parkings) {
    if (p.vehicles === undefined) continue;
    if (p.vehicles.length === 0) {
      errors.push(`parking ${p.id} : « vehicles » vide (omettre le champ pour admettre tous les engins)`);
    }
    for (const type of p.vehicles) {
      if (!VEHICLE_TYPES.includes(type)) {
        errors.push(`parking ${p.id} : type d'engin inconnu « ${type} » (disponibles : ${VEHICLE_TYPES.join(', ')})`);
      }
    }
  }
  for (const f of [...def.workshops, ...shippings, ...receivings, ...parkings, ...buffers]) {
    if ((f.width !== undefined && !(f.width > 0)) || (f.depth !== undefined && !(f.depth > 0))) {
      errors.push(`zone ${f.id} : largeur et profondeur doivent être des nombres positifs`);
      continue;
    }
    const hw = zoneHalfWidth(f);
    const hd = zoneHalfDepth(f);
    if (f.x - hw < 0 || f.x + hw > width || f.y - hd < 0 || f.y + hd > depth) {
      errors.push(`zone ${f.id} : l’emprise dépasse le sol`);
    }
  }
  if (errors.length > 0) return errors;
  try {
    buildWarehouse(def);
  } catch (error) {
    errors.push(`définition incohérente : ${error.message}`);
  }
  return errors;
}

/**
 * Clone une définition sous un nouveau nom (« Copie de … »).
 * @returns {object} nouvelle définition
 */
export function duplicateDefinition(def) {
  const next = structuredClone(def);
  next.name = `Copie de ${def.name}`;
  return next;
}

/**
 * Définition minimale d'un nouvel entrepôt : une allée, un atelier,
 * une zone d'expédition et une de réception (format en listes).
 * @returns {object}
 */
export function minimalDefinition() {
  return {
    name: 'Nouvel entrepôt',
    description: 'Entrepôt créé depuis l’éditeur',
    dimensions: { width: 20, depth: 20 },
    corridors: [
      { id: 'C1', label: 'Couloir avant', x: 0, y: 3, length: 20, width: 1.4, orientation: 'horizontal' },
      { id: 'C2', label: 'Couloir arrière', x: 0, y: 17, length: 20, width: 1.4, orientation: 'horizontal' },
    ],
    aisles: [{ id: 'A1', x: 8, yStart: 6, yEnd: 14, bays: 5, zone: 'Z1', width: 1.4 }],
    racks: [
      { id: 'R01', aisle: 'A1', side: 'gauche', levels: 1, levelHeight: 2, depth: 1.4 },
      { id: 'R02', aisle: 'A1', side: 'droite', levels: 1, levelHeight: 2, depth: 1.4 },
    ],
    workshops: [{ id: 'AT1', label: 'Atelier 1', x: 5, y: 1.5, width: 4.8, depth: 3 }],
    shipping: [{ id: 'EXP', label: 'Expédition', x: 12, y: 1.5, width: 4.8, depth: 3 }],
    receiving: [{ id: 'REC', label: 'Réception', x: 16, y: 18.5, width: 4.8, depth: 3 }],
  };
}
