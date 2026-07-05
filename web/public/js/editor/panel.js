// Panneau d'édition : rendu des champs de propriétés de l'élément
// sélectionné, des propriétés globales et des erreurs de validation.
// Module DOM simple, sans état : l'orchestrateur (main.js) fournit la
// définition de travail et reçoit les changements via onChange. Les
// coordonnées sont affichées et saisies en bords (displayValue /
// modelValue de model.js) : entières après accrochage à la grille.

import { displayValue, modelValue } from './model.js';
import { VEHICLES } from '/sim/vehicles.js';

// Champs par type d'élément : [clé, libellé, type d'input]
const AISLE_FIELDS = [
  ['id', 'Identifiant', 'text'],
  ['zone', 'Zone', 'text'],
  ['bays', 'Baies', 'number'],
  ['yStart', 'Début (y)', 'number'],
  ['yEnd', 'Fin (y)', 'number'],
  ['width', 'Largeur couloir', 'number'],
  // Racks de l'allée (appliqué aux deux côtés)
  ['levels', 'Niveaux de rack', 'number'],
  ['levelHeight', 'Hauteur de niveau', 'number'],
  ['rackDepth', 'Profondeur racks', 'number'],
];
const FACILITY_FIELDS = [
  ['id', 'Identifiant', 'text'],
  ['label', 'Libellé', 'text'],
  ['x', 'x (bord gauche)', 'number'],
  ['y', 'y (bord avant)', 'number'],
  ['width', 'Largeur', 'number'],
  ['depth', 'Profondeur', 'number'],
];
const PARKING_FIELDS = [
  ...FACILITY_FIELDS,
  // Types d'engins admis, cochés dans le catalogue ; aucun coché = tous
  ['vehicles', 'Engins admis (aucun : tous)', 'checkboxes',
    Object.entries(VEHICLES).map(([value, profile]) => ({ value, label: profile.label }))],
];

// Zones d'expédition/réception : objet unique (format historique) ou liste
const asList = (value) => (Array.isArray(value) ? value : [value]);
const GLOBAL_FIELDS = [
  ['name', 'Nom', 'text'],
  ['width', 'Largeur (x)', 'number'],
  ['depth', 'Profondeur (y)', 'number'],
  ['height', 'Hauteur plafond (z)', 'number'],
];

const CORRIDOR_FIELDS = [
  ['id', 'Identifiant', 'text'],
  ['label', 'Libellé', 'text'],
  ['x', 'x', 'number'],
  ['y', 'y', 'number'],
  ['length', 'Longueur', 'number'],
  ['width', 'Largeur', 'number'],
  ['orientation', 'Orientation', 'select', ['horizontal', 'vertical']],
];

const TYPE_LABELS = {
  aisle: 'Allée',
  workshop: 'Atelier',
  shipping: 'Expédition',
  receiving: 'Réception',
  parking: 'Parking',
  corridor: 'Couloir',
};

// Construit une grille de champs ; onChange reçoit { clé: valeur } au
// changement d'un champ (les nombres invalides sont ignorés). `kind`
// active la conversion bord ↔ modèle sur les coordonnées. Le type
// « select » attend la liste des choix en quatrième position.
function renderFields(container, fields, values, onChange, kind = null) {
  const grid = document.createElement('div');
  grid.className = 'props-grid';
  for (const [key, labelText, type, options] of fields) {
    if (type === 'checkboxes') {
      // Groupe de cases à cocher : la valeur est la liste des choix
      // cochés (aucun coché = undefined, « pas de restriction »)
      const field = document.createElement('div');
      field.className = 'field field-wide';
      const groupHead = document.createElement('span');
      groupHead.className = 'field-head';
      groupHead.innerHTML = `<span>${labelText}</span>`;
      const group = document.createElement('div');
      group.className = 'check-grid';
      const selected = new Set(values[key] ?? []);
      for (const option of options) {
        const item = document.createElement('label');
        item.className = 'check-item';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = option.value;
        box.checked = selected.has(option.value);
        box.addEventListener('change', () => {
          const checked = [...group.querySelectorAll('input:checked')].map((b) => b.value);
          onChange({ [key]: checked.length > 0 ? checked : undefined });
        });
        item.append(box, document.createTextNode(option.label));
        group.append(item);
      }
      field.append(groupHead, group);
      grid.append(field);
      continue;
    }
    const label = document.createElement('label');
    label.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-head';
    head.innerHTML = `<span>${labelText}</span>`;
    const current = (kind ? displayValue(kind, values, key) : values[key]) ?? '';
    let input;
    if (type === 'select') {
      input = document.createElement('select');
      for (const option of options) input.append(new Option(option, option));
      input.value = current;
    } else {
      input = document.createElement('input');
      input.type = type;
      if (type === 'number') input.step = 'any';
      input.value = current;
    }
    input.addEventListener('change', () => {
      const value = type === 'number' ? Number(input.value) : input.value;
      if (type === 'number' && Number.isNaN(value)) return;
      onChange({ [key]: kind ? modelValue(kind, values, key, value) : value });
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
  if (selection.type === 'corridor') {
    const corridor = asList(def.corridors).find((c) => c.id === selection.id);
    if (corridor) renderFields(container, CORRIDOR_FIELDS, corridor, onChange);
  } else if (selection.type === 'aisle') {
    const aisle = def.aisles.find((a) => a.id === selection.id);
    // Les racks sont dérivés de l'allée : leurs réglages s'éditent ici
    const rack = def.racks.find((r) => r.aisle === selection.id);
    if (aisle) {
      renderFields(container, AISLE_FIELDS, {
        ...aisle,
        levels: rack?.levels,
        levelHeight: rack?.levelHeight,
        rackDepth: rack?.depth,
      }, onChange, 'aisle');
    }
  } else {
    const facility = selection.type === 'workshop'
      ? def.workshops.find((w) => w.id === selection.id)
      : selection.type === 'parking'
        ? (def.parkings ?? []).find((p) => p.id === selection.id)
        : asList(def[selection.type]).find((z) => z.id === selection.id);
    const fields = selection.type === 'parking' ? PARKING_FIELDS : FACILITY_FIELDS;
    if (facility) renderFields(container, fields, facility, onChange, selection.type);
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
    height: def.dimensions.height,
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
