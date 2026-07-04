// Panneau d'édition : rendu des champs de propriétés de l'élément
// sélectionné, des propriétés globales et des erreurs de validation.
// Module DOM simple, sans état : l'orchestrateur (main.js) fournit la
// définition de travail et reçoit les changements via onChange.

// Champs par type d'élément : [clé, libellé, type d'input]
const AISLE_FIELDS = [
  ['id', 'Identifiant', 'text'],
  ['zone', 'Zone', 'text'],
  ['bays', 'Baies', 'number'],
  ['yStart', 'Début (y)', 'number'],
  ['yEnd', 'Fin (y)', 'number'],
  ['width', 'Largeur couloir', 'number'],
];
const FACILITY_FIELDS = [
  ['id', 'Identifiant', 'text'],
  ['label', 'Libellé', 'text'],
  ['x', 'x', 'number'],
  ['y', 'y', 'number'],
  ['width', 'Largeur', 'number'],
  ['depth', 'Profondeur', 'number'],
];

// Zones d'expédition/réception : objet unique (format historique) ou liste
const asList = (value) => (Array.isArray(value) ? value : [value]);
const GLOBAL_FIELDS = [
  ['name', 'Nom', 'text'],
  ['width', 'Largeur', 'number'],
  ['depth', 'Profondeur', 'number'],
  ['frontY', 'Couloir avant', 'number'],
  ['backY', 'Couloir arrière', 'number'],
];

const TYPE_LABELS = {
  aisle: 'Allée',
  workshop: 'Atelier',
  shipping: 'Expédition',
  receiving: 'Réception',
};

// Construit une grille de champs ; onChange reçoit { clé: valeur } au
// changement d'un champ (les nombres invalides sont ignorés)
function renderFields(container, fields, values, onChange) {
  const grid = document.createElement('div');
  grid.className = 'props-grid';
  for (const [key, labelText, type] of fields) {
    const label = document.createElement('label');
    label.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-head';
    head.innerHTML = `<span>${labelText}</span>`;
    const input = document.createElement('input');
    input.type = type;
    if (type === 'number') input.step = 'any';
    input.value = values[key] ?? '';
    input.addEventListener('change', () => {
      const value = type === 'number' ? Number(input.value) : input.value;
      if (type === 'number' && Number.isNaN(value)) return;
      onChange({ [key]: value });
    });
    label.append(head, input);
    grid.append(label);
  }
  container.append(grid);
}

/**
 * Affiche les champs de l'élément sélectionné (ou un message si aucun).
 * @param {HTMLElement} container
 * @param {object} def définition de travail
 * @param {{type: string, id: string}|null} selection
 * @param {(props: object) => void} onChange
 */
export function renderSelection(container, def, selection, onChange) {
  container.innerHTML = '';
  if (!selection) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = 'Cliquez un élément dans la scène.';
    container.append(p);
    return;
  }
  const title = document.createElement('p');
  title.className = 'placeholder';
  title.textContent = `${TYPE_LABELS[selection.type]} ${selection.id}`;
  container.append(title);
  if (selection.type === 'aisle') {
    const aisle = def.aisles.find((a) => a.id === selection.id);
    if (aisle) renderFields(container, AISLE_FIELDS, aisle, onChange);
  } else {
    const facility = selection.type === 'workshop'
      ? def.workshops.find((w) => w.id === selection.id)
      : asList(def[selection.type]).find((z) => z.id === selection.id);
    if (facility) renderFields(container, FACILITY_FIELDS, facility, onChange);
  }
}

/**
 * Affiche les propriétés globales (nom, dimensions, couloirs).
 * @param {HTMLElement} container
 * @param {object} def définition de travail
 * @param {(props: object) => void} onChange
 */
export function renderGlobals(container, def, onChange) {
  container.innerHTML = '';
  renderFields(container, GLOBAL_FIELDS, {
    name: def.name,
    width: def.dimensions.width,
    depth: def.dimensions.depth,
    frontY: def.corridors.frontY,
    backY: def.corridors.backY,
  }, onChange);
}

/**
 * Affiche la liste des erreurs de validation.
 * @param {HTMLUListElement} ul
 * @param {string[]} errors
 */
export function renderErrors(ul, errors) {
  ul.innerHTML = '';
  for (const error of errors) {
    const li = document.createElement('li');
    li.textContent = error;
    ul.append(li);
  }
}
