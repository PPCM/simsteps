// Mode comparaison : mise en forme côte à côte des KPI de deux runs
// (scénarios exécutés localement ou runs enregistrés en base).
// Module pur, testable sous Node.

const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return min > 0 ? `${min} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

// Les 6 indicateurs du tableau de bord + le volume traité.
// « better » : sens d'une amélioration (more | less | neutral)
export const KPI_ROWS = [
  { key: 'ordersCompleted', label: 'Commandes traitées', better: 'more', format: (v) => int.format(v) },
  { key: 'ordersPerHour', label: 'Commandes / h', better: 'more', format: (v) => num.format(v) },
  { key: 'linesPerHour', label: 'Lignes / h', better: 'more', format: (v) => num.format(v) },
  { key: 'avgDistancePerOperatorM', label: 'Distance moy. / op.', better: 'neutral', format: (v) => `${int.format(v)} m` },
  { key: 'occupancyRate', label: 'Occupation', better: 'more', format: (v) => `${num.format(v * 100)} %` },
  { key: 'avgCycleTimeSec', label: 'Cycle moyen', better: 'less', format: formatDuration },
  { key: 'pendingOrders', label: 'Non terminées', better: 'less', format: (v) => int.format(v) },
];

/**
 * Construit les lignes du tableau comparatif.
 * @param {object} kpisA KPI du run A
 * @param {object} kpisB KPI du run B
 * @returns {Array<{label: string, a: string, b: string, delta: string, improved: boolean|null}>}
 *          improved : true si B améliore A, false s'il dégrade, null si
 *          neutre ou incomparable
 */
export function buildComparisonRows(kpisA, kpisB) {
  return KPI_ROWS.map(({ key, label, better, format }) => {
    const a = kpisA[key];
    const b = kpisB[key];
    let delta = '—';
    let improved = null;
    if (a !== null && b !== null && a !== undefined && b !== undefined && a !== 0) {
      const pct = ((b - a) / a) * 100;
      delta = Math.abs(pct) < 0.05 ? '=' : `${pct > 0 ? '+' : ''}${num.format(pct)} %`;
      if (better !== 'neutral' && Math.abs(pct) >= 0.05) {
        improved = better === 'more' ? b > a : b < a;
      }
    }
    return {
      label,
      a: a === null || a === undefined ? '—' : format(a),
      b: b === null || b === undefined ? '—' : format(b),
      delta,
      improved,
    };
  });
}
