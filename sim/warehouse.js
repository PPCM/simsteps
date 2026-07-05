// Chargement d'un entrepôt décrit en JSON et construction du graphe de
// circulation : nœuds de baie le long des allées, réseau de couloirs
// (segments horizontaux/verticaux connectés à leurs intersections),
// débouchés d'allées sur le couloir croisant le plus proche, ateliers
// et zones raccordés par projection sur le couloir le plus proche.
// Les emplacements picking sont projetés sur le nœud de baie le plus
// proche. La connexité du réseau est vérifiée à la construction.

import { Graph } from './graph.js';

/**
 * Zones d'expédition/réception : le format accepte un objet unique
 * (format historique) ou une liste ; on travaille toujours en liste.
 * @returns {Array<object>}
 */
export function facilityList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * Couloirs : le format accepte l'objet historique { frontY, backY }
 * (deux couloirs transversaux pleine largeur) ou une liste d'objets
 * { id, label?, x, y, length, width?, orientation } — (x, y) est le
 * point de départ de l'axe du couloir, qui s'étend de `length` mètres
 * vers +x (horizontal) ou +y (vertical).
 * @returns {Array<object>}
 */
export function corridorList(def) {
  const corridors = def.corridors;
  if (Array.isArray(corridors)) return corridors;
  return [
    {
      id: 'C1', label: 'Couloir avant', x: 0, y: corridors.frontY,
      length: def.dimensions.width, width: 1.4, orientation: 'horizontal',
    },
    {
      id: 'C2', label: 'Couloir arrière', x: 0, y: corridors.backY,
      length: def.dimensions.width, width: 1.4, orientation: 'horizontal',
    },
  ];
}

const EPS = 1e-6;
// Défauts partagés avec l'éditeur et le rendu (web/public/js/layout.js)
const DEFAULT_LANE_WIDTH = 1.4;
const DEFAULT_LEVEL_HEIGHT = 2.0;

// Projette un point sur l'axe d'un couloir (segment) et donne la distance
function projectOnCorridor(corridor, px, py) {
  if (corridor.orientation !== 'vertical') {
    const x = Math.min(Math.max(px, corridor.x), corridor.x + corridor.length);
    return { x, y: corridor.y, d: Math.hypot(px - x, py - corridor.y) };
  }
  const y = Math.min(Math.max(py, corridor.y), corridor.y + corridor.length);
  return { x: corridor.x, y, d: Math.hypot(px - corridor.x, py - y) };
}

/**
 * Construit la représentation exploitable de l'entrepôt.
 * @param {object} spec contenu du warehouse.json
 * @returns {{
 *   name: string,
 *   graph: Graph,
 *   slots: Map<string, {id: string, rackId: string, aisleId: string, zone: string, nodeId: string, level: number}>,
 *   aisles: Array<object>,
 *   workshops: Array<{id: string, label: string, nodeId: string}>,
 *   shippings: Array<{id: string, label: string, nodeId: string}>,
 *   receivings: Array<{id: string, label: string, nodeId: string}>,
 *   shippingNodeId: string,
 *   receivingNodeId: string,
 *   raw: object
 * }}
 */
