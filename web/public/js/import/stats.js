// Statistiques d'historique WMS → paramètres de scénario : cadence de
// commandes, part B2C, portefeuille B2B, temps de prélèvement par ligne
// (médiane des écarts entre validations d'une même mission), réceptions.
// Chaque calcul renvoie ses valeurs ET son explication française,
// affichée telle quelle par l'assistant. Module pur, testable sous Node.

import { toNumber } from './csv.js';

// « 2026-05-04 08:30[:12] », « 2026-05-04T08:30 », « 04/05/2026 08:30 »
// ou date seule → millisecondes epoch, null si illisible
export function parseDateTime(text) {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  const fr = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (fr) {
    const [, day, month, year, h = '0', m = '0', s = '0'] = fr;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(h), Number(m), Number(s)).getTime();
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso) {
    const [, year, month, day, h = '0', m = '0', s = '0'] = iso;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(h), Number(m), Number(s)).getTime();
  }
  return null;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Jour civil (locale) d'un epoch — clé de comptage des jours ouvrés
function dayKey(epoch) {
  const date = new Date(epoch);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Valeurs distinctes d'une colonne (écran de correspondance des flux)
export function distinctValues(rows, columnIndex) {
  const values = new Map();
  for (const row of rows) {
    const value = (row[columnIndex] ?? '').trim();
    if (value !== '') values.set(value, (values.get(value) ?? 0) + 1);
  }
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

/**
 * Historique des commandes → ordersPerHour, b2cShare, b2bClients.
 * Accepte des lignes de commandes (n° répété) ou des en-têtes (n° unique).
 * @param {string[][]} rows
 * @param {object} mapping { order, client?, flow, datetime } → index
 * @param {object} flowMap { valeur de flux: 'b2c' | 'b2b' }
 * @param {number} hoursPerDay heures ouvrées par jour (saisie utilisateur)
 */
export function orderStats(rows, mapping, flowMap, hoursPerDay) {
  const orders = new Map(); // n° → { flow, client, epoch }
  for (const row of rows) {
    const id = (row[mapping.order] ?? '').trim();
    if (id === '' || orders.has(id)) {
      if (id !== '') orders.get(id).lines++;
      continue;
    }
    orders.set(id, {
      flow: (row[mapping.flow] ?? '').trim(),
      client: mapping.client !== null ? (row[mapping.client] ?? '').trim() : '',
      epoch: parseDateTime(row[mapping.datetime]),
      lines: 1,
    });
  }
  const all = [...orders.values()];
  const days = new Set(all.filter((o) => o.epoch !== null).map((o) => dayKey(o.epoch)));
  const total = all.length;
  if (total === 0 || days.size === 0) {
    throw new Error('Aucune commande datée exploitable dans le fichier.');
  }
  const b2c = all.filter((o) => flowMap[o.flow] === 'b2c').length;
  const b2b = all.filter((o) => flowMap[o.flow] === 'b2b');
  const b2bClients = new Set(b2b.map((o) => o.client).filter((c) => c !== '')).size;
  const ordersPerHour = total / (days.size * hoursPerDay);
  const linesPerOrder = all.reduce((sum, o) => sum + o.lines, 0) / total;
  return {
    params: {
      ordersPerHour: Math.max(1, Math.round(ordersPerHour)),
      b2cShare: Math.round((b2c / total) * 100) / 100,
      ...(b2bClients > 0 && { b2bClients }),
    },
    explanations: [
      `${total} commandes sur ${days.size} jour(s) ouvré(s) × ${hoursPerDay} h → ${Math.round(ordersPerHour * 10) / 10} commandes/h`,
      `${b2c} commandes B2C sur ${total} → part B2C ${Math.round((b2c / total) * 100)} %`,
      b2bClients > 0
        ? `${b2bClients} client(s) B2B distinct(s)`
        : 'Aucun client B2B identifié (paramètre laissé tel quel)',
      `Contrôle : ${Math.round(linesPerOrder * 10) / 10} ligne(s) par commande en moyenne`,
    ],
  };
}

/**
 * Historique des mouvements de préparation → pickTimePerLineSec (médiane
 * des écarts entre validations consécutives d'une même mission, bornés à
 * [2 s, 10 min] pour écarter doubles saisies et pauses) et effectif
 * simultané moyen (opérateurs distincts par heure active).
 */
export function movementStats(rows, mapping) {
  const missions = new Map();
  const hours = new Map(); // heure → Set d'opérateurs
  for (const row of rows) {
    const epoch = parseDateTime(row[mapping.datetime]);
    if (epoch === null) continue;
    const mission = (row[mapping.mission] ?? '').trim();
    if (mission !== '') {
      if (!missions.has(mission)) missions.set(mission, []);
      missions.get(mission).push(epoch);
    }
    const operator = (row[mapping.operator] ?? '').trim();
    if (operator !== '') {
      const hour = Math.floor(epoch / 3_600_000);
      if (!hours.has(hour)) hours.set(hour, new Set());
      hours.get(hour).add(operator);
    }
  }
  const gaps = [];
  for (const timestamps of missions.values()) {
    timestamps.sort((a, b) => a - b);
    for (let i = 1; i < timestamps.length; i++) {
      const gap = (timestamps[i] - timestamps[i - 1]) / 1000;
      if (gap >= 2 && gap <= 600) gaps.push(gap);
    }
  }
  if (gaps.length === 0) {
    throw new Error('Aucun écart de prélèvement exploitable (missions mono-ligne ou horodatages illisibles).');
  }
  const pickTime = Math.round(median(gaps));
  const counts = [...hours.values()].map((set) => set.size);
  const operators = counts.length > 0
    ? Math.max(1, Math.round(counts.reduce((sum, n) => sum + n, 0) / counts.length))
    : null;
  return {
    params: {
      pickTimePerLineSec: pickTime,
      ...(operators !== null && { operators }),
    },
    explanations: [
      `Médiane de ${gaps.length} écarts entre validations d'une même mission → ${pickTime} s par ligne (le trajet est simulé à part : ajustez à la baisse si vos écarts l'incluent largement)`,
      operators !== null
        ? `${operators} opérateur(s) simultané(s) en moyenne sur les heures actives`
        : 'Effectif simultané non calculable (opérateurs absents)',
    ],
  };
}

/** Historique des réceptions → camions/jour et palettes par camion. */
export function receivingStats(rows, mapping) {
  const days = new Map(); // jour → { trucks, pallets }
  for (const row of rows) {
    const epoch = parseDateTime(row[mapping.date]);
    const pallets = toNumber(row[mapping.pallets]);
    if (epoch === null || pallets === null) continue;
    const key = dayKey(epoch);
    if (!days.has(key)) days.set(key, { trucks: 0, pallets: 0 });
    const day = days.get(key);
    day.trucks++;
    day.pallets += pallets;
  }
  if (days.size === 0) {
    throw new Error('Aucune réception datée exploitable dans le fichier.');
  }
  const entries = [...days.values()];
  const trucks = entries.reduce((sum, d) => sum + d.trucks, 0);
  const pallets = entries.reduce((sum, d) => sum + d.pallets, 0);
  const inboundTrucksPerDay = Math.max(1, Math.round(trucks / days.size));
  const palletsPerTruck = Math.max(1, Math.round(pallets / trucks));
  return {
    params: { inboundTrucksPerDay, palletsPerTruck },
    explanations: [
      `${trucks} réception(s) sur ${days.size} jour(s) → ${inboundTrucksPerDay} camion(s)/jour`,
      `${pallets} palettes sur ${trucks} réception(s) → ${palletsPerTruck} palettes/camion`,
    ],
  };
}
