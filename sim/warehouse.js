// Chargement d'un entrepôt décrit en JSON et construction du graphe de
// circulation : nœuds de baie le long des allées, jonctions sur deux
// couloirs transversaux (avant/arrière), ateliers et zones insérés dans
// les couloirs. Les emplacements picking sont projetés sur le nœud de
// baie le plus proche.

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
  const { frontY, backY } = spec.corridors;

  // --- Nœuds de baie et jonctions par allée ---
  for (const aisle of spec.aisles) {
    const pitch = (aisle.yEnd - aisle.yStart) / (aisle.bays - 1);
    let previous = null;
    for (let b = 0; b < aisle.bays; b++) {
      const nodeId = `${aisle.id}:b${b + 1}`;
      graph.addNode(nodeId, aisle.x, aisle.yStart + b * pitch);
      if (previous) graph.addEdge(previous, nodeId);
      previous = nodeId;
    }
    graph.addNode(`${aisle.id}:front`, aisle.x, frontY);
    graph.addNode(`${aisle.id}:back`, aisle.x, backY);
    graph.addEdge(`${aisle.id}:front`, `${aisle.id}:b1`);
    graph.addEdge(`${aisle.id}:back`, `${aisle.id}:b${aisle.bays}`);
  }

  // --- Ateliers et zones : un nœud chacun, rattaché au couloir le plus proche ---
  const midY = (frontY + backY) / 2;
  const shippings = facilityList(spec.shipping);
  const receivings = facilityList(spec.receiving);
  const facilities = [
    ...spec.workshops.map((w) => ({ ...w, kind: 'workshop' })),
    ...shippings.map((s) => ({ ...s, kind: 'shipping' })),
    ...receivings.map((r) => ({ ...r, kind: 'receiving' })),
  ];
  const frontChain = spec.aisles.map((a) => ({ x: a.x, nodeId: `${a.id}:front` }));
  const backChain = spec.aisles.map((a) => ({ x: a.x, nodeId: `${a.id}:back` }));
  for (const f of facilities) {
    graph.addNode(f.id, f.x, f.y);
    (f.y <= midY ? frontChain : backChain).push({ x: f.x, nodeId: f.id });
  }

  // --- Chaînage des couloirs par abscisse croissante ---
  for (const chain of [frontChain, backChain]) {
    chain.sort((a, b) => a.x - b.x);
    for (let i = 1; i < chain.length; i++) {
      graph.addEdge(chain[i - 1].nodeId, chain[i].nodeId);
    }
  }

  // --- Emplacements picking : rack × baie × niveau ---
  const aisleById = new Map(spec.aisles.map((a) => [a.id, a]));
  const slots = new Map();
  for (const rack of spec.racks) {
    const aisle = aisleById.get(rack.aisle);
    if (!aisle) throw new Error(`Rack ${rack.id} : allée inconnue ${rack.aisle}`);
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
        });
      }
    }
  }

  return {
    name: spec.name,
    graph,
    slots,
    aisles: spec.aisles,
    workshops: spec.workshops.map((w) => ({ id: w.id, label: w.label, nodeId: w.id })),
    shippings: shippings.map((s) => ({ id: s.id, label: s.label, nodeId: s.id })),
    receivings: receivings.map((r) => ({ id: r.id, label: r.label, nodeId: r.id })),
    // Première zone de chaque type : point de départ des opérateurs et
    // compatibilité avec les consommateurs mono-zone (relecture)
    shippingNodeId: shippings[0].id,
    receivingNodeId: receivings[0].id,
    raw: spec,
  };
}
