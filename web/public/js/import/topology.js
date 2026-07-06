// Topologie depuis le référentiel des emplacements d'un WMS : agrégation
// par allée (travées, niveaux, zone) puis entrepôt provisoire posé sur
// une trame par défaut — les positions réelles s'ajustent ensuite dans
// l'éditeur 3D. Module pur, testable sous Node.

import { toNumber } from './csv.js';

/**
 * Agrège les lignes du référentiel : une entrée par allée distincte.
 * @param {string[][]} rows lignes du CSV
 * @param {object} mapping { aisle, bay, level, zone?, type?, side? } → index de colonne
 * @returns {{aisles: Array, anomalies: string[], locations: number}}
 */
export function aggregateLocations(rows, mapping) {
  const aisles = new Map();
  const anomalies = [];
  let ignored = 0;
  for (const row of rows) {
    const aisle = (row[mapping.aisle] ?? '').trim();
    const bay = (row[mapping.bay] ?? '').trim();
    if (aisle === '' || bay === '') { ignored++; continue; }
    if (!aisles.has(aisle)) {
      aisles.set(aisle, { bays: new Set(), levels: new Set(), zones: new Map() });
    }
    const entry = aisles.get(aisle);
    entry.bays.add(bay);
    const level = (row[mapping.level] ?? '').trim();
    if (level !== '') entry.levels.add(level);
    if (mapping.zone !== null && mapping.zone !== undefined) {
      const zone = (row[mapping.zone] ?? '').trim();
      if (zone !== '') entry.zones.set(zone, (entry.zones.get(zone) ?? 0) + 1);
    }
  }
  if (ignored > 0) {
    anomalies.push(`${ignored} ligne(s) sans allée ou sans travée ignorée(s).`);
  }
  const result = [...aisles.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
    .map(([id, entry]) => {
      // Niveaux : maximum numérique si tous les niveaux sont des nombres,
      // sinon nombre de valeurs distinctes (niveaux lettrés A/B/C…)
      const numeric = [...entry.levels].map(toNumber);
      const levels = entry.levels.size === 0
        ? 1
        : (numeric.every((v) => v !== null)
          ? Math.max(...numeric)
          : entry.levels.size);
      const zone = [...entry.zones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (entry.bays.size < 2) {
        anomalies.push(`Allée « ${id} » : une seule travée détectée (2 minimum dans SimSteps — la trame en posera 2).`);
      }
      return { id, bays: entry.bays.size, levels: Math.max(1, Math.round(levels)), zone: zone ?? 'Z1' };
    });
  if (result.length === 0) {
    anomalies.push('Aucune allée exploitable dans le fichier.');
  }
  return { aisles: result, anomalies, locations: rows.length - ignored };
}

/**
 * Entrepôt provisoire sur trame par défaut : allées au pas de 5 m,
 * longueur proportionnelle aux travées, deux couloirs transversaux,
 * atelier + expédition devant, réception derrière.
 * @param {{aisles: Array}} aggregate résultat d'aggregateLocations
 * @param {{name?: string}} options
 * @returns {object} définition d'entrepôt importable
 */
export function draftWarehouse(aggregate, options = {}) {
  const aisles = aggregate.aisles;
  if (aisles.length === 0) {
    throw new Error('Aucune allée : impossible de générer un entrepôt.');
  }
  const PITCH = 5; // espacement des allées (m)
  const BAY_PITCH = 1.7; // longueur d'une travée (m)
  const yStart = 7;
  const maxBays = Math.max(...aisles.map((a) => Math.max(2, a.bays)));
  const maxLength = Math.max(4, Math.ceil(maxBays * BAY_PITCH));
  const width = Math.max(24, 6 + (aisles.length - 1) * PITCH + 6);
  const backY = yStart + maxLength + 3;
  const depth = backY + 4;

  const definition = {
    name: options.name ?? 'Entrepôt importé du WMS',
    description: `Généré par l'assistant d'import WMS (${aggregate.locations ?? '?'} emplacements) — positions à ajuster d'après le plan`,
    dimensions: { width, depth },
    corridors: { frontY: 4, backY },
    aisles: [],
    racks: [],
    workshops: [
      { id: 'AT1', label: 'Atelier emballage', x: Math.round(width * 0.3), y: 2 },
    ],
    shipping: [{ id: 'EXP', label: 'Expédition', x: Math.round(width * 0.6), y: 2 }],
    receiving: [{ id: 'REC', label: 'Réception', x: Math.round(width * 0.5), y: depth - 2 }],
  };
  aisles.forEach((aisle, index) => {
    const bays = Math.max(2, aisle.bays);
    const id = `A${index + 1}`;
    definition.aisles.push({
      id,
      label: `Allée ${aisle.id}`,
      x: 6 + index * PITCH,
      yStart,
      yEnd: yStart + Math.max(4, Math.ceil(bays * BAY_PITCH)),
      bays,
      zone: aisle.zone,
    });
    const number = (n) => String(n).padStart(2, '0');
    definition.racks.push(
      { id: `R${number(index * 2 + 1)}`, aisle: id, side: 'gauche', levels: aisle.levels },
      { id: `R${number(index * 2 + 2)}`, aisle: id, side: 'droite', levels: aisle.levels }
    );
  });
  return definition;
}
