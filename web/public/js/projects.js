// Logique pure des projets côté client : séparation des paramétrages
// entre les trois curseurs du panneau et les autres paramètres de
// scénario (stratégie, vitesses, seed…), et fusion des paramètres
// effectifs de simulation. Module sans DOM : testable sous Node.

// Paramètres pilotés par les contrôles du panneau latéral (curseurs,
// compteurs d'engins de la flotte et sélecteur de rangement)
export const SLIDER_KEYS = ['operators', 'fleet', 'b2cShare', 'ordersPerHour', 'slotting'];

/**
 * Sépare les paramétrages d'un projet : ce qui pilote les curseurs
 * d'un côté, le reste (« extras ») de l'autre.
 * @param {object} settings paramétrages du projet
 * @returns {{sliders: object, extras: object}}
 */
export function splitSettings(settings = {}) {
  const sliders = {};
  const extras = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SLIDER_KEYS.includes(key)) sliders[key] = value;
    else extras[key] = value;
  }
  return { sliders, extras };
}

/**
 * Construit les paramétrages à persister : extras du projet + valeurs
 * courantes des curseurs.
 * @param {object} extras paramètres hors curseurs
 * @param {{operators: number, b2cShare: number, ordersPerHour: number}} sliderValues
 * @returns {object}
 */
export function buildSettings(extras, sliderValues) {
  return { ...extras, ...sliderValues };
}

/**
 * Paramètres effectifs de simulation : params du scénario, surchargés
 * par les extras du projet, surchargés par les curseurs.
 * @param {object} scenarioParams
 * @param {object} extras
 * @param {{operators: number, b2cShare: number, ordersPerHour: number}} sliderValues
 * @returns {object}
 */
export function mergeProjectParams(scenarioParams, extras, sliderValues) {
  return { ...scenarioParams, ...extras, ...sliderValues };
}
