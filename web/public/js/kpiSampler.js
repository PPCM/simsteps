// KPI « en direct » : pendant la simulation, un échantillonneur branché
// sur le hook onEvent capture les indicateurs à intervalle régulier.
// À la relecture, kpiAt(samples, t) restitue les KPI à l'instant courant.
// Module pur, testable sous Node.

/**
 * Calcule les KPI instantanés à l'instant simulé `now`.
 * Contrairement au calcul final, le temps d'occupation inclut la mission
 * en cours (busySince) pour éviter un taux artificiellement bas.
 * @param {Array} orders commandes créées jusqu'à `now`
 * @param {Array} operators opérateurs du moteur
 * @param {number} now temps simulé (secondes)
 */
export function computeLiveKpis(orders, operators, now) {
  const hours = now / 3600;
  const completed = orders.filter((o) => o.completedAt !== null);
  const linesPicked = operators.reduce((sum, op) => sum + op.linesPicked, 0);
  const totalDistance = operators.reduce((sum, op) => sum + op.distance, 0);
  const busyTime = operators.reduce(
    (sum, op) => sum + op.busyTime + (op.busySince !== null ? now - op.busySince : 0),
    0
  );
  const cycleTimes = completed.map((o) => o.completedAt - o.createdAt);

  return {
    ordersCreated: orders.length,
    ordersCompleted: completed.length,
    ordersPerHour: hours > 0 ? completed.length / hours : 0,
    linesPerHour: hours > 0 ? linesPicked / hours : 0,
    avgDistancePerOperatorM: operators.length > 0 ? totalDistance / operators.length : 0,
    occupancyRate: operators.length > 0 && now > 0 ? busyTime / (operators.length * now) : 0,
    avgCycleTimeSec:
      cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null,
    pendingOrders: orders.length - completed.length,
  };
}

/**
 * Crée un échantillonneur à brancher sur les hooks du moteur.
 * @param {number} intervalSec période d'échantillonnage (temps simulé)
 * @returns {{
 *   samples: Array<{t: number, kpis: object}>,
 *   hooks: {onEvent: Function},
 *   finish: (durationSec: number, orders: Array, operators: Array) => void
 * }}
 */
export function createKpiSampler(intervalSec) {
  const samples = [{ t: 0, kpis: computeLiveKpis([], [], 0) }];
  let nextT = intervalSec;

  return {
    samples,
    hooks: {
      onEvent(event, { now, orders, operators }) {
        if (now >= nextT) {
          samples.push({ t: now, kpis: computeLiveKpis(orders, operators, now) });
          // Saute les périodes creuses sans événement
          nextT = (Math.floor(now / intervalSec) + 1) * intervalSec;
        }
      },
    },
    // Échantillon final à l'horizon de la simulation
    finish(durationSec, orders, operators) {
      samples.push({ t: durationSec, kpis: computeLiveKpis(orders, operators, durationSec) });
    },
  };
}

/**
 * KPI applicables à l'instant t : dernier échantillon antérieur ou égal.
 */
export function kpiAt(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return samples[found].kpis;
}