export function buildWarehouse(spec) {
  const graph = new Graph();
  const corridors = corridorList(spec);

  // --- Nœuds de baie par allée (arêtes au gabarit du couloir d'allée) ---
  for (const aisle of spec.aisles) {
    const pitch = (aisle.yEnd - aisle.yStart) / (aisle.bays - 1);
    const laneWidth = aisle.width ?? DEFAULT_LANE_WIDTH;
    let previous = null;
    for (let b = 0; b < aisle.bays; b++) {
      const nodeId = `${aisle.id}:b${b + 1}`;
      graph.addNode(nodeId, aisle.x, aisle.yStart + b * pitch);
      if (previous) graph.addEdge(previous, nodeId, { width: laneWidth });
      previous = nodeId;
    }
  }

  // --- Stations le long des couloirs (nœuds à clé de coordonnées :
  // deux couloirs qui partagent un point partagent le nœud) ---
  const stations = new Map(corridors.map((c) => [c.id, []]));
  const stationId = (x, y) => `c:${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
  function addStation(corridor, x, y) {
    const id = stationId(x, y);
    if (!graph.nodes.has(id)) graph.addNode(id, x, y);
    const t = corridor.orientation !== 'vertical' ? x : y;
    const list = stations.get(corridor.id);
    if (!list.some((s) => s.nodeId === id)) list.push({ t, nodeId: id });
    return id;
  }

  for (const corridor of corridors) {
    const horizontal = corridor.orientation !== 'vertical';
    addStation(corridor, corridor.x, corridor.y);
    addStation(
      corridor,
      horizontal ? corridor.x + corridor.length : corridor.x,
      horizontal ? corridor.y : corridor.y + corridor.length
    );
  }

  // Intersections entre couloirs horizontaux et verticaux
  for (const h of corridors.filter((c) => c.orientation !== 'vertical')) {
    for (const v of corridors.filter((c) => c.orientation === 'vertical')) {
      const crosses = v.x >= h.x - EPS && v.x <= h.x + h.length + EPS
        && h.y >= v.y - EPS && h.y <= v.y + v.length + EPS;
      if (crosses) {
        addStation(h, v.x, h.y);
        addStation(v, v.x, h.y);
      }
    }
  }

  // --- Débouchés d'allées : de chaque extrémité vers le couloir
  // horizontal croisant le plus proche (les racks bloquent la traversée
  // au milieu des baies) ; au moins un débouché est requis ---
  for (const aisle of spec.aisles) {
    const crossing = corridors.filter((c) => c.orientation !== 'vertical'
      && aisle.x >= c.x - EPS && aisle.x <= c.x + c.length + EPS);
    const before = crossing.filter((c) => c.y <= aisle.yStart + EPS)
      .sort((a, b) => b.y - a.y)[0];
    const after = crossing.filter((c) => c.y >= aisle.yEnd - EPS)
      .sort((a, b) => a.y - b.y)[0];
    if (!before && !after) {
      throw new Error(`l'allée ${aisle.id} ne débouche sur aucun couloir`);
    }
    const laneWidth = aisle.width ?? DEFAULT_LANE_WIDTH;
    if (before) graph.addEdge(addStation(before, aisle.x, before.y), `${aisle.id}:b1`, { width: laneWidth });
    if (after) graph.addEdge(addStation(after, aisle.x, after.y), `${aisle.id}:b${aisle.bays}`, { width: laneWidth });
  }

  // --- Ateliers et zones : un nœud chacun, raccordé par projection
  // sur le couloir le plus proche ---
  const shippings = facilityList(spec.shipping);
  const receivings = facilityList(spec.receiving);
  const parkings = spec.parkings ?? []; // stationnement des agents (optionnel)
  const buffers = spec.buffers ?? []; // zones tampon avant emballage (optionnel)
  const facilities = [...spec.workshops, ...shippings, ...receivings, ...parkings, ...buffers];
  for (const f of facilities) {
    graph.addNode(f.id, f.x, f.y);
    let best = null;
    for (const corridor of corridors) {
      const p = projectOnCorridor(corridor, f.x, f.y);
      if (!best || p.d < best.d) best = { ...p, corridor };
    }
    const attach = addStation(best.corridor, best.x, best.y);
    if (attach !== f.id) graph.addEdge(f.id, attach);
  }

  // --- Chaînage des stations de chaque couloir par abscisse curviligne ---
  // Sens unique éventuel (oneWay : 'positif' = vers +x/+y, 'negatif' =
  // vers −x/−y) et classe d'agents admise (access)
  for (const corridor of corridors) {
    const oneWay = corridor.oneWay ?? null;
    if (oneWay !== null && oneWay !== 'positif' && oneWay !== 'negatif') {
      throw new Error(`couloir ${corridor.id} : « oneWay » doit valoir positif ou negatif`);
    }
    const access = corridor.access ?? 'mixte';
    if (!['mixte', 'pietons', 'engins'].includes(access)) {
      throw new Error(`couloir ${corridor.id} : « access » doit valoir mixte, pietons ou engins`);
    }
    const list = stations.get(corridor.id).sort((a, b) => a.t - b.t);
    for (let i = 1; i < list.length; i++) {
      const options = { width: corridor.width ?? DEFAULT_LANE_WIDTH, access, oneWay: oneWay !== null };
      if (oneWay === 'negatif') graph.addEdge(list[i].nodeId, list[i - 1].nodeId, options);
      else graph.addEdge(list[i - 1].nodeId, list[i].nodeId, options);
    }
  }

  // --- Connexité : tout le réseau doit être atteignable ET permettre
  // le retour (connexité forte, les sens uniques peuvent la briser) ---
  const start = shippings[0].id;
  const reachable = graph.reachableFrom(start);
  const reverse = new Map([...graph.nodes.keys()].map((id) => [id, []]));
  for (const id of graph.nodes.keys()) {
    for (const { to } of graph.neighbors(id)) reverse.get(to).push(id);
  }
  const canReturn = new Set([start]);
  const returnQueue = [start];
  while (returnQueue.length > 0) {
    for (const from of reverse.get(returnQueue.pop())) {
      if (!canReturn.has(from)) {
        canReturn.add(from);
        returnQueue.push(from);
      }
    }
  }
  for (const aisle of spec.aisles) {
    if (!reachable.has(`${aisle.id}:b1`)) {
      throw new Error(`réseau de circulation non connexe : l'allée ${aisle.id} est inaccessible depuis ${start}`);
    }
  }
  for (const f of facilities) {
    if (!reachable.has(f.id)) {
      throw new Error(`réseau de circulation non connexe : la zone ${f.id} est inaccessible depuis ${start}`);
    }
  }
  for (const aisle of spec.aisles) {
    if (!canReturn.has(`${aisle.id}:b1`)) {
      throw new Error(`sens uniques incohérents : impossible de revenir de l'allée ${aisle.id} vers ${start}`);
    }
  }
  for (const f of facilities) {
    if (!canReturn.has(f.id)) {
      throw new Error(`sens uniques incohérents : impossible de revenir de la zone ${f.id} vers ${start}`);
    }
  }

  // --- Emplacements picking : rack × baie × niveau ---
  const aisleById = new Map(spec.aisles.map((a) => [a.id, a]));
  const slots = new Map();
  for (const rack of spec.racks) {
    const aisle = aisleById.get(rack.aisle);
    if (!aisle) throw new Error(`Rack ${rack.id} : allée inconnue ${rack.aisle}`);
    const levelHeight = rack.levelHeight ?? DEFAULT_LEVEL_HEIGHT;
    for (let b = 1; b <= aisle.bays; b++) {
      for (let level = 1; level <= rack.levels; level++) {
        const id = `${rack.id}-${String(b).padStart(2, '0')}-${level}`;
        slots.set(id, {
          id,
          rackId: rack.id,
          aisleId: aisle.id,
          zone: aisle.zone,
          nodeId: `${aisle.id}:b${b}`,
          level,
          levelHeight,
        });
      }
    }
  }

  // --- Convoyeurs : segments à débit fixe reliant le tampon et
  // l'atelier les plus proches (transport automatique du picking B2C
  // mis en attente, à 0,5 m/s) ---
  const conveyors = (spec.conveyors ?? []).map((c) => {
    if (!(c.length > 0)) {
      throw new Error(`convoyeur ${c.id} : longueur positive requise`);
    }
    if (buffers.length === 0 || spec.workshops.length === 0) {
      throw new Error(`convoyeur ${c.id} : il faut au moins une zone tampon et un atelier`);
    }
    const nearest = (list) => list.reduce((best, z) =>
      (projectOnCorridor(c, z.x, z.y).d < projectOnCorridor(c, best.x, best.y).d ? z : best));
    const source = nearest(buffers);
    const sink = nearest(spec.workshops);
    return {
      id: c.id,
      label: c.label ?? c.id,
      sourceBufferId: source.id,
      sinkNodeId: sink.id,
      transitSec: c.length / 0.5,
      throughputPerMin: c.throughputPerMin ?? 6,
    };
  });

  return {
    name: spec.name,
    graph,
    slots,
    aisles: spec.aisles,
    workshops: spec.workshops.map((w) => ({ id: w.id, label: w.label, nodeId: w.id })),
    shippings: shippings.map((s) => ({ id: s.id, label: s.label, nodeId: s.id })),
    receivings: receivings.map((r) => ({ id: r.id, label: r.label, nodeId: r.id })),
    parkings: parkings.map((p) => ({
      id: p.id, label: p.label, nodeId: p.id, vehicles: p.vehicles,
    })),
    buffers: buffers.map((b) => ({ id: b.id, label: b.label, nodeId: b.id })),
    conveyors,
    // Première zone de chaque type : point de départ des opérateurs et
    // compatibilité avec les consommateurs mono-zone (relecture)
    shippingNodeId: shippings[0].id,
    receivingNodeId: receivings[0].id,
    raw: spec,
  };
}
