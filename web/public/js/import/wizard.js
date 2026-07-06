// Assistant d'import WMS : les CSV des extractions (emplacements,
// commandes, mouvements, réceptions) deviennent un entrepôt provisoire,
// un scénario calibré et un projet. Les fichiers sont lus dans le
// navigateur — rien n'est envoyé au serveur avant la validation finale.
// Ce module porte le DOM de l'assistant ; les calculs vivent dans les
// modules purs csv/mapping/topology/stats.

import { decodeCsv, parseCsv } from './csv.js';
import {
  suggestMapping, missingRequired,
  LOCATION_FIELDS, ORDER_FIELDS, MOVEMENT_FIELDS, RECEIVING_FIELDS,
} from './mapping.js';
import { aggregateLocations, draftWarehouse } from './topology.js';
import { orderStats, movementStats, receivingStats, distinctValues } from './stats.js';

// Création d'élément compacte
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children) el.append(child);
  return el;
}

const ORDER = ['locations', 'orders', 'movements', 'receiving', 'summary'];

const EXTRACTIONS = {
  locations: {
    title: 'Étape 1 — Emplacements (extraction A, obligatoire)',
    intro: 'Référentiel des adresses de stockage : une ligne par emplacement, '
      + 'avec au moins l’allée, la travée et le niveau. L’assistant compte '
      + 'travées et niveaux par allée et pose un entrepôt provisoire sur une '
      + 'trame par défaut — les positions s’ajustent ensuite dans l’éditeur 3D.',
    fields: LOCATION_FIELDS,
  },
  orders: {
    title: 'Étape 2 — Commandes (extraction B, facultatif)',
    intro: 'Historique des commandes d’une période représentative : cadence, '
      + 'part B2C et portefeuille B2B en sont déduits. Passez cette étape pour '
      + 'garder les valeurs par défaut.',
    fields: ORDER_FIELDS,
  },
  movements: {
    title: 'Étape 3 — Missions de préparation (extraction C, facultatif)',
    intro: 'Mouvements de prélèvement horodatés : le temps par ligne (médiane '
      + 'des écarts d’une même mission) et l’effectif simultané en sont déduits.',
    fields: MOVEMENT_FIELDS,
  },
  receiving: {
    title: 'Étape 4 — Réceptions (extraction D, facultatif)',
    intro: 'Réceptions par jour : camions entrants et palettes par camion. '
      + 'Analyser cette extraction activera le réapprovisionnement (stock fini).',
    fields: RECEIVING_FIELDS,
  },
};

// Première orientation des types de flux, corrigeable dans la liste
function guessFlow(value) {
  const v = value.toLowerCase();
  if (/b2c|e-?com|web|internet|vad|détail|detail/.test(v)) return 'b2c';
  if (/b2b|magasin|store|retail|gros|wholesale/.test(v)) return 'b2b';
  return 'b2c';
}

/**
 * @param {object} els éléments du dialogue : wizard, body, status, back,
 *        skip, next, close
 * @param {(result: {definition: object, params: object, name: string}) =>
 *        Promise<void>} onCreate création côté application (API + suites)
 */
