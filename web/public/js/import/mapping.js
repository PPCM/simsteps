// Correspondance des colonnes d'un CSV WMS : chaque extraction attend
// des champs connus, détectés dans les en-têtes par un dictionnaire de
// synonymes français/anglais (noms Reflex usuels compris), corrigeables
// ensuite dans l'assistant. Module pur, testable sous Node.

// Normalisation d'un en-tête : accents retirés, tout sauf lettres et
// chiffres supprimé, minuscules — « N° Commande » → « ncommande »
export function normalizeHeader(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// Champs des quatre extractions (required : bloque l'analyse si absent)
export const LOCATION_FIELDS = [
  { key: 'aisle', label: 'Allée', required: true, synonyms: ['allee', 'aisle', 'all'] },
  { key: 'bay', label: 'Travée / colonne', required: true, synonyms: ['travee', 'colonne', 'column', 'bay', 'trav'] },
  { key: 'level', label: 'Niveau', required: true, synonyms: ['niveau', 'level', 'niv'] },
  { key: 'zone', label: 'Zone', required: false, synonyms: ['zone', 'magasin', 'secteur', 'warehousearea'] },
  { key: 'type', label: 'Type (picking/réserve)', required: false, synonyms: ['type', 'typeemplacement', 'locationtype', 'role'] },
  { key: 'side', label: 'Côté', required: false, synonyms: ['cote', 'side', 'parite'] },
];

export const ORDER_FIELDS = [
  { key: 'order', label: 'N° de commande', required: true, synonyms: ['commande', 'ncommande', 'numcommande', 'order', 'orderid', 'ordre'] },
  { key: 'client', label: 'Code client', required: false, synonyms: ['client', 'codeclient', 'customer', 'destinataire'] },
  { key: 'flow', label: 'Type de flux', required: true, synonyms: ['flux', 'typeflux', 'typecommande', 'flow', 'canal', 'channel'] },
  { key: 'datetime', label: 'Date/heure de création', required: true, synonyms: ['date', 'datecreation', 'dateheure', 'created', 'horodatage', 'timestamp'] },
];

export const MOVEMENT_FIELDS = [
  { key: 'mission', label: 'N° de mission', required: true, synonyms: ['mission', 'nmission', 'tache', 'task', 'vague', 'wave', 'ordrepreparation'] },
  { key: 'datetime', label: 'Horodatage', required: true, synonyms: ['date', 'dateheure', 'horodatage', 'timestamp', 'validation', 'heurevalidation'] },
  { key: 'operator', label: 'Opérateur', required: true, synonyms: ['operateur', 'operator', 'cariste', 'preparateur', 'utilisateur', 'user'] },
  { key: 'type', label: 'Type de mission', required: false, synonyms: ['type', 'typemission', 'typemouvement', 'movementtype'] },
];

export const RECEIVING_FIELDS = [
  { key: 'date', label: 'Date de réception', required: true, synonyms: ['date', 'datereception', 'received', 'jour'] },
  { key: 'pallets', label: 'Palettes / supports', required: true, synonyms: ['palettes', 'supports', 'pallets', 'nbpalettes', 'nbsupports', 'quantite'] },
];

/**
 * Suggère une colonne par champ : égalité normalisée d'abord, sinon
 * inclusion (dans les deux sens, synonymes d'au moins 3 caractères).
 * @returns {object} { clé de champ: index de colonne ou null }
 */
export function suggestMapping(headers, fields) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const taken = new Set();
  // Deux passes : les correspondances exactes priment sur les inclusions
  for (const exact of [true, false]) {
    for (const field of fields) {
      if (mapping[field.key] !== undefined) continue;
      const index = normalized.findIndex((header, i) => {
        if (taken.has(i) || header === '') return false;
        // Inclusion : l'en-tête contient le synonyme, ou n'en est que le
        // début abrégé (« Trav. » → travee) — jamais un milieu de mot
        return field.synonyms.some((synonym) => exact
          ? header === synonym
          : (synonym.length >= 3 &&
            (header.includes(synonym) || (header.length >= 3 && synonym.startsWith(header)))));
      });
      if (index !== -1) {
        mapping[field.key] = index;
        taken.add(index);
      }
    }
  }
  for (const field of fields) mapping[field.key] ??= null;
  return mapping;
}

// Champs obligatoires sans colonne → messages français pour l'assistant
export function missingRequired(mapping, fields) {
  return fields
    .filter((field) => field.required && mapping[field.key] === null)
    .map((field) => `Colonne « ${field.label} » non identifiée : choisissez-la dans la liste.`);
}
