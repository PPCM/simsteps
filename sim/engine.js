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
  // --- Flux (phase 4) — tout est inactif par défaut ---
  replenishment: false, // stock fini : niveau 1 = picking, niveaux ≥ 2 = réserve
  slotCapacityUnits: 60, // contenu d'un emplacement picking / d'une palette
  replenishThresholdShare: 0.25, // seuil de déclenchement du réappro
  inboundTrucksPerDay: 0, // camions entrants (exige replenishment)
  palletsPerTruck: 10,
  palletHandlingSec: 30, // prise/dépose d'une palette
  packers: 0, // emballeurs (exige des zones tampon dans l'entrepôt)
  packTimePerOrderSec: 60, // emballage d'une commande au poste
  agvAutonomyHours: 4, // autonomie de batterie des engins automatisés
};

// Sous ce niveau de batterie, un engin automatisé rentre se recharger ;
// la recharge est trois fois plus rapide que la décharge
const BATTERY_THRESHOLD = 0.2;
const CHARGE_FACTOR = 3;

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

  // --- Stock et réserve (scenario.replenishment) ---
  // Niveau 1 = picking (porte les références, débité par les commandes),
  // niveaux ≥ 2 = réserve (une palette par emplacement, même référence
  // que l'emplacement picking de sa colonne rack + baie)
  const replenishment = scenario.replenishment === true;
  const pickingSlotIds = replenishment
    ? slotIds.filter((id) => slots.get(id).level === 1)
    : slotIds;
  const stock = new Map(); // emplacement picking → unités restantes
  const reservePallets = new Set(); // emplacements réserve pleins
  const reserveTargeted = new Set(); // réserves visées par un putaway en cours
  const reserveByColumn = new Map(); // emplacement picking → réserves de sa colonne
  const columnOfReserve = new Map(); // emplacement réserve → emplacement picking
  if (replenishment) {
    for (const [id, slot] of slots) {
      if (slot.level === 1) {
        stock.set(id, scenario.slotCapacityUnits);
        reserveByColumn.set(id, []);
      }
    }
    for (const [id, slot] of slots) {
      if (slot.level === 1) continue;
      // Même colonne = même id avec le niveau remplacé par 1
      const pickId = id.replace(/-\d+$/, '-1');
      if (!reserveByColumn.has(pickId)) continue;
      reserveByColumn.get(pickId).push(id);
      columnOfReserve.set(id, pickId);
      reservePallets.add(id); // réserve pleine au démarrage
    }
    for (const list of reserveByColumn.values()) {
      list.sort((a, b) => slots.get(a).level - slots.get(b).level);
    }
  }
  const pendingReplenish = new Set(); // emplacements picking en cours de réappro
  const waitingPallets = []; // palettes reçues sans réserve libre
  const counters = { replenishments: 0, putaways: 0, stockouts: 0 };

  // Références et rangement : tirage d'emplacements pondéré par la
  // rotation ABC, placement des classes selon le paramètre slotting.
  // Avec réapprovisionnement, seuls les emplacements picking en portent.
  const { drawSlot } = buildSlotting(warehouse, scenario.slotting, rng, pickingSlotIds);

  // Tirage tenant compte du stock : rejette les emplacements vides
  // (repli : premier emplacement encore approvisionné)
  function drawStockedSlot() {
    if (!replenishment) return drawSlot();
    for (let i = 0; i < 30; i++) {
      const slotId = drawSlot();
      if (stock.get(slotId) > 0) return slotId;
    }
    for (const slotId of pickingSlotIds) {
      if (stock.get(slotId) > 0) return slotId;
    }
    return null;
  }

  // Abscisse de chaque allée pour ordonner les tournées en serpentin
  const aisleX = new Map(warehouse.aisles.map((a) => [a.id, a.x]));

  /** @type {Array<object>} commandes créées, dans l'ordre d'arrivée */
  const orders = [];
  /** @type {Array<object>} missions construites en attente d'un opérateur */
  const missionQueue = [];
  let nextOrderId = 1;
  let nextMissionId = 1;
  let now = 0;

  // Entités de la flotte : les piétons sont les opérateurs (humains),
  // les autres types sont du matériel garé — un engin ne se déplace que
  // conduit par un opérateur venu le chercher à pied. Le piéton suit la
  // vitesse du scénario (rétro-compatibilité de speedMps).
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
        state: 'idle', // idle | moving | picking | dropping | driving (humain monté)
        mission: null,
        stopIndex: 0,
        dropIndex: 0,
        targetNodeId: null,
        distance: 0, // mètres parcourus
        busyTime: 0, // secondes en mission
        busySince: null,
        linesPicked: 0,
        route: null, // itinéraire en cours (tronçons)
        heldAisle: null, // allée verrouillée par cet engin
        waitTime: 0, // attente cumulée aux entrées d'allées
        battery: 1, // niveau de batterie (engins automatisés seulement)
        chargeTime: 0, // temps passé en recharge
        chargingSince: null,
        // Couplage opérateur ↔ engin
        mounting: null, // humain : engin vers lequel il marche
        driving: null, // humain : engin qu'il conduit
        driver: null, // engin : opérateur au volant
        reservedBy: null, // engin : opérateur en route pour le prendre
      });
    }
  }
  // Emballeurs : rôle à part (piétons rattachés aux ateliers), actifs
  // seulement si l'entrepôt a des zones tampon — sinon la dépose à
  // l'atelier termine la commande comme avant
  const usePacking = warehouse.buffers.length > 0 && scenario.packers > 0;
  const walkerProfile = {
    ...VEHICLES.pieton,
    speedMps: scenario.speedMps,
    speedLoadedMps: scenario.speedMps,
  };
  if (usePacking) {
    for (let i = 0; i < scenario.packers; i++) {
      const workshop = warehouse.workshops[i % warehouse.workshops.length];
      operators.push({
        id: `op-${operators.length + 1}`,
        vehicle: 'pieton',
        role: 'packer',
        profile: walkerProfile,
        nodeId: workshop.nodeId,
        startNodeId: workshop.nodeId,
        returning: false,
        state: 'idle',
        mission: null,
        job: null, // { phase: 'toBuffer' | 'toWorkshop', lines, workshopNodeId }
        stopIndex: 0,
        dropIndex: 0,
        targetNodeId: null,
        distance: 0,
        busyTime: 0,
        busySince: null,
        linesPicked: 0,
        route: null,
        heldAisle: null,
        waitTime: 0,
        battery: 1,
        chargeTime: 0,
        chargingSince: null,
        mounting: null,
        driving: null,
        driver: null,
        reservedBy: null,
      });
    }
  }
  const humans = operators.filter((o) => o.vehicle === 'pieton' && o.role !== 'packer');
  const packerPool = operators.filter((o) => o.role === 'packer');

  // Nœuds atteignables par gabarit et classe d'agent (les voies
  // réservées filtrent piétons et engins) — une passe par couple distinct
  const kindOf = (op) => (op.vehicle === 'pieton' ? 'pietons' : 'engins');
  const reachByWidth = new Map();
  const reachOf = (op) => reachByWidth.get(`${op.profile.aisleWidthM}|${kindOf(op)}`);
  for (const op of operators) {
    const key = `${op.profile.aisleWidthM}|${kindOf(op)}`;
    if (!reachByWidth.has(key)) {
      reachByWidth.set(
        key,
        graph.reachableFrom(warehouse.shippingNodeId, op.profile.aisleWidthM, kindOf(op))
      );
    }
  }

  // Stationnement : chaque entité démarre au parking atteignable le
  // plus proche de l'expédition qui admet son type d'engin (à défaut,
  // l'expédition) et y retournera à l'inactivité
  for (const op of operators) {
    if (op.role === 'packer') continue; // point d'appel : son atelier
    const reach = reachOf(op);
    let best = null;
    for (const parking of warehouse.parkings) {
      if (parking.vehicles !== undefined && !parking.vehicles.includes(op.vehicle)) continue;
      if (!reach.has(parking.nodeId)) continue;
      const d = graph.distance(warehouse.shippingNodeId, parking.nodeId);
      if (best === null || d < best.d) best = { nodeId: parking.nodeId, d };
    }
    if (best !== null) {
      op.startNodeId = best.nodeId;
      op.nodeId = best.nodeId;
    }
  }

  // Une entité peut-elle réaliser une mission ? Levée suffisante pour le
  // niveau le plus haut, et tous les arrêts/déposes dans son gabarit.
  function compatible(op, mission) {
    if (mission.requiredLiftM > op.profile.liftM + 1e-9) return false;
    const reach = reachOf(op);
    return mission.nodes.every((nodeId) => reach.has(nodeId));
  }

  // Capacités du piéton de référence : décide si une mission est
  // faisable à pied (sinon elle exige un engin, donc un conducteur)
  const walkerReach = graph.reachableFrom(warehouse.shippingNodeId, VEHICLES.pieton.aisleWidthM, 'pietons');
  function footCompatible(requiredLiftM, nodes) {
    return requiredLiftM <= VEHICLES.pieton.liftM + 1e-9
      && nodes.every((nodeId) => walkerReach.has(nodeId));
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
      // Avec emballeurs : dépose au tampon, l'atelier emballera ensuite
      drops.push({
        nodeId: nearest(usePacking ? warehouse.buffers : warehouse.workshops).nodeId,
        lines: b2cLines,
        packing: usePacking,
      });
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

    return {
      id: nextMissionId++,
      kind: 'orders',
      lines,
      stops,
      drops,
      requiredLiftM,
      nodes,
      footCompatible: footCompatible(requiredLiftM, nodes),
    };
  }

  // --- Missions de flux : réapprovisionnement et rangement (putaway) ---

  // Descend une palette de la réserve vers l'emplacement picking de sa
  // colonne (même nœud : le mouvement est vertical). Prioritaire.
  function maybeReplenish(pickSlotId) {
    if (!replenishment || pendingReplenish.has(pickSlotId)) return;
    if (stock.get(pickSlotId) > scenario.replenishThresholdShare * scenario.slotCapacityUnits) return;
    const reserveSlotId = (reserveByColumn.get(pickSlotId) ?? [])
      .find((id) => reservePallets.has(id));
    if (reserveSlotId === undefined) return; // rien en réserve : putaway attendu
    const slot = slots.get(reserveSlotId);
    const requiredLiftM = (slot.level - 1) * slot.levelHeight;
    pendingReplenish.add(pickSlotId);
    missionQueue.unshift({
      id: nextMissionId++,
      kind: 'replenish',
      lines: [],
      stops: [{ nodeId: slot.nodeId, slotId: reserveSlotId, level: slot.level, levelHeight: slot.levelHeight }],
      drops: [{ nodeId: slot.nodeId, slotId: pickSlotId }],
      requiredLiftM,
      nodes: [slot.nodeId],
      footCompatible: false, // une palette exige un engin
    });
    tryAssign();
  }

  // Range une palette reçue vers une réserve libre : celle de la colonne
  // de sa référence de préférence, sinon n'importe laquelle
  function placePallet(pallet) {
    let target = (reserveByColumn.get(pallet.pickSlotId) ?? [])
      .find((id) => !reservePallets.has(id) && !reserveTargeted.has(id));
    if (target === undefined) {
      target = [...columnOfReserve.keys()]
        .find((id) => !reservePallets.has(id) && !reserveTargeted.has(id));
    }
    if (target === undefined) {
      waitingPallets.push(pallet); // réserve saturée : la palette attend à quai
      return;
    }
    const slot = slots.get(target);
    const dock = warehouse.receivings.reduce((best, r) =>
      graph.distance(r.nodeId, slot.nodeId) < graph.distance(best.nodeId, slot.nodeId) ? r : best);
    reserveTargeted.add(target);
    missionQueue.push({
      id: nextMissionId++,
      kind: 'putaway',
      pallet,
      lines: [],
      stops: [{ nodeId: dock.nodeId }],
      drops: [{ nodeId: slot.nodeId, slotId: target, level: slot.level, levelHeight: slot.levelHeight }],
      requiredLiftM: (slot.level - 1) * slot.levelHeight,
      nodes: [dock.nodeId, slot.nodeId],
      footCompatible: false,
    });
    tryAssign();
  }

  function onTruckArrival() {
    for (let i = 0; i < scenario.palletsPerTruck; i++) {
      // La palette porte la référence d'un emplacement picking tiré par
      // rotation : la réserve suit la demande
      placePallet({ pickSlotId: drawSlot() });
    }
    scheduleNextTruck();
  }

  // --- Emballage : dépose au tampon → l'emballeur ramène à l'atelier ---

  // Convoyeurs : chaque tampon source transporte automatiquement ses
  // déposes vers l'atelier rattaché (débit d'entrée fixe + parcours)
  const conveyorByBuffer = new Map();
  for (const conveyor of warehouse.conveyors ?? []) {
    if (!conveyorByBuffer.has(conveyor.sourceBufferId)) {
      conveyorByBuffer.set(conveyor.sourceBufferId, { ...conveyor, lastEntry: -Infinity });
    }
  }
  let conveyed = 0;

  function onConveyorArrive(payload) {
    conveyed++;
    packJobs.push({ lines: payload.lines, bufferNodeId: payload.workshopNodeId });
    tryAssignPackers();
  }

  const packJobs = []; // travaux d'emballage en attente d'un emballeur
  function tryAssignPackers() {
    while (packJobs.length > 0) {
      const idle = packerPool.filter((p) => p.state === 'idle');
      if (idle.length === 0) break;
      const job = packJobs.shift();
      const packer = nearestOf(idle, job.bufferNodeId);
      // Le poste d'emballage : l'atelier le plus proche du tampon
      const workshop = warehouse.workshops.reduce((best, w) =>
        graph.distance(w.nodeId, job.bufferNodeId) < graph.distance(best.nodeId, job.bufferNodeId) ? w : best);
      packer.job = { phase: 'toBuffer', lines: job.lines, workshopNodeId: workshop.nodeId };
      packer.busySince = now;
      travelTo(packer, job.bufferNodeId);
    }
  }

  const truckRatePerSec = scenario.inboundTrucksPerDay / 86400;
  function scheduleNextTruck() {
    if (!replenishment || truckRatePerSec <= 0) return;
    const next = now + randExponential(rng, truckRatePerSec);
    if (next <= durationSec) queue.push(next, 'truckArrival');
  }

  // --- Affectation des missions aux opérateurs inactifs ---

  // Lance l'exécution d'une mission par une entité (humain à pied ou
  // engin déjà conduit)
  function startMission(op, mission) {
    op.mission = mission;
    op.stopIndex = 0;
    op.dropIndex = 0;
    if (op.busySince === null) op.busySince = now;
    travelTo(op, mission.stops[0].nodeId);
  }

  // Le plus proche d'un nœud, à vol d'oiseau (heuristique d'affectation)
  function nearestOf(candidates, nodeId) {
    let best = candidates[0];
    for (const op of candidates) {
      if (graph.distance(op.nodeId, nodeId) < graph.distance(best.nodeId, nodeId)) best = op;
    }
    return best;
  }

  function tryAssign() {
    while (true) {
      const idleHumans = humans.filter((o) => o.state === 'idle');
      if (idleHumans.length === 0) break;
      // Planifie des missions de commandes dès qu'il n'y en a plus en
      // file (les missions de flux — réappro, putaway — n'y font pas
      // obstacle : elles peuvent attendre un engin longtemps)
      if (!missionQueue.some((m) => m.kind === 'orders')) {
        const planned = strategy.plan(orders, idleHumans.length, { waveSize: scenario.waveSize });
        if (planned.length === 0 && missionQueue.length === 0) break;
        for (const lines of planned) {
          for (const line of lines) line.state = 'planned';
          missionQueue.push(buildMission(lines));
        }
      }
      let assigned = false;
      for (let m = 0; m < missionQueue.length; m++) {
        const mission = missionQueue[m];
        // 1) Mission faisable à pied : l'opérateur le plus proche y va
        if (mission.footCompatible) {
          const best = nearestOf(idleHumans, mission.stops[0].nodeId);
          missionQueue.splice(m, 1);
          startMission(best, mission);
          assigned = true;
          break;
        }
        // 2) Mission exigeant un engin : un opérateur libre marche
        //    jusqu'à un engin libre compatible et le conduit. À
        //    compatibilité égale, l'engin le moins utilisé est choisi
        //    (rotation de charge dans la flotte, déterministe)
        const machine = operators.reduce((best, o) => (
          o.vehicle !== 'pieton' && o.state === 'idle' && o.reservedBy === null
            && compatible(o, mission) && (best === null || o.busyTime < best.busyTime)
            ? o : best
        ), null);
        if (machine && VEHICLES[machine.vehicle].automated === true) {
          // Engin automatisé : la mission démarre sans conducteur
          missionQueue.splice(m, 1);
          startMission(machine, mission);
          assigned = true;
          break;
        }
        if (machine) {
          const driver = nearestOf(idleHumans, machine.nodeId);
          const walkReach = reachOf(driver);
          if (walkReach.has(machine.nodeId)) {
            missionQueue.splice(m, 1);
            machine.reservedBy = driver;
            machine.mission = mission; // en attente du conducteur
            driver.mounting = machine;
            driver.busySince = now;
            travelTo(driver, machine.nodeId);
            assigned = true;
            break;
          }
          continue; // engin injoignable à pied : la mission attendra
        }
        // 3) Irréalisable par toute la flotte (aucun engin compatible,
        //    ou aucun opérateur pour le conduire) : abandon définitif
        const anyMachine = operators.some((o) => o.vehicle !== 'pieton' && compatible(o, mission));
        if (!anyMachine || humans.length === 0) {
          missionQueue.splice(m, 1);
          m--;
          for (const line of mission.lines) line.state = 'unreachable';
          // Missions de flux abandonnées : libère leurs réservations
          if (mission.kind === 'replenish') pendingReplenish.delete(mission.drops[0].slotId);
          if (mission.kind === 'putaway') {
            reserveTargeted.delete(mission.drops[0].slotId);
            waitingPallets.push(mission.pallet);
          }
        }
        // sinon : les engins compatibles sont occupés, la mission attend
      }
      if (!assigned) break;
    }
  }

  // --- Déplacements sur le graphe ---

  // Trafic agrégé par arête (clé canonique "a|b") : nombre de traversées,
  // stocké avec chaque run pour la heatmap et le diagramme spaghetti
  const edgeTraffic = new Map();

  // --- Exclusivité d'allée (congestion) ---
  // Un engin dont le gabarit dépasse la moitié de la largeur du couloir
  // d'allée ne peut pas y être croisé : il verrouille l'allée qu'il
  // traverse, les autres agents (piétons compris) attendent aux
  // extrémités. Les piétons ne verrouillent jamais. Sans engin de ce
  // gabarit dans la flotte, aucune allée n'est verrouillable et les
  // déplacements restent d'un seul tenant (comportement historique).
  const aisleWidthById = new Map(warehouse.aisles.map((a) => [a.id, a.width ?? 1.4]));
  function needsLock(op, aisleId) {
    return op.vehicle !== 'pieton'
      && op.profile.aisleWidthM > aisleWidthById.get(aisleId) / 2 + 1e-9;
  }
  const lockableAisles = new Set();
  for (const aisleId of aisleWidthById.keys()) {
    if (operators.some((op) => needsLock(op, aisleId))) lockableAisles.add(aisleId);
  }
  // Segment d'un nœud : l'allée verrouillable qui le porte, sinon null
  function segmentOf(nodeId) {
    const sep = nodeId.indexOf(':b');
    if (sep <= 0) return null;
    const aisleId = nodeId.slice(0, sep);
    return lockableAisles.has(aisleId) ? aisleId : null;
  }
  const aisleLocks = new Map(); // allée → { holder, queue: [{ op, since }] }
  function lockFor(aisleId) {
    if (!aisleLocks.has(aisleId)) aisleLocks.set(aisleId, { holder: null, queue: [] });
    return aisleLocks.get(aisleId);
  }

  function releaseAisle(op) {
    const lock = lockFor(op.heldAisle);
    const aisleId = op.heldAisle;
    op.heldAisle = null;
    lock.holder = null;
    // Réveil de la file : les piétons en tête passent, le premier
    // verrouilleur reprend le verrou et referme l'allée
    while (lock.queue.length > 0 && lock.holder === null) {
      const { op: waiter, since } = lock.queue.shift();
      waiter.waitTime += now - since;
      if (needsLock(waiter, aisleId)) {
        lock.holder = waiter.id;
        waiter.heldAisle = aisleId;
      }
      startLeg(waiter, { resumed: true });
    }
  }

  function travelTo(op, targetNodeId) {
    const route = graph.shortestPath(op.nodeId, targetNodeId, {
      minWidth: op.profile.aisleWidthM,
      kind: kindOf(op),
    });
    if (!route) throw new Error(`Aucun chemin de ${op.nodeId} vers ${targetNodeId}`);
    for (let i = 1; i < route.path.length; i++) {
      const key = [route.path[i - 1], route.path[i]].sort().join('|');
      edgeTraffic.set(key, (edgeTraffic.get(key) ?? 0) + 1);
    }
    op.targetNodeId = targetNodeId;
    op.distance += route.distance;
    op.route = { path: route.path, index: 0 };
    startLeg(op);
  }

  // Lance le prochain tronçon de l'itinéraire : jusqu'à l'entrée ou la
  // sortie d'une allée verrouillable (ou l'arrivée). L'attente à
  // l'entrée d'une allée tenue se fait en file FIFO.
  function startLeg(op, { resumed = false } = {}) {
    const { path } = op.route;
    const index = op.route.index;
    if (index >= path.length - 1) {
      // Chemin d'un seul nœud : arrivée immédiate — mais l'agent passe
      // bien par l'état moving, sans quoi l'affectation le croirait
      // encore disponible dans la même passe
      op.state = 'moving';
      hooks.onState?.(op.id, 'moving', now);
      hooks.onTravel?.(op.id, path.slice(index), now, 0, 0);
      queue.push(now, 'opArrive', { opId: op.id });
      return;
    }
    const target = segmentOf(path[index + 1]);
    // Quitte l'allée tenue dès le départ du tronçon suivant
    if (op.heldAisle !== null && target !== op.heldAisle) releaseAisle(op);
    if (target !== null && op.heldAisle !== target && !resumed) {
      const lock = lockFor(target);
      if (lock.holder !== null && lock.holder !== op.id) {
        op.state = 'waiting';
        hooks.onState?.(op.id, 'waiting', now);
        lock.queue.push({ op, since: now });
        return;
      }
      if (needsLock(op, target)) {
        lock.holder = op.id;
        op.heldAisle = target;
      }
    }
    let j = index + 1;
    while (j + 1 < path.length && segmentOf(path[j + 1]) === target) j++;
    let legDistance = 0;
    for (let i = index + 1; i <= j; i++) {
      legDistance += graph.distance(path[i - 1], path[i]);
    }
    op.state = 'moving';
    // En charge après le premier prélèvement de la mission
    const loaded = op.mission !== null && op.stopIndex > 0;
    const duration = legDistance / (loaded ? op.profile.speedLoadedMps : op.profile.speedMps);
    hooks.onState?.(op.id, 'moving', now);
    hooks.onTravel?.(op.id, path.slice(index, j + 1), now, legDistance, duration);
    const event = j === path.length - 1 ? 'opArrive' : 'opLeg';
    queue.push(now + duration, event, { opId: op.id, legEnd: j });
  }

  function onOpLeg(op, legEnd) {
    op.route.index = legEnd;
    op.nodeId = op.route.path[legEnd];
    startLeg(op);
  }

  // --- Gestion des événements ---

  const opById = new Map(operators.map((o) => [o.id, o]));

  function onOrderArrival() {
    // Rupture générale : plus aucun emplacement picking approvisionné,
    // la commande est perdue (le réappro ou un camion la sauverait)
    if (replenishment && !pickingSlotIds.some((id) => stock.get(id) > 0)) {
      counters.stockouts++;
      scheduleNextArrival();
      return;
    }
    const profile = drawProfile(rng, scenario.b2cShare);
    const base = makeOrder(rng, {
      id: nextOrderId++,
      profile,
      slotIds: pickingSlotIds,
      drawSlot: drawStockedSlot,
      b2bClients: scenario.b2bClients,
    });
    if (base.lines.length === 0) {
      nextOrderId--; // commande abandonnée : rend l'identifiant
      counters.stockouts++;
      scheduleNextArrival();
      return;
    }
    // Débit du stock à la création (réservation de la demande)
    if (replenishment) {
      for (const line of base.lines) {
        stock.set(line.slotId, Math.max(0, stock.get(line.slotId) - line.qty));
        maybeReplenish(line.slotId);
      }
    }
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

  // Recharge d'un engin automatisé à sa station (son parking) : trois
  // fois plus rapide que la décharge, mission possible seulement une
  // fois plein
  function beginCharge(op) {
    op.state = 'charging';
    op.chargingSince = now;
    hooks.onState?.(op.id, 'charging', now);
    const duration = (1 - op.battery) * scenario.agvAutonomyHours * 3600 / CHARGE_FACTOR;
    queue.push(now + duration, 'chargeDone', { opId: op.id });
  }

  function onChargeDone(op) {
    op.battery = 1;
    op.chargeTime += now - op.chargingSince;
    op.chargingSince = null;
    op.state = 'idle';
    hooks.onState?.(op.id, 'idle', now);
    tryAssign();
  }

  // L'engin rendu à son parking : le conducteur redescend et rentre à
  // pied à son point d'appel
  function dismount(machine) {
    machine.state = 'idle';
    hooks.onState?.(machine.id, 'idle', now);
    const driver = machine.driver;
    machine.driver = null;
    driver.driving = null;
    driver.nodeId = machine.nodeId;
    if (driver.nodeId !== driver.startNodeId) {
      driver.returning = true;
      travelTo(driver, driver.startNodeId);
    } else {
      driver.busyTime += now - driver.busySince;
      driver.busySince = null;
      driver.state = 'idle';
      hooks.onState?.(driver.id, 'idle', now);
    }
    tryAssign(); // l'engin libéré (et peut-être l'opérateur) peuvent resservir
  }

  function onOpArrive(op) {
    op.nodeId = op.targetNodeId;
    if (op.mounting !== null) {
      // L'opérateur atteint l'engin : il monte et la mission démarre
      const machine = op.mounting;
      op.mounting = null;
      op.driving = machine;
      machine.driver = op;
      machine.reservedBy = null;
      op.state = 'driving';
      hooks.onState?.(op.id, 'driving', now);
      const mission = machine.mission;
      machine.mission = null;
      startMission(machine, mission);
      return;
    }
    if (op.role === 'packer' && op.job !== null) {
      if (op.job.phase === 'toBuffer') {
        // Au tampon : récupération du travail à emballer
        op.state = 'picking';
        hooks.onState?.(op.id, 'picking', now);
        queue.push(now + scenario.dropTimeSec, 'opPickDone', { opId: op.id });
      } else {
        // Au poste : emballage (une durée par commande distincte)
        op.state = 'dropping';
        hooks.onState?.(op.id, 'dropping', now);
        const orderCount = new Set(op.job.lines.map((l) => l.orderId)).size;
        queue.push(now + orderCount * scenario.packTimePerOrderSec, 'opDropDone', { opId: op.id });
      }
      return;
    }
    if (op.returning) {
      // Arrivée au parking ou au point d'appel
      op.returning = false;
      if (op.vehicle !== 'pieton' && op.driver !== null) {
        dismount(op);
        return;
      }
      if (op.busySince !== null) {
        // Fin d'épisode de conduite : l'opérateur est rentré à pied
        op.busyTime += now - op.busySince;
        op.busySince = null;
      }
      if (op.vehicle !== 'pieton' && VEHICLES[op.vehicle].automated === true
          && op.battery <= BATTERY_THRESHOLD) {
        beginCharge(op);
        return;
      }
      op.state = 'idle';
      hooks.onState?.(op.id, 'idle', now);
      tryAssign();
      return;
    }
    if (op.stopIndex < op.mission.stops.length) {
      // Arrivée à un point de prise : lignes de commande (avec surcoût
      // d'élévation), palette en réserve (réappro) ou palette à quai
      const stop = op.mission.stops[op.stopIndex];
      op.state = 'picking';
      hooks.onState?.(op.id, 'picking', now);
      let duration;
      if (op.mission.kind === 'replenish') {
        duration = scenario.pickTimePerLineSec + (stop.level - 1) * scenario.liftTimePerLevelSec;
      } else if (op.mission.kind === 'putaway') {
        duration = scenario.palletHandlingSec;
      } else {
        duration = stop.lines.reduce((sum, line) => sum
          + scenario.pickTimePerLineSec
          + ((line.level ?? 1) - 1) * scenario.liftTimePerLevelSec, 0);
      }
      queue.push(now + duration, 'opPickDone', { opId: op.id });
    } else {
      // Arrivée à une cible de dépose (montée en réserve pour un putaway)
      const drop = op.mission.drops[op.dropIndex];
      op.state = 'dropping';
      hooks.onState?.(op.id, 'dropping', now);
      const duration = op.mission.kind === 'putaway'
        ? scenario.palletHandlingSec + (drop.level - 1) * scenario.liftTimePerLevelSec
        : scenario.dropTimeSec;
      queue.push(now + duration, 'opDropDone', { opId: op.id });
    }
  }

  function onOpPickDone(op) {
    if (op.role === 'packer' && op.job !== null) {
      op.job.phase = 'toWorkshop';
      travelTo(op, op.job.workshopNodeId);
      return;
    }
    const stop = op.mission.stops[op.stopIndex];
    if (op.mission.kind === 'replenish') {
      // Palette descendue : la réserve se libère, une palette à quai
      // peut désormais y être rangée
      reservePallets.delete(stop.slotId);
      if (waitingPallets.length > 0) placePallet(waitingPallets.shift());
    }
    for (const line of stop.lines ?? []) line.state = 'picked';
    op.linesPicked += (stop.lines ?? []).length;
    op.stopIndex++;
    if (op.stopIndex < op.mission.stops.length) {
      travelTo(op, op.mission.stops[op.stopIndex].nodeId);
    } else {
      travelTo(op, op.mission.drops[0].nodeId);
    }
  }

  // Termine des lignes déposées et clôt les commandes complètes
  function completeLines(lines) {
    const touchedOrders = new Set();
    for (const line of lines) {
      line.state = 'dropped';
      touchedOrders.add(line.orderId);
    }
    for (const orderId of touchedOrders) {
      const order = orders[orderId - 1];
      if (order.completedAt === null && order.lines.every((l) => l.state === 'dropped')) {
        order.completedAt = now;
      }
    }
  }

  function onOpDropDone(op) {
    if (op.role === 'packer' && op.job !== null) {
      // Emballage terminé : les commandes du travail sont finalisées
      completeLines(op.job.lines);
      op.job = null;
      op.busyTime += now - op.busySince;
      op.busySince = null;
      op.state = 'idle';
      hooks.onState?.(op.id, 'idle', now);
      tryAssignPackers();
      if (op.state === 'idle' && op.nodeId !== op.startNodeId) {
        op.returning = true;
        travelTo(op, op.startNodeId);
      }
      return;
    }
    const drop = op.mission.drops[op.dropIndex];
    if (op.mission.kind === 'replenish') {
      // La palette recharge l'emplacement picking
      stock.set(drop.slotId, (stock.get(drop.slotId) ?? 0) + scenario.slotCapacityUnits);
      pendingReplenish.delete(drop.slotId);
      counters.replenishments++;
    } else if (op.mission.kind === 'putaway') {
      // La palette rejoint la réserve — le picking de la colonne
      // attendait peut-être ce stock
      reserveTargeted.delete(drop.slotId);
      reservePallets.add(drop.slotId);
      counters.putaways++;
      maybeReplenish(columnOfReserve.get(drop.slotId));
    }
    if (drop.packing) {
      // Dépose au tampon : les lignes attendent l'emballage — par
      // convoyeur (débit fixe puis temps de parcours) s'il y en a un,
      // sinon un emballeur viendra les chercher à pied
      for (const line of drop.lines) line.state = 'staged';
      const conveyor = conveyorByBuffer.get(drop.nodeId);
      if (conveyor !== undefined) {
        const entry = Math.max(now, conveyor.lastEntry + 60 / conveyor.throughputPerMin);
        conveyor.lastEntry = entry;
        queue.push(entry + conveyor.transitSec, 'conveyorArrive', {
          lines: drop.lines, workshopNodeId: conveyor.sinkNodeId,
        });
      } else {
        packJobs.push({ lines: drop.lines, bufferNodeId: drop.nodeId });
        tryAssignPackers();
      }
    } else {
      // Une commande est terminée quand toutes ses lignes sont déposées
      completeLines(drop.lines ?? []);
    }
    op.dropIndex++;
    if (op.dropIndex < op.mission.drops.length) {
      travelTo(op, op.mission.drops[op.dropIndex].nodeId);
    } else {
      // Mission terminée
      const missionBusySec = now - op.busySince;
      op.busyTime += missionBusySec;
      op.busySince = null;
      op.mission = null;
      if (op.vehicle !== 'pieton') {
        // Engin automatisé : la batterie se décharge au temps de
        // mission ; sous le seuil, retour à la station de charge
        // (le parking) sans enchaîner
        if (VEHICLES[op.vehicle].automated === true) {
          op.battery = Math.max(0, op.battery - missionBusySec / (scenario.agvAutonomyHours * 3600));
          if (op.battery <= BATTERY_THRESHOLD) {
            if (op.nodeId !== op.startNodeId) {
              op.returning = true;
              travelTo(op, op.startNodeId);
            } else {
              beginCharge(op);
            }
            return;
          }
        }
        // L'engin enchaîne une mission qui l'exige encore, sans que le
        // conducteur redescende ; sinon il rentre se garer
        const next = missionQueue.findIndex((m) => !m.footCompatible && compatible(op, m));
        if (next >= 0) {
          const mission = missionQueue.splice(next, 1)[0];
          startMission(op, mission);
          return;
        }
        if (op.nodeId !== op.startNodeId) {
          op.returning = true;
          travelTo(op, op.startNodeId);
        } else if (VEHICLES[op.vehicle].automated === true) {
          // Déjà à sa station et batterie suffisante : disponible
          op.state = 'idle';
          hooks.onState?.(op.id, 'idle', now);
          tryAssign();
        } else {
          dismount(op);
        }
        return;
      }
      op.state = 'idle';
      hooks.onState?.(op.id, 'idle', now);
      tryAssign();
      // Toujours inactif après l'affectation : retour au point d'appel
      // (trajet à vide, hors temps de mission — il compte dans la distance)
      if (op.state === 'idle' && op.nodeId !== op.startNodeId) {
        op.returning = true;
        travelTo(op, op.startNodeId);
      }
    }
  }

  // --- Boucle principale ---

  queue.push(randExponential(rng, orderRatePerSec), 'orderArrival');
  scheduleNextTruck();

  while (!queue.isEmpty() && queue.peekTime() <= durationSec) {
    const event = queue.pop();
    now = event.time;
    switch (event.type) {
      case 'orderArrival':
        onOrderArrival();
        break;
      case 'truckArrival':
        onTruckArrival();
        break;
      case 'chargeDone':
        onChargeDone(opById.get(event.payload.opId));
        break;
      case 'conveyorArrive':
        onConveyorArrive(event.payload);
        break;
      case 'opLeg':
        onOpLeg(opById.get(event.payload.opId), event.payload.legEnd);
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
    if (op.chargingSince !== null) {
      op.chargeTime += durationSec - op.chargingSince;
      op.chargingSince = null;
    }
  }

  const kpis = {
    ...computeKpis({ orders, operators, durationSec }),
    // Attente cumulée aux entrées d'allées verrouillées (congestion)
    waitingTimeSec: operators.reduce((sum, op) => sum + op.waitTime, 0),
    // Recharge cumulée des engins automatisés
    chargingTimeSec: operators.reduce((sum, op) => sum + op.chargeTime, 0),
    // Travaux transportés par convoyeur (si l'entrepôt en a)
    ...(conveyorByBuffer.size > 0 && { conveyed }),
    // Compteurs de flux (uniquement pertinents avec réapprovisionnement)
    ...(replenishment && { ...counters, palletsWaiting: waitingPallets.length }),
  };
  const traffic = [...edgeTraffic.entries()].map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });
  return { kpis, orders, operators, scenario, traffic };
}
