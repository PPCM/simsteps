// Calcul et mise en forme des indicateurs de performance d'un run.

/**
 * Calcule les KPI agrégés d'une simulation terminée.
 * @param {{orders: Array, operators: Array, durationSec: number}} params
 */
export function computeKpis({ orders, operators, durationSec }) {
  const hours = durationSec / 3600;
  const completed = orders.filter((o) => o.completedAt !== null);
  const cycleTimes = completed.map((o) => o.completedAt - o.createdAt);
  const linesPicked = operators.reduce((sum, op) => sum + op.linesPicked, 0);
  const totalDistance = operators.reduce((sum, op) => sum + op.distance, 0);
  const busyTime = operators.reduce((sum, op) => sum + op.busyTime, 0);
  // Commandes en attente : aucune ligne encore prise en charge
  const waiting = orders.filter((o) => o.lines.every((l) => l.state === 'pending'));

  return {
    durationHours: hours,
    ordersCreated: orders.length,
    ordersCompleted: completed.length,
    ordersPerHour: completed.length / hours,
    linesPicked,
    linesPerHour: linesPicked / hours,
    totalDistanceM: totalDistance,
    avgDistancePerOperatorM: operators.length > 0 ? totalDistance / operators.length : 0,
    // L'indicateur du rangement : combien de mètres coûte une ligne ?
    distancePerLineM: linesPicked > 0 ? totalDistance / linesPicked : null,
    occupancyRate: operators.length > 0 ? busyTime / (operators.length * durationSec) : 0,
    avgCycleTimeSec: cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null,
    pendingOrders: orders.length - completed.length,
    waitingOrders: waiting.length,
  };
}

/**
 * Met en forme les KPI pour un affichage console lisible (français).
 * @param {object} kpis résultat de computeKpis()
 * @returns {string}
 */
export function formatKpis(kpis) {
  const rows = [
    ['Commandes créées', String(kpis.ordersCreated)],
    ['Commandes traitées', String(kpis.ordersCompleted)],
    ['Commandes traitées / h', kpis.ordersPerHour.toFixed(1)],
    ['Lignes prélevées / h', kpis.linesPerHour.toFixed(1)],
    ['Distance moyenne / opérateur', `${kpis.avgDistancePerOperatorM.toFixed(0)} m`],
    ['Distance par ligne', kpis.distancePerLineM !== null ? `${kpis.distancePerLineM.toFixed(1)} m` : '—'],
    ['Taux d’occupation des opérateurs', `${(kpis.occupancyRate * 100).toFixed(1)} %`],
    [
      'Temps moyen de cycle d’une commande',
      kpis.avgCycleTimeSec !== null ? formatDuration(kpis.avgCycleTimeSec) : '—',
    ],
    ...(kpis.waitingTimeSec > 0
      ? [['Attente aux allées (congestion)', formatDuration(kpis.waitingTimeSec)]]
      : []),
    ['Commandes non terminées', String(kpis.pendingOrders)],
    ['  dont jamais démarrées', String(kpis.waitingOrders)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

/** Formate une durée en secondes sous la forme « 12 min 34 s ». */
export function formatDuration(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return min > 0 ? `${min} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}