export function createWizard(els, onCreate) {
  let stepIndex = 0;
  let ui = {}; // état transitoire par étape : fichier analysé, mapping…
  let data = {}; // résultats validés par étape (Analyser)
  let name = 'Import WMS';

  function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle('error', isError);
  }

  function collectedParams() {
    const params = {
      ...data.orders?.params,
      ...data.movements?.params,
      ...data.receiving?.params,
    };
    if (data.receiving) params.replenishment = true;
    return params;
  }

  // --- Écran d'une extraction : fichier, correspondances, analyse ---
  function renderExtraction(id) {
    const spec = EXTRACTIONS[id];
    const state = ui[id] ?? (ui[id] = { parsed: null, mapping: null, flowChoices: new Map(), hours: 8 });
    const box = h('div', {}, [
      h('h3', { text: spec.title }),
      h('p', { text: spec.intro }),
    ]);
    box.append(h('input', {
      type: 'file', 'data-role': `file-${id}`, accept: '.csv,.txt,text/csv',
      onchange: async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          state.parsed = parseCsv(decodeCsv(await file.arrayBuffer()));
          state.mapping = suggestMapping(state.parsed.headers, spec.fields);
          state.flowChoices = new Map();
          delete data[id];
          setStatus(`${file.name} : ${state.parsed.rows.length} ligne(s) lue(s).`);
        } catch (error) {
          state.parsed = null;
          setStatus(`Échec de lecture : ${error.message}`, true);
        }
        renderStep();
      },
    }));
    if (state.parsed !== null) {
      box.append(renderMapping(id, spec, state));
      if (id === 'orders') box.append(...renderOrderOptions(state));
      box.append(h('button', {
        class: 'action', 'data-role': `analyze-${id}`, text: 'Analyser',
        onclick: () => analyze(id, spec, state),
      }));
    }
    if (data[id] !== undefined) box.append(renderResult(id));
    return box;
  }

  // Tableau champ attendu → colonne du fichier
  function renderMapping(id, spec, state) {
    const table = h('table', {}, [
      h('tr', {}, [h('th', { text: 'Donnée attendue' }), h('th', { text: 'Colonne du fichier' })]),
    ]);
    for (const field of spec.fields) {
      const select = h('select', {
        'data-role': `map-${id}-${field.key}`,
        onchange: () => {
          state.mapping[field.key] = select.value === '' ? null : Number(select.value);
          delete data[id];
          if (field.key === 'flow') state.flowChoices = new Map();
          renderStep();
        },
      });
      select.append(new Option('—', ''));
      state.parsed.headers.forEach((header, index) => select.append(new Option(header, String(index))));
      select.value = state.mapping[field.key] === null ? '' : String(state.mapping[field.key]);
      table.append(h('tr', {}, [
        h('td', { text: `${field.label}${field.required ? ' *' : ''}` }),
        h('td', {}, [select]),
      ]));
    }
    return table;
  }

  // Options propres aux commandes : heures ouvrées et types de flux
  function renderOrderOptions(state) {
    const blocks = [];
    const hours = h('input', {
      type: 'number', min: '1', max: '24', step: '0.5', value: String(state.hours),
      'data-role': 'order-hours',
      onchange: () => { state.hours = Number(hours.value) || 8; delete data.orders; renderStep(); },
    });
    blocks.push(h('p', {}, ['Heures ouvrées par jour : ', hours]));
    if (state.mapping.flow !== null) {
      const table = h('table', {}, [
        h('tr', {}, [h('th', { text: 'Type de flux du fichier' }), h('th', { text: 'Commandes' }), h('th', { text: 'Interprétation' })]),
      ]);
      for (const { value, count } of distinctValues(state.parsed.rows, state.mapping.flow)) {
        if (!state.flowChoices.has(value)) state.flowChoices.set(value, guessFlow(value));
        const select = h('select', {
          'data-role': `flow-${value}`,
          onchange: () => { state.flowChoices.set(value, select.value); delete data.orders; renderStep(); },
        });
        for (const [option, label] of [['b2c', 'B2C (vers un atelier)'], ['b2b', 'B2B (vers l’expédition)'], ['ignorer', 'Ignorer']]) {
          select.append(new Option(label, option));
        }
        select.value = state.flowChoices.get(value);
        table.append(h('tr', {}, [h('td', { text: value }), h('td', { text: String(count) }), h('td', {}, [select])]));
      }
      blocks.push(table);
    }
    return blocks;
  }

  function analyze(id, spec, state) {
    const errors = missingRequired(state.mapping, spec.fields);
    if (errors.length > 0) {
      setStatus(errors[0], true);
      return;
    }
    try {
      if (id === 'locations') {
        const aggregate = aggregateLocations(state.parsed.rows, state.mapping);
        if (aggregate.aisles.length === 0) throw new Error('Aucune allée exploitable dans le fichier.');
        data.locations = { aggregate };
      } else if (id === 'orders') {
        const flowMap = {};
        for (const [value, choice] of state.flowChoices) {
          if (choice !== 'ignorer') flowMap[value] = choice;
        }
        data.orders = orderStats(state.parsed.rows, state.mapping, flowMap, state.hours);
      } else if (id === 'movements') {
        data.movements = movementStats(state.parsed.rows, state.mapping);
      } else {
        data.receiving = receivingStats(state.parsed.rows, state.mapping);
      }
      setStatus('');
    } catch (error) {
      setStatus(error.message, true);
    }
    renderStep();
  }

  // Résultat d'une analyse : agrégat (emplacements) ou explications
  function renderResult(id) {
    if (id === 'locations') {
      const { aggregate } = data.locations;
      const table = h('table', { 'data-role': 'aisles-summary' }, [
        h('tr', {}, [h('th', { text: 'Allée' }), h('th', { text: 'Travées' }), h('th', { text: 'Niveaux' }), h('th', { text: 'Zone' })]),
        ...aggregate.aisles.map((a) => h('tr', {}, [
          h('td', { text: a.id }), h('td', { text: String(a.bays) }),
          h('td', { text: String(a.levels) }), h('td', { text: a.zone }),
        ])),
      ]);
      const box = h('div', { class: 'explain' }, [
        h('p', { text: `${aggregate.locations} emplacements → ${aggregate.aisles.length} allée(s).` }),
        table,
      ]);
      if (aggregate.anomalies.length > 0) {
        box.append(h('ul', { class: 'wizard-errors' },
          aggregate.anomalies.map((a) => h('li', { text: a }))));
      }
      return box;
    }
    return h('ul', { class: 'explain' },
      data[id].explanations.map((line) => h('li', { text: line })));
  }

  // --- Récapitulatif et création ---
  function renderSummary() {
    const params = collectedParams();
    const nameInput = h('input', {
      type: 'text', value: name, 'data-role': 'wizard-name',
      onchange: () => { name = nameInput.value.trim() || 'Import WMS'; },
    });
    const items = [
      `Entrepôt provisoire : ${data.locations.aggregate.aisles.length} allée(s), `
      + `${data.locations.aggregate.locations} emplacements — positions posées sur une trame par défaut, `
      + 'à ajuster d’après le plan du bâtiment (l’éditeur 3D s’ouvre à la création)',
      Object.keys(params).length > 0
        ? `Scénario calibré : ${Object.entries(params).map(([k, v]) => `${k} = ${v}`).join(' · ')}`
        : 'Scénario aux valeurs par défaut (aucun historique analysé)',
      'Projet liant l’entrepôt et le scénario',
    ];
    return h('div', {}, [
      h('h3', { text: 'Récapitulatif' }),
      h('p', {}, ['Nom : ', nameInput]),
      h('ul', { class: 'explain' }, items.map((text) => h('li', { text }))),
    ]);
  }

  function renderStep() {
    const id = ORDER[stepIndex];
    els.body.textContent = '';
    els.body.append(id === 'summary' ? renderSummary() : renderExtraction(id));
    els.back.disabled = stepIndex === 0;
    els.skip.hidden = id === 'locations' || id === 'summary';
    els.next.textContent = id === 'summary' ? 'Créer' : 'Suivant';
    els.next.disabled = id === 'locations' && data.locations === undefined;
  }

  els.back.addEventListener('click', () => {
    if (stepIndex === 0) return;
    stepIndex--;
    setStatus('');
    renderStep();
  });
  els.skip.addEventListener('click', () => {
    delete data[ORDER[stepIndex]];
    stepIndex++;
    setStatus('');
    renderStep();
  });
  els.next.addEventListener('click', async () => {
    if (ORDER[stepIndex] !== 'summary') {
      stepIndex++;
      setStatus('');
      renderStep();
      return;
    }
    els.next.disabled = true;
    setStatus('Création en cours…');
    try {
      await onCreate({
        definition: draftWarehouse(data.locations.aggregate, { name }),
        params: collectedParams(),
        name,
      });
      els.wizard.hidden = true;
    } catch (error) {
      setStatus(`Échec de la création : ${error.message}`, true);
      els.next.disabled = false;
    }
  });
  els.close.addEventListener('click', () => {
    els.wizard.hidden = true;
  });

  return {
    open() {
      stepIndex = 0;
      ui = {};
      data = {};
      name = 'Import WMS';
      setStatus('');
      els.wizard.hidden = false;
      renderStep();
    },
  };
}
