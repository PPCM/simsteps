// Modèle pur de l'éditeur d'entrepôt : opérations sur une définition
// (déplacement contraint, ajout/suppression, propriétés, validation).
// Chaque opération clone la définition et retourne le clone : la
// définition d'origine n'est jamais mutée. Module sans DOM ni Three.js.

// Dimensions par défaut, identiques à layout.js : largeur du couloir
// d'une allée (entre ses deux racks de 1,4 m) et emprise des zones au sol
const RACK_WIDTH = 1.4;
const DEFAULT_AISLE_WIDTH = 1.4;
const DEFAULT_ZONE_WIDTH = 4.8;
const DEFAULT_ZONE_DEPTH = 3;
// Marge entre le bout d'une allée et son couloir (débouché praticable)
const CORRIDOR_MARGIN = 1;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
// Zones d'expédition/réception : objet unique (format historique) ou liste
const asList = (value) => (Array.isArray(value) ? value : [value]);
// Demi-emprise latérale d'une allée (couloir + un rack de chaque côté),
// arrondie au millimètre pour des bornes de drag sans bruit flottant
const aisleHalfWidth = (aisle) =>
  Math.round(((aisle?.width ?? DEFAULT_AISLE_WIDTH) + 2 * RACK_WIDTH) * 500) / 1000;
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
  const zone = (z) => ({ width: DEFAULT_ZONE_WIDTH, depth: DEFAULT_ZONE_DEPTH, ...z });
  next.workshops = next.workshops.map(zone);
  next.shipping = asList(next.shipping).map(zone);
  next.receiving = asList(next.receiving).map(zone);
  return next;
}

/** Accroche une coordonnée à la grille au mètre. */
export function snapToGrid(v) {
  return Math.round(v);
}

/** Borne l'axe x d'une allée pour que ses racks restent dans le sol. */
export function clampAisleX(def, x, aisle) {
  const half = aisleHalfWidth(aisle);
  return clamp(x, half, def.dimensions.width - half);
}

/** Borne le départ d'une allée entre les couloirs, longueur conservée. */
export function clampAisleY(def, yStart, length) {
  const min = def.corridors.frontY + CORRIDOR_MARGIN;
  const max = def.corridors.backY - CORRIDOR_MARGIN - length;
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
  if (x !== undefined) aisle.x = clampAisleX(next, snapToGrid(x), aisle);
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
  if (x !== undefined) {
    facility.x = clamp(snapToGrid(x), hw, next.dimensions.width - hw);
  }
  if (y !== undefined) {
    facility.y = clamp(snapToGrid(y), hd, next.dimensions.depth - hd);
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
    : { id, x: clampAisleX(next, 5), yStart: next.corridors.frontY + 3, yEnd: next.corridors.backY - 3, bays: 5, zone: 'Z1', width: DEFAULT_AISLE_WIDTH };
  next.aisles.push(aisle);
  const rackIds = next.racks.map((r) => r.id);
  const levels = next.racks[next.racks.length - 1]?.levels ?? 1;
  for (const side of ['gauche', 'droite']) {
    const rackId = nextId('R', rackIds, 2);
    rackIds.push(rackId);
    next.racks.push({ id: rackId, aisle: id, side, levels });
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
  const x = clamp(snapToGrid((last?.x ?? 4) + 6), width / 2, next.dimensions.width - width / 2);
  next.workshops.push({ id, label: `Atelier ${n}`, x, y: last?.y ?? next.corridors.frontY - 2, width, depth });
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
  const x = clamp(snapToGrid((last?.x ?? 4) + width + 2), width / 2, next.dimensions.width - width / 2);
  const y = last?.y ?? next.corridors.frontY - 2;
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
 * width). Le renommage d'id est propagé aux racks de l'allée.
 * @returns {object} nouvelle définition
 */
export function updateAisle(def, aisleId, props) {
  const next = structuredClone(def);
  const aisle = next.aisles.find((a) => a.id === aisleId);
  if (!aisle) throw new Error(`Allée inconnue : ${aisleId}`);
  const { id, zone, bays, yStart, yEnd, width } = props;
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
  return next;
}

/**
 * Met à jour les propriétés globales (name, description, dimensions,
 * corridors).
 * @returns {object} nouvelle définition
 */
export function updateGlobals(def, props) {
  const next = structuredClone(def);
  if (props.name !== undefined) next.name = props.name;
  if (props.description !== undefined) next.description = props.description;
  if (props.width !== undefined) next.dimensions.width = props.width;
  if (props.depth !== undefined) next.dimensions.depth = props.depth;
  if (props.frontY !== undefined) next.corridors.frontY = props.frontY;
  if (props.backY !== undefined) next.corridors.backY = props.backY;
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
  const { frontY, backY } = def.corridors ?? {};
  if (!(frontY > 0) || !(backY > frontY) || !(backY < depth)) {
    errors.push('les couloirs doivent vérifier 0 < avant < arrière < profondeur');
  }
  const shippings = asList(def.shipping);
  const receivings = asList(def.receiving);
  if (shippings.length === 0) errors.push('au moins une zone d’expédition est requise');
  if (receivings.length === 0) errors.push('au moins une zone de réception est requise');
  checkUnique(def.aisles.map((a) => a.id), 'identifiant d’allée', errors);
  checkUnique(def.racks.map((r) => r.id), 'identifiant de rack', errors);
  checkUnique(
    [...def.workshops, ...shippings, ...receivings].map((z) => z.id),
    'identifiant de zone',
    errors
  );
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
    if (aisle.yStart <= frontY || aisle.yEnd >= backY) {
      errors.push(`allée ${aisle.id} : l’allée doit rester entre les couloirs`);
    }
    if (aisle.x < 0 || aisle.x > width) {
      errors.push(`allée ${aisle.id} : x hors du sol`);
    }
  }
  for (const f of [...def.workshops, ...shippings, ...receivings]) {
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
    corridors: { frontY: 3, backY: 17 },
    aisles: [{ id: 'A1', x: 8, yStart: 6, yEnd: 14, bays: 5, zone: 'Z1', width: 1.4 }],
    racks: [
      { id: 'R01', aisle: 'A1', side: 'gauche', levels: 1 },
      { id: 'R02', aisle: 'A1', side: 'droite', levels: 1 },
    ],
    workshops: [{ id: 'AT1', label: 'Atelier 1', x: 5, y: 1.5, width: 4.8, depth: 3 }],
    shipping: [{ id: 'EXP', label: 'Expédition', x: 12, y: 1.5, width: 4.8, depth: 3 }],
    receiving: [{ id: 'REC', label: 'Réception', x: 16, y: 18.5, width: 4.8, depth: 3 }],
  };
}
