// Modèle pur de l'éditeur d'entrepôt : opérations sur une définition
// (déplacement contraint, ajout/suppression, propriétés, validation).
// Chaque opération clone la définition et retourne le clone : la
// définition d'origine n'est jamais mutée. Module sans DOM ni Three.js.

// Emprise latérale des racks autour de l'axe d'une allée (mètres),
// identique aux constantes de layout.js : de x − 2.1 à x + 2.1
const AISLE_HALF_WIDTH = 2.1;
// Demi-emprise des zones au sol (patch 4.8 × 3 de layout.js)
const ZONE_HALF_WIDTH = 2.4;
const ZONE_HALF_DEPTH = 1.5;
// Marge entre le bout d'une allée et son couloir (débouché praticable)
const CORRIDOR_MARGIN = 1;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Accroche une coordonnée à la grille au mètre. */
export function snapToGrid(v) {
  return Math.round(v);
}

/** Borne l'axe x d'une allée pour que ses racks restent dans le sol. */
export function clampAisleX(def, x) {
  return clamp(x, AISLE_HALF_WIDTH, def.dimensions.width - AISLE_HALF_WIDTH);
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
  if (x !== undefined) aisle.x = clampAisleX(next, snapToGrid(x));
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
  if (kind === 'shipping') return def.shipping;
  if (kind === 'receiving') return def.receiving;
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
  if (x !== undefined) {
    facility.x = clamp(snapToGrid(x), ZONE_HALF_WIDTH, next.dimensions.width - ZONE_HALF_WIDTH);
  }
  if (y !== undefined) {
    facility.y = clamp(snapToGrid(y), ZONE_HALF_DEPTH, next.dimensions.depth - ZONE_HALF_DEPTH);
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
    ? { id, x: clampAisleX(next, last.x + 5), yStart: last.yStart, yEnd: last.yEnd, bays: last.bays, zone: last.zone }
    : { id, x: clampAisleX(next, 5), yStart: next.corridors.frontY + 3, yEnd: next.corridors.backY - 3, bays: 5, zone: 'Z1' };
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
  const x = clamp(snapToGrid((last?.x ?? 4) + 6), ZONE_HALF_WIDTH, next.dimensions.width - ZONE_HALF_WIDTH);
  next.workshops.push({ id, label: `Atelier ${n}`, x, y: last?.y ?? next.corridors.frontY - 2 });
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
 * Met à jour les propriétés d'une allée (id, zone, bays, yStart, yEnd).
 * Le renommage d'id est propagé aux racks de l'allée.
 * @returns {object} nouvelle définition
 */
export function updateAisle(def, aisleId, props) {
  const next = structuredClone(def);
  const aisle = next.aisles.find((a) => a.id === aisleId);
  if (!aisle) throw new Error(`Allée inconnue : ${aisleId}`);
  const { id, zone, bays, yStart, yEnd } = props;
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
  return next;
}

/**
 * Met à jour les propriétés d'un atelier ou d'une zone (id, label, x, y).
 * @returns {object} nouvelle définition
 */
export function updateFacility(def, kind, id, props) {
  const next = structuredClone(def);
  const facility = facilityOf(next, kind, id);
  for (const key of ['id', 'label', 'x', 'y']) {
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
  checkUnique(def.aisles.map((a) => a.id), 'identifiant d’allée', errors);
  checkUnique(def.racks.map((r) => r.id), 'identifiant de rack', errors);
  checkUnique(
    [...def.workshops.map((w) => w.id), def.shipping.id, def.receiving.id],
    'identifiant de zone',
    errors
  );
  for (const aisle of def.aisles) {
    if (!Number.isInteger(aisle.bays) || aisle.bays < 2) {
      errors.push(`allée ${aisle.id} : « bays » doit être un entier ≥ 2`);
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
  for (const f of [...def.workshops, def.shipping, def.receiving]) {
    if (f.x < 0 || f.x > width || f.y < 0 || f.y > depth) {
      errors.push(`zone ${f.id} : position hors du sol`);
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
 * expédition et réception.
 * @returns {object}
 */
export function minimalDefinition() {
  return {
    name: 'Nouvel entrepôt',
    description: 'Entrepôt créé depuis l’éditeur',
    dimensions: { width: 20, depth: 20 },
    corridors: { frontY: 3, backY: 17 },
    aisles: [{ id: 'A1', x: 8, yStart: 6, yEnd: 14, bays: 5, zone: 'Z1' }],
    racks: [
      { id: 'R01', aisle: 'A1', side: 'gauche', levels: 1 },
      { id: 'R02', aisle: 'A1', side: 'droite', levels: 1 },
    ],
    workshops: [{ id: 'AT1', label: 'Atelier 1', x: 5, y: 1.5 }],
    shipping: { id: 'EXP', label: 'Expédition', x: 12, y: 1.5 },
    receiving: { id: 'REC', label: 'Réception', x: 16, y: 18.5 },
  };
}
