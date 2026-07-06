// Lecture tolérante des CSV exportés d'un WMS : encodage (UTF-8 strict
// sinon latin-1), BOM, séparateur détecté (; , tabulation), champs
// entre guillemets, nombres français (virgule décimale, espaces de
// milliers). Module pur, testable sous Node.

// Octets → texte : UTF-8 strict d'abord (les exports récents), sinon
// latin-1 (les exports Windows historiques — les accents restent lisibles)
export function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let latin = '';
    for (const byte of bytes) latin += String.fromCharCode(byte);
    text = latin;
  }
  return text.replace(/^\uFEFF/, ''); // BOM
}

// Séparateur le plus fréquent sur la première ligne (hors guillemets)
export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  let best = ';';
  let bestCount = -1;
  for (const candidate of [';', ',', '\t']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * CSV → { headers, rows } (cellules épurées, lignes vides ignorées).
 * Guillemets doublés = guillemet littéral ; les retours à la ligne dans
 * un champ entre guillemets sont conservés.
 */
export function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) pushCell();
    else if (char === '\n') pushRow();
    else if (char !== '\r') cell += char;
  }
  if (cell !== '' || row.length > 0) pushRow();
  if (rows.length === 0) {
    throw new Error('Le fichier CSV est vide.');
  }
  return { headers: rows[0], rows: rows.slice(1) };
}

// Nombre français ou anglo-saxon → Number, null si illisible
// (« 1 234,5 » → 1234.5 ; les espaces — insécables compris — sautent)
export function toNumber(text) {
  const cleaned = String(text ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
