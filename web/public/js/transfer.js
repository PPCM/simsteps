// Import/export JSON depuis l'interface : analyse d'un fichier importé
// (erreurs en français) et nom de fichier d'export dérivé du nom de
// l'entrepôt ou du scénario. Module pur (aucun DOM), testable sous Node.

// Le fichier importé doit contenir un objet JSON (document d'entrepôt
// ou paramètres de scénario) — la validation métier reste côté API
export function parseImportedJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Le fichier n’est pas un JSON valide.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Le fichier doit contenir un objet JSON.');
  }
  return value;
}

// Nom de fichier sûr : accents retirés, tout caractère spécial devient
// un tiret, minuscules — « Entrepôt exemple » → entrepot-exemple.json
export function exportFilename(name, fallback = 'export') {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base || fallback}.json`;
}
