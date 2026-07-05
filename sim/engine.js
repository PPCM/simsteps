// Moteur de simulation à événements discrets, indépendant du DOM et de la
// base de données. Horloge simulée + file d'événements : la simulation
// s'exécute aussi vite que possible, le rendu (plus tard) interpolera.
//
// Cycle d'un opérateur : inactif → déplacement vers un emplacement →
// prélèvement → ... → déplacement vers l'atelier/expédition → dépose →
// inactif. Les missions sont produites par la stratégie de picking.

import { EventQueue } from './eventQueue.js';
import { mulberry32, randExponential } from './rng.js';
import { makeOrder, drawProfile } from './orders.js';
import { getStrategy } from './strategies.js';
import { computeKpis } from './kpi.js';
import { VEHICLES, fleetFromScenario } from './vehicles.js';
import { buildSlotting } from './skus.js';

/** Valeurs par défaut d'un scénario (tous les champs sont surchargables). */
export const DEFAULT_SCENARIO = {
  name: 'Scénario sans nom',
  seed: 1,
  durationHours: 2,
  operators: 5,
  fleet: null, // { type: nombre } — prime sur operators (voir vehicles.js)
  ordersPerHour: 30,
  b2cShare: 0.7,
  strategy: 'orderByOrder',
  slotting: 'aleatoire', // placement des classes de rotation ABC (voir skus.js)
  speedMps: 1.2,
  pickTimePerLineSec: 12,
  liftTimePerLevelSec: 6, // surcoût par niveau au-dessus du premier
  dropTimeSec: 20,
  waveSize: 20,
  b2bClients: 8,
};

/**
 * Exécute une simulation complète et renvoie les KPI et l'état final.
 * @param {object} warehouse entrepôt construit par buildWarehouse()
 * @param {object} scenarioInput paramètres du scénario (fusionnés avec les défauts)
 * @param {{
 *   onEvent?: (event: object, state: object) => void,
 *   onTravel?: (opId: string, path: string[], t0: number, distance: number, duration: number) => void,
 *   onState?: (opId: string, state: string, t: number) => void,
 * }} [hooks]
 *        Observateurs optionnels pour le rendu : onTravel à chaque départ
 *        d'un opérateur (chemin complet), onState à chaque changement
 *        d'état (moving | picking | dropping | idle)
 * @returns {{kpis: object, orders: Array, operators: Array, scenario: object}}
 */
