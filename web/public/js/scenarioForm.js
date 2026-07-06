// Descripteur des paramètres de scénario du panneau « Tous les
// paramètres » : les paramètres SANS contrôle dédié dans le panneau
// latéral (les curseurs, compteurs et interrupteurs existants couvrent
// le reste — voir SLIDER_KEYS dans projects.js). Chaque champ porte son
// libellé français, son groupe, ses bornes et une aide ; l'aide reprend
// la formule de calibrage de la procédure d'import WMS quand il y en a
// une. Module pur (aucun DOM, aucun import moteur), testable sous Node.
// Un test de complétude garantit qu'aucun paramètre du moteur n'est
// oublié et que les défauts restent alignés sur DEFAULT_SCENARIO.

export const SCENARIO_FIELDS = [
  // --- Flux de commandes ---
  {
    key: 'durationHours', group: 'Flux de commandes', label: 'Durée simulée',
    unit: 'h', type: 'number', min: 0.5, max: 24, step: 0.5, default: 2,
    help: 'Durée à étudier (ex. un poste = 7 à 8 h)',
  },
  {
    key: 'b2bClients', group: 'Flux de commandes', label: 'Clients B2B',
    type: 'number', min: 1, max: 200, step: 1, default: 8,
    help: 'Calibrage WMS : nombre de clients B2B distincts actifs sur la période',
  },
  {
    key: 'seed', group: 'Flux de commandes', label: 'Graine aléatoire',
    type: 'number', min: 0, max: 999999999, step: 1, default: 1,
    help: 'Même graine = même run (comparaisons reproductibles)',
  },
  // --- Stratégie ---
  {
    key: 'strategy', group: 'Stratégie', label: 'Stratégie de picking',
    type: 'enum', default: 'orderByOrder',
    help: 'zoneWave si le site lance des vagues par zone',
  },
  {
    key: 'waveSize', group: 'Stratégie', label: 'Taille de vague',
    type: 'number', min: 1, max: 200, step: 1, default: 20,
    help: 'Calibrage WMS : taille moyenne des vagues (stratégie vagues par zone)',
  },
  // --- Temps opératoires ---
  {
    key: 'speedMps', group: 'Temps opératoires', label: 'Vitesse de marche',
    unit: 'm/s', type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.2,
    help: 'Mesure terrain ou standard 1,2 m/s',
  },
  {
    key: 'pickTimePerLineSec', group: 'Temps opératoires', label: 'Prélèvement par ligne',
    unit: 's', type: 'number', min: 1, max: 120, step: 1, default: 12,
    help: 'Calibrage WMS : médiane du temps entre deux prélèvements consécutifs d’une même mission',
  },
  {
    key: 'liftTimePerLevelSec', group: 'Temps opératoires', label: 'Élévation par niveau',
    unit: 's', type: 'number', min: 0, max: 60, step: 1, default: 6,
    help: 'Surcoût par niveau de rack au-delà du premier',
  },
  {
    key: 'dropTimeSec', group: 'Temps opératoires', label: 'Dépose',
    unit: 's', type: 'number', min: 0, max: 300, step: 1, default: 20,
    help: 'Dépose observée à l’expédition ou à l’atelier',
  },
  {
    key: 'palletHandlingSec', group: 'Temps opératoires', label: 'Manutention palette',
    unit: 's', type: 'number', min: 0, max: 300, step: 1, default: 30,
    help: 'Prise/dépose d’une palette (module flux)',
  },
  {
    key: 'packTimePerOrderSec', group: 'Temps opératoires', label: 'Emballage par commande',
    unit: 's', type: 'number', min: 0, max: 600, step: 1, default: 60,
    help: 'Emballage d’une commande au poste (avec emballeurs)',
  },
  // --- Module flux ---
  {
    key: 'slotCapacityUnits', group: 'Module flux', label: 'Capacité d’un emplacement',
    unit: 'UVC', type: 'number', min: 1, max: 500, step: 1, default: 60,
    help: 'Calibrage WMS : contenu d’un emplacement picking / d’une palette',
  },
  {
    key: 'replenishThresholdShare', group: 'Module flux', label: 'Seuil de réappro',
    unit: '× capacité', type: 'number', min: 0.05, max: 0.95, step: 0.05, default: 0.25,
    help: 'Calibrage WMS : seuil de réappro ÷ capacité de l’emplacement',
  },
  {
    key: 'palletsPerTruck', group: 'Module flux', label: 'Palettes par camion',
    type: 'number', min: 1, max: 60, step: 1, default: 10,
    help: 'Calibrage WMS : palettes moyennes par camion reçu',
  },
  // --- Engins ---
  {
    key: 'agvAutonomyHours', group: 'Engins', label: 'Autonomie AGV/AMR',
    unit: 'h', type: 'number', min: 0.5, max: 24, step: 0.5, default: 4,
    help: 'Batterie des engins automatisés ; recharge 3× plus rapide au parking',
  },
];

// Valeur saisie → valeur de paramètre : nombre borné (virgule décimale
// acceptée, saisie invalide ramenée au défaut) ; les listes déroulantes
// n'offrent que des valeurs valides et passent telles quelles
export function parseFieldValue(field, raw) {
  if (field.type === 'enum') return raw;
  const text = String(raw).trim();
  const value = Number(text.replace(',', '.'));
  if (text === '' || !Number.isFinite(value)) return field.default;
  return Math.min(field.max, Math.max(field.min, value));
}

// Champs groupés pour le rendu, dans l'ordre du descripteur
export function fieldGroups(fields = SCENARIO_FIELDS) {
  const groups = new Map();
  for (const field of fields) {
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }
  return groups;
}
