// Recalage assisté : retrouve le temps de prélèvement par ligne qui
// fait coller la productivité simulée (lignes/heure/opérateur) au
// chiffre observé dans le WMS. Le KPI décroît quand le temps de
// prélèvement augmente : recherche par bissection sur les valeurs
// entières du paramètre. La fonction de run est injectée — module pur,
// testable sous Node sans moteur.

/**
 * @param {(pickTimeSec: number) => number|Promise<number>} runKpi
 *        exécute une simulation avec ce temps de prélèvement et renvoie
 *        le KPI lignes/heure/opérateur
 * @param {number} target valeur observée à atteindre
 * @param {{min?: number, max?: number, tolerance?: number}} options
 *        bornes entières du paramètre et tolérance relative (0.05 = ±5 %)
 * @returns {Promise<{value: number, achieved: number, iterations: number,
 *          converged: boolean, flat: boolean}>} meilleure valeur trouvée ;
 *          flat : le KPI ne dépend pas du paramètre dans cette
 *          configuration (système sous-chargé — recalage sans objet)
 */
export async function calibrate(runKpi, target, { min = 1, max = 120, tolerance = 0.05 } = {}) {
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('La cible doit être un nombre strictement positif.');
  }
  let iterations = 0;
  let best = null;
  const evaluate = async (pickTime) => {
    const achieved = await runKpi(pickTime);
    iterations++;
    if (best === null || Math.abs(achieved - target) < Math.abs(best.achieved - target)) {
      best = { value: pickTime, achieved };
    }
    return achieved;
  };
  const within = () => Math.abs(best.achieved - target) <= tolerance * target;

  const fastest = await evaluate(min); // KPI maximal (prélèvement le plus court)
  const slowest = await evaluate(max); // KPI minimal
  // Réponse plate : le paramètre ne pilote pas le KPI (opérateurs
  // sous-chargés, productivité dictée par la demande) — toute valeur
  // « collerait », le recalage n'aurait aucun sens
  if (Math.abs(fastest - slowest) <= tolerance * Math.abs(fastest)) {
    return { ...best, iterations, converged: false, flat: true };
  }
  // Cible hors de la plage atteignable : la meilleure borne est
  // renvoyée avec converged=false
  if ((target > fastest || target < slowest) && !within()) {
    return { ...best, iterations, converged: false, flat: false };
  }

  let low = min;
  let high = max;
  while (high - low > 1 && !within()) {
    const middle = Math.floor((low + high) / 2);
    const achieved = await evaluate(middle);
    if (achieved >= target) low = middle; // encore trop productif : ralentir
    else high = middle;
  }
  return { ...best, iterations, converged: within(), flat: false };
}