export function runSimulation(warehouse, scenarioInput, hooks = {}) {
  const scenario = { ...DEFAULT_SCENARIO, ...scenarioInput };
  const rng = mulberry32(scenario.seed);
  const queue = new EventQueue();
  const strategy = getStrategy(scenario.strategy);
  const durationSec = scenario.durationHours * 3600;
  const { graph, slots } = warehouse;
  const slotIds = [...slots.keys()];
  const orderRatePerSec = scenario.ordersPerHour / 3600;

  // Références et rangement : tirage d'emplacements pondéré par la
  // rotation ABC, placement des classes selon le paramètre slotting
  const { drawSlot } = buildSlotting(warehouse, scenario.slotting, rng);

  // Abscisse de chaque allée pour ordonner les tournées en serpentin
  const aisleX = new Map(warehouse.aisles.map((a) => [a.id, a.x]));

  /** @type {Array<object>} commandes créées, dans l'ordre d'arrivée */
  const orders = [];
  /** @type {Array<object>} missions construites en attente d'un opérateur */
  const missionQueue = [];
  let nextOrderId = 1;
  let nextMissionId = 1;
  let now = 0;

  // Agents de la flotte : un profil d'engin par agent. Le piéton suit
  // la vitesse du scénario (rétro-compatibilité de speedMps).
  const operators = [];
  for (const [vehicle, count] of fleetFromScenario(scenario)) {
    const base = VEHICLES[vehicle];
    const profile = vehicle === 'pieton'
      ? { ...base, speedMps: scenario.speedMps, speedLoadedMps: scenario.speedMps }
      : base;
    for (let i = 0; i < count; i++) {
      operators.push({
        id: `op-${operators.length + 1}`,
        vehicle,
        profile,
        nodeId: warehouse.shippingNodeId,
        startNodeId: warehouse.shippingNodeId, // parking affecté (voir plus bas)
        returning: false, // retour au parking en cours
        state: 'idle', // idle | moving | picking | dropping
        mission: null,
        stopIndex: 0,
        dropIndex: 0,
        targetNodeId: null,
        distance: 0, // mètres parcourus
        busyTime: 0, // secondes en mission
        busySince: null,
        linesPicked: 0,
      });
    }
  }

  // Nœuds atteignables par gabarit d'engin (une passe par largeur distincte)
  const reachByWidth = new Map();
  for (const op of operators) {
    if (!reachByWidth.has(op.profile.aisleWidthM)) {
      reachByWidth.set(
        op.profile.aisleWidthM,
        graph.reachableFrom(warehouse.shippingNodeId, op.profile.aisleWidthM)
      );
    }
  }

  // Stationnement : chaque agent démarre au parking atteignable le plus
  // proche de l'expédition pour son gabarit (à défaut, l'expédition) et
  // y retournera à l'inactivité
  for (const op of operators) {
    const reach = reachByWidth.get(op.profile.aisleWidthM);
    let best = null;
    for (const parking of warehouse.parkings) {
      if (!reach.has(parking.nodeId)) continue;
      const d = graph.distance(warehouse.shippingNodeId, parking.nodeId);
      if (best === null || d < best.d) best = { nodeId: parking.nodeId, d };
    }
    if (best !== null) {
      op.startNodeId = best.nodeId;
      op.nodeId = best.nodeId;
    }
  }

  // Un agent peut-il réaliser une mission ? Levée suffisante pour le
  // niveau le plus haut, et tous les arrêts/déposes dans son gabarit.
  function compatible(op, mission) {
    if (mission.requiredLiftM > op.profile.liftM + 1e-9) return false;
    const reach = reachByWidth.get(op.profile.aisleWidthM);
    return mission.nodes.every((nodeId) => reach.has(nodeId));
  }

  // --- Construction d'une mission à partir de lignes planifiées ---

  function buildMission(lines) {
    // Regroupement des lignes par nœud de passage (deux racks face à face
    // partagent le même nœud d'allée)
    const stopsByNode = new Map();
    for (const line of lines) {
      if (!stopsByNode.has(line.nodeId)) {
        stopsByNode.set(line.nodeId, { nodeId: line.nodeId, aisleId: line.aisleId, lines: [] });
      }
      stopsByNode.get(line.nodeId).lines.push(line);
    }
    // Tournée en serpentin : allées par abscisse croissante, sens de
    // parcours alterné une allée sur deux
    const stops = [...stopsByNode.values()];
    const aisleOrder = [...new Set(stops.map((s) => s.aisleId))].sort(
      (a, b) => aisleX.get(a) - aisleX.get(b)
    );
    stops.sort((s1, s2) => {
      const a1 = aisleOrder.indexOf(s1.aisleId);
      const a2 = aisleOrder.indexOf(s2.aisleId);
      if (a1 !== a2) return a1 - a2;
      const y1 = graph.nodes.get(s1.nodeId).y;
      const y2 = graph.nodes.get(s2.nodeId).y;
      return a1 % 2 === 0 ? y1 - y2 : y2 - y1;
    });

    // Cibles de dépose : les lignes B2C partent à l'atelier le plus
    // proche du dernier prélèvement, les lignes B2B à la zone
    // d'expédition la plus proche
    const b2cLines = lines.filter((l) => l.profile === 'B2C');
    const b2bLines = lines.filter((l) => l.profile === 'B2B');
    const lastNode = stops[stops.length - 1].nodeId;
    const nearest = (candidates) => candidates.reduce((best, c) =>
      graph.distance(lastNode, c.nodeId) < graph.distance(lastNode, best.nodeId) ? c : best
    );
    const drops = [];
    if (b2cLines.length > 0) {
      drops.push({ nodeId: nearest(warehouse.workshops).nodeId, lines: b2cLines });
    }
    if (b2bLines.length > 0) {
      drops.push({ nodeId: nearest(warehouse.shippings).nodeId, lines: b2bLines });
    }

    // Exigences de la mission pour l'affectation : hauteur de levée du
    // niveau le plus haut et liste des nœuds à atteindre
    const requiredLiftM = Math.max(
      0, ...lines.map((l) => ((l.level ?? 1) - 1) * (l.levelHeight ?? 2))
    );
    const nodes = [...stops.map((s) => s.nodeId), ...drops.map((d) => d.nodeId)];

    return { id: nextMissionId++, lines, stops, drops, requiredLiftM, nodes };
  }

  // --- Affectation des missions aux opérateurs inactifs ---

  function tryAssign() {
    let idle = operators.filter((o) => o.state === 'idle');
    while (idle.length > 0) {
      if (missionQueue.length === 0) {
        const planned = strategy.plan(orders, idle.length, { waveSize: scenario.waveSize });
        if (planned.length === 0) break;
        for (const lines of planned) {
          for (const line of lines) line.state = 'planned';
          missionQueue.push(buildMission(lines));
        }
      }
      // Première mission de la file réalisable par un agent inactif ;
      // une mission irréalisable par toute la flotte est abandonnée
      // (lignes marquées inaccessibles, commandes jamais terminées)
      let assigned = false;
      for (let m = 0; m < missionQueue.length; m++) {
        const mission = missionQueue[m];
        const candidates = idle.filter((op) => compatible(op, mission));
        if (candidates.length === 0) {
          if (!operators.some((op) => compatible(op, mission))) {
            missionQueue.splice(m, 1);
            m--;
            for (const line of mission.lines) line.state = 'unreachable';
          }
          continue;
        }
        // Affectation au plus proche : agent compatible le plus près du
        // premier arrêt (distance à vol d'oiseau, heuristique)
        const firstNode = mission.stops[0].nodeId;
        let best = candidates[0];
        for (const op of candidates) {
          if (graph.distance(op.nodeId, firstNode) < graph.distance(best.nodeId, firstNode)) best = op;
        }
        idle = idle.filter((o) => o !== best);
        missionQueue.splice(m, 1);
        best.mission = mission;
        best.stopIndex = 0;
        best.dropIndex = 0;
        best.busySince = now;
        travelTo(best, firstNode);
        assigned = true;
        break;
      }
      if (!assigned) break; // les missions restantes attendent un agent compatible
    }
  }

  // --- Déplacements sur le graphe ---

  // Trafic agrégé par arête (clé canonique "a|b") : nombre de traversées,
  // stocké avec chaque run pour la heatmap et le diagramme spaghetti
  const edgeTraffic = new Map();

  function travelTo(op, targetNodeId) {
    const route = graph.shortestPath(op.nodeId, targetNodeId, {
      minWidth: op.profile.aisleWidthM,
    });
    if (!route) throw new Error(`Aucun chemin de ${op.nodeId} vers ${targetNodeId}`);
    for (let i = 1; i < route.path.length; i++) {
      const key = [route.path[i - 1], route.path[i]].sort().join('|');
      edgeTraffic.set(key, (edgeTraffic.get(key) ?? 0) + 1);
    }
    op.state = 'moving';
    op.targetNodeId = targetNodeId;
    op.distance += route.distance;
    // En charge après le premier prélèvement de la mission
    const loaded = op.mission !== null && op.stopIndex > 0;
    const duration = route.distance / (loaded ? op.profile.speedLoadedMps : op.profile.speedMps);
    hooks.onState?.(op.id, 'moving', now);
    hooks.onTravel?.(op.id, route.path, now, route.distance, duration);
    queue.push(now + duration, 'opArrive', { opId: op.id });
  }

  // --- Gestion des événements ---

  const opById = new Map(operators.map((o) => [o.id, o]));

  function onOrderArrival() {
    const profile = drawProfile(rng, scenario.b2cShare);
    const base = makeOrder(rng, {
      id: nextOrderId++,
      profile,
      slotIds,
      drawSlot,
      b2bClients: scenario.b2bClients,
    });
    // Enrichissement des lignes avec la topologie et l'état de suivi
    const order = {
      ...base,
      createdAt: now,
      completedAt: null,
      lines: base.lines.map((l) => {
        const slot = slots.get(l.slotId);
        return {
          ...l,
          orderId: base.id,
          profile,
          nodeId: slot.nodeId,
          aisleId: slot.aisleId,
          zone: slot.zone,
          level: slot.level,
          levelHeight: slot.levelHeight,
          state: 'pending', // pending | planned | picked | dropped | unreachable
        };
      }),
    };
    orders.push(order);
    scheduleNextArrival();
    tryAssign();
  }

  function scheduleNextArrival() {
    const next = now + randExponential(rng, orderRatePerSec);
    if (next <= durationSec) queue.push(next, 'orderArrival');
  }

  function onOpArrive(op) {
    op.nodeId = op.targetNodeId;
    if (op.returning) {
      // Arrivée au parking : l'agent redevient disponible
      op.returning = false;
      op.state = 'idle';
      hooks.onState?.(op.id, 'idle', now);
      tryAssign();
      return;
    }
    if (op.stopIndex < op.mission.stops.length) {
      // Arrivée à un emplacement : prélèvement de toutes les lignes de
      // l'arrêt, avec surcoût d'élévation pour les niveaux hauts
      const stop = op.mission.stops[op.stopIndex];
      op.state = 'picking';
      hooks.onState?.(op.id, 'picking', now);
      const duration = stop.lines.reduce((sum, line) => sum
        + scenario.pickTimePerLineSec
        + ((line.level ?? 1) - 1) * scenario.liftTimePerLevelSec, 0);
      queue.push(now + duration, 'opPickDone', { opId: op.id });
    } else {
      // Arrivée à une cible de dépose
      op.state = 'dropping';
      hooks.onState?.(op.id, 'dropping', now);
      queue.push(now + scenario.dropTimeSec, 'opDropDone', { opId: op.id });
    }
  }

  function onOpPickDone(op) {
    const stop = op.mission.stops[op.stopIndex];
    for (const line of stop.lines) line.state = 'picked';
    op.linesPicked += stop.lines.length;
    op.stopIndex++;
    if (op.stopIndex < op.mission.stops.length) {
      travelTo(op, op.mission.stops[op.stopIndex].nodeId);
    } else {
      travelTo(op, op.mission.drops[0].nodeId);
    }
  }

  function onOpDropDone(op) {
    const drop = op.mission.drops[op.dropIndex];
    const touchedOrders = new Set();
    for (const line of drop.lines) {
      line.state = 'dropped';
      touchedOrders.add(line.orderId);
    }
    // Une commande est terminée quand toutes ses lignes sont déposées
    for (const orderId of touchedOrders) {
      const order = orders[orderId - 1];
      if (order.completedAt === null && order.lines.every((l) => l.state === 'dropped')) {
        order.completedAt = now;
      }
    }
    op.dropIndex++;
    if (op.dropIndex < op.mission.drops.length) {
      travelTo(op, op.mission.drops[op.dropIndex].nodeId);
    } else {
      // Mission terminée : l'opérateur redevient disponible
      op.busyTime += now - op.busySince;
      op.busySince = null;
      op.mission = null;
      op.state = 'idle';
      hooks.onState?.(op.id, 'idle', now);
      tryAssign();
      // Toujours inactif après l'affectation : retour au parking (trajet
      // à vide, hors temps de mission — il compte dans la distance)
      if (op.state === 'idle' && op.nodeId !== op.startNodeId) {
        op.returning = true;
        travelTo(op, op.startNodeId);
      }
    }
  }

  // --- Boucle principale ---

  queue.push(randExponential(rng, orderRatePerSec), 'orderArrival');

  while (!queue.isEmpty() && queue.peekTime() <= durationSec) {
    const event = queue.pop();
    now = event.time;
    switch (event.type) {
      case 'orderArrival':
        onOrderArrival();
        break;
      case 'opArrive':
        onOpArrive(opById.get(event.payload.opId));
        break;
      case 'opPickDone':
        onOpPickDone(opById.get(event.payload.opId));
        break;
      case 'opDropDone':
        onOpDropDone(opById.get(event.payload.opId));
        break;
      default:
        throw new Error(`Type d'événement inconnu : ${event.type}`);
    }
    hooks.onEvent?.(event, { now, orders, operators });
  }

  // Clôture à l'horizon : les opérateurs encore en mission sont comptés
  // occupés jusqu'à la fin de la fenêtre simulée
  for (const op of operators) {
    if (op.busySince !== null) {
      op.busyTime += durationSec - op.busySince;
      op.busySince = null;
    }
  }

  const kpis = computeKpis({ orders, operators, durationSec });
  const traffic = [...edgeTraffic.entries()].map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });
  return { kpis, orders, operators, scenario, traffic };
}
