// Catalogue des profils d'engins de manutention. Chaque agent de la
// simulation porte un profil : vitesses à vide et en charge, hauteur de
// levée (borne les niveaux de rack accessibles) et largeur d'allée
// minimale (borne les voies empruntables — le routage filtre les arêtes
// du graphe par gabarit). Module pur, sans DOM ni base.

export const VEHICLES = {
  pieton: {
    label: 'Piéton',
    speedMps: 1.2,
    speedLoadedMps: 1.2,
    aisleWidthM: 1.1,
    liftM: 1.9,
  },
  transpalette: {
    label: 'Transpalette électrique',
    speedMps: 2.2,
    speedLoadedMps: 1.7,
    aisleWidthM: 1.9,
    liftM: 0.3,
  },
  gerbeur: {
    label: 'Gerbeur',
    speedMps: 1.6,
    speedLoadedMps: 1.3,
    aisleWidthM: 2.2,
    liftM: 5,
  },
  frontal: {
    label: 'Chariot frontal',
    speedMps: 3.5,
    speedLoadedMps: 2.8,
    aisleWidthM: 3.4,
    liftM: 6,
  },
  retractable: {
    label: 'Chariot rétractable',
    speedMps: 2.5,
    speedLoadedMps: 2.1,
    aisleWidthM: 2.7,
    liftM: 11,
  },
  vna: {
    label: 'Chariot tridirectionnel (VNA)',
    speedMps: 2.0,
    speedLoadedMps: 1.8,
    aisleWidthM: 1.6,
    liftM: 14,
  },
  preparateur: {
    label: 'Préparateur de commandes',
    speedMps: 2.0,
    speedLoadedMps: 1.7,
    aisleWidthM: 1.9,
    liftM: 10,
  },
};

/**
 * Composition de flotte d'un scénario : `fleet` ({ type: nombre })
 * prime ; à défaut, `operators` piétons (rétro-compatibilité).
 * @returns {Array<[string, number]>} paires [type, nombre > 0], types connus
 */
export function fleetFromScenario(scenario) {
  const fleet = scenario.fleet && Object.keys(scenario.fleet).length > 0
    ? scenario.fleet
    : { pieton: scenario.operators };
  return Object.entries(fleet)
    .filter(([type, count]) => VEHICLES[type] !== undefined && count > 0);
}
