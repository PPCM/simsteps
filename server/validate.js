// Validation des entrées de l'API : définitions d'entrepôt, paramètres
// de scénario et projets. Renvoie une liste de messages d'erreur
// (vide = valide).

import { buildWarehouse } from '../sim/warehouse.js';
import { STRATEGIES } from '../sim/strategies.js';
import { DEFAULT_SCENARIO } from '../sim/engine.js';

/**
 * Valide une définition d'entrepôt (format warehouse.json).
 * La construction complète est tentée : toute incohérence topologique
 * (rack orphelin, nœud dupliqué…) est remontée comme erreur.
 * @param {object} def
 * @returns {string[]} messages d'erreur
 */
export function validateWarehouseDefinition(def) {
  const errors = [];
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    return ['la définition doit être un objet JSON'];
  }
  if (typeof def.name !== 'string' || def.name.trim() === '') {
    errors.push('« name » est requis (chaîne non vide)');
  }
  if (!Array.isArray(def.aisles) || def.aisles.length === 0) {
    errors.push('« aisles » est requis (au moins une allée)');
  }
  if (!Array.isArray(def.racks) || def.racks.length === 0) {
    errors.push('« racks » est requis (au moins un rack)');
  }
  if (!Array.isArray(def.workshops) || def.workshops.length === 0) {
    errors.push('« workshops » est requis (au moins un atelier)');
  }
  // Couloirs : objet historique { frontY, backY } ou liste non vide de
  // segments { id, x, y, length, orientation }
  const corridorsOk = Array.isArray(def.corridors)
    ? def.corridors.length > 0 && def.corridors.every((c) => c && c.id
        && typeof c.x === 'number' && typeof c.y === 'number' && typeof c.length === 'number')
    : Boolean(def.corridors
        && typeof def.corridors.frontY === 'number' && typeof def.corridors.backY === 'number');
  if (!corridorsOk) {
    errors.push('« corridors » est requis ({ frontY, backY } ou liste non vide de couloirs { id, x, y, length })');
  }
  // Une zone { id … } (format historique) ou une liste non vide de zones
  const zoneOk = (value) => (Array.isArray(value)
    ? value.length > 0 && value.every((z) => z && z.id)
    : Boolean(value && value.id));
  if (!zoneOk(def.shipping)) errors.push('« shipping » est requis (zone ou liste non vide de zones)');
  if (!zoneOk(def.receiving)) errors.push('« receiving » est requis (zone ou liste non vide de zones)');
  if (errors.length > 0) return errors;

  try {
    buildWarehouse(def);
  } catch (error) {
    errors.push(`définition incohérente : ${error.message}`);
  }
  return errors;
}

// Bornes de validation par paramètre numérique de scénario
const NUMERIC_PARAMS = {
  seed: { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
  durationHours: { min: 0.01, max: 168 },
  operators: { min: 1, max: 500, integer: true },
  ordersPerHour: { min: 0.1, max: 100000 },
  b2cShare: { min: 0, max: 1 },
  speedMps: { min: 0.1, max: 10 },
  pickTimePerLineSec: { min: 0, max: 3600 },
  dropTimeSec: { min: 0, max: 3600 },
  waveSize: { min: 1, max: 10000, integer: true },
  b2bClients: { min: 1, max: 100000, integer: true },
};

/**
 * Valide des paramètres de scénario (tous facultatifs : les valeurs
 * manquantes prennent les défauts du moteur).
 * @param {object} params
 * @returns {string[]} messages d'erreur
 */
export function validateScenarioParams(params) {
  const errors = [];
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return ['les paramètres doivent être un objet JSON'];
  }
  for (const [key, value] of Object.entries(params)) {
    if (key === 'name') {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push('« name » doit être une chaîne non vide');
      }
    } else if (key === 'strategy') {
      if (!STRATEGIES.has(value)) {
        errors.push(`stratégie inconnue : ${value} (disponibles : ${[...STRATEGIES.keys()].join(', ')})`);
      }
    } else if (key in NUMERIC_PARAMS) {
      const { min, max, integer } = NUMERIC_PARAMS[key];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`« ${key} » doit être un nombre`);
      } else if (value < min || value > max) {
        errors.push(`« ${key} » doit être compris entre ${min} et ${max}`);
      } else if (integer && !Number.isInteger(value)) {
        errors.push(`« ${key} » doit être un entier`);
      }
    } else if (!(key in DEFAULT_SCENARIO)) {
      errors.push(`paramètre inconnu : « ${key} »`);
    }
  }
  return errors;
}

/**
 * Valide le corps d'un projet : nom, références d'entrepôt/scénario et
 * paramétrages (surcharges libres de paramètres de scénario).
 * L'existence en base des références est vérifiée par les routes.
 * @param {{name?: unknown, warehouseId?: unknown, scenarioId?: unknown, settings?: unknown}} payload
 * @returns {string[]} messages d'erreur
 */
export function validateProjectPayload({ name, warehouseId, scenarioId, settings } = {}) {
  const errors = [];
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('« name » est requis (chaîne non vide)');
  }
  if (!Number.isInteger(warehouseId) || warehouseId < 1) {
    errors.push('« warehouseId » est requis (entier ≥ 1)');
  }
  if (scenarioId !== undefined && scenarioId !== null && (!Number.isInteger(scenarioId) || scenarioId < 1)) {
    errors.push('« scenarioId » doit être un entier ≥ 1 ou null');
  }
  if (settings === undefined) return errors;
  const settingsErrors = validateScenarioParams(settings);
  if (settingsErrors.length > 0) return errors.concat(settingsErrors);
  // « name » est accepté par validateScenarioParams mais n'est pas un
  // paramétrage : le nom du projet vit dans la colonne dédiée
  if ('name' in settings) {
    errors.push('« settings » ne doit pas contenir « name »');
  }
  return errors;
}
