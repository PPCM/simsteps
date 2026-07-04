// Stratégies de picking : transforment les lignes de commandes en attente
// en missions (listes de lignes confiées à un opérateur). Chaque stratégie
// expose plan(orders, need, ctx) et renvoie au plus `need` missions sous
// forme de tableaux de lignes NON encore planifiées ; le moteur se charge
// de marquer les lignes et de construire les tournées.

/** Commande par commande : une mission = une commande entière, en FIFO. */
export const orderByOrder = {
  id: 'orderByOrder',
  label: 'Commande par commande',
  plan(orders, need) {
    const missions = [];
    for (const order of orders) {
      if (missions.length >= need) break;
      // Une commande est planifiable si aucune de ses lignes n'a démarré
      if (order.lines.every((l) => l.state === 'pending')) {
        missions.push([...order.lines]);
      }
    }
    return missions;
  },
};

/**
 * Vagues par zone : les lignes en attente sont regroupées par zone de
 * l'entrepôt (toutes commandes confondues) et servies par paquets d'au
 * plus `waveSize` lignes, zone la plus chargée d'abord.
 */
export const zoneWave = {
  id: 'zoneWave',
  label: 'Vagues par zone',
  plan(orders, need, { waveSize = 20 } = {}) {
    // Lignes en attente groupées par zone, dans l'ordre d'arrivée des commandes
    const byZone = new Map();
    for (const order of orders) {
      for (const line of order.lines) {
        if (line.state !== 'pending') continue;
        if (!byZone.has(line.zone)) byZone.set(line.zone, []);
        byZone.get(line.zone).push(line);
      }
    }
    // Zones les plus chargées d'abord pour lisser la congestion
    const zones = [...byZone.values()].sort((a, b) => b.length - a.length);
    const missions = [];
    for (const zoneLines of zones) {
      for (let i = 0; i < zoneLines.length && missions.length < need; i += waveSize) {
        missions.push(zoneLines.slice(i, i + waveSize));
      }
      if (missions.length >= need) break;
    }
    return missions;
  },
};

export const STRATEGIES = new Map([
  [orderByOrder.id, orderByOrder],
  [zoneWave.id, zoneWave],
]);

/** Résout une stratégie par identifiant, avec erreur explicite. */
export function getStrategy(id) {
  const strategy = STRATEGIES.get(id);
  if (!strategy) {
    throw new Error(`Stratégie inconnue : ${id} (disponibles : ${[...STRATEGIES.keys()].join(', ')})`);
  }
  return strategy;
}
