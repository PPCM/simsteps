// Point d'entrée du frontend : panneau latéral (projet, entrepôt,
// scénario, curseurs, spaghetti/heatmap), KPI en direct pendant la
// relecture, enregistrement des runs, comparaison et éditeur 3D
// d'entrepôt. La simulation s'exécute dans le navigateur ; chaque
// changement de paramètre relance un run complet (quelques
// millisecondes) puis la relecture repart de zéro.

import { buildWarehouse, facilityList } from '/sim/warehouse.js';
import { runSimulation, DEFAULT_SCENARIO } from '/sim/engine.js';
import { createWarehouseScene } from './scene.js';
import { createRecorder } from './timeline.js';
import { createOperatorLayer } from './operators.js';
import { createTrailLayer } from './spaghetti.js';
import { createHeatmapLayer } from './heatmap.js';
import { createKpiSampler, kpiAt } from './kpiSampler.js';
import { buildComparisonRows } from './compare.js';
import { slotCount } from './layout.js';
import { splitSettings, buildSettings, mergeProjectParams } from './projects.js';
import {
  moveAisle, moveFacility, moveCorridor, addAisle, removeAisle, addWorkshop, removeWorkshop,
  addShipping, addReceiving, removeZone,
  updateAisle, updateFacility, updateGlobals, validateDefinition,
  duplicateDefinition, minimalDefinition, normalizeDefinition,
} from './editor/model.js';
import { createEditorControls } from './editor/controls.js';
import { renderSelection, renderGlobals, renderErrors } from './editor/panel.js';
import { kpiSummaryText } from './panels.js';
import { setupWindow, setupTabs } from './windows.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), clock: $('clock'), play: $('play'), hint: $('hint'),
  playMini: $('playMini'), clockMini: $('clockMini'), kpiSummary: $('kpiSummary'),
  editDot: $('editDot'),
  project: $('project'), projectName: $('projectName'),
  projectCreate: $('projectCreate'), projectUpdate: $('projectUpdate'),
  projectDelete: $('projectDelete'), projectStatus: $('projectStatus'),
  warehouse: $('warehouse'), warehouseEdit: $('warehouseEdit'),
  warehouseCreate: $('warehouseCreate'), warehouseDuplicate: $('warehouseDuplicate'),
  warehouseDelete: $('warehouseDelete'), warehouseStatus: $('warehouseStatus'),
  editPanel: $('editPanel'), selProps: $('selProps'), globalProps: $('globalProps'),
  editAddAisle: $('editAddAisle'), editAddWorkshop: $('editAddWorkshop'),
  editAddShipping: $('editAddShipping'), editAddReceiving: $('editAddReceiving'),
  editRemoveSelection: $('editRemoveSelection'),
  editSave: $('editSave'), editCancel: $('editCancel'), editErrors: $('editErrors'),
  scenario: $('scenario'), opCount: $('opCount'), b2cShare: $('b2cShare'), orderRate: $('orderRate'),
  opCountVal: $('opCountVal'), b2cShareVal: $('b2cShareVal'), orderRateVal: $('orderRateVal'),
  toggleTrails: $('toggleTrails'), toggleHeatmap: $('toggleHeatmap'),
  toggleLabels: $('toggleLabels'),
  saveRun: $('saveRun'), saveStatus: $('saveStatus'),
  cmpA: $('cmpA'), cmpB: $('cmpB'), cmpRun: $('cmpRun'), cmpStatus: $('cmpStatus'), cmpTable: $('cmpTable'),
};

const HINT_DEFAULT = 'Glisser : orbite · Molette : zoom · Clic droit : déplacement';
const HINT_EDIT = 'Glisser un élément : déplacer · Clic dans le vide : orbite';

// Fenêtres flottantes (drag, repli, mémorisation) et onglets — branchés
// avant le chargement des données pour rester utilisables même en erreur
setupWindow($('winMain'), 'simsteps.fenetre.principale');
setupWindow($('winKpi'), 'simsteps.fenetre.indicateurs');
const editWindow = setupWindow($('editPanel'), 'simsteps.fenetre.edition');
setupTabs(
  [...document.querySelectorAll('.tabs [role="tab"]')],
  [$('panePilot'), $('paneConfig')],
  'simsteps.onglet'
);

const numFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const intFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

// Envoi JSON avec remontée des messages d'erreur français de l'API
async function sendJson(url, method, body) {
  // Pas d'en-tête JSON sans corps : Fastify rejette un corps vide typé
  const response = await fetch(url, {
    method,
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.errors?.join(' · ') ?? data?.error ?? `${url} → ${response.status}`);
  }
  return data;
}

function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatCycle(seconds) {
  if (seconds === null) return '—';
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return min > 0 ? `${min} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

// Affiche un statut d'action, en erreur ou non
function setStatus(el, message, isError = false) {
  el.classList.toggle('error', isError);
  el.textContent = message;
}

try {
  // --- Chargement initial : entrepôts, scénarios, projets ---
  let warehousesList = await fetchJson('/api/warehouses');
  if (warehousesList.length === 0) throw new Error('Aucun entrepôt en base');
  let warehouseId = warehousesList[0].id;
  let { definition } = await fetchJson(`/api/warehouses/${warehouseId}`);
  let warehouse = buildWarehouse(definition);

  const scenarios = await fetchJson('/api/scenarios');
  for (const s of scenarios) {
    els.scenario.append(new Option(s.name, s.id));
  }

  let projects = await fetchJson('/api/projects');
  let activeProjectId = null;
  let extraSettings = {}; // paramétrages du projet hors curseurs

  function refreshWarehouseOptions() {
    els.warehouse.innerHTML = '';
    for (const w of warehousesList) {
      els.warehouse.append(new Option(w.name, w.id));
    }
    els.warehouse.value = String(warehouseId);
  }
  function refreshProjectOptions() {
    els.project.innerHTML = '';
    els.project.append(new Option('— Aucun projet —', ''));
    for (const p of projects) {
      els.project.append(new Option(p.name, p.id));
    }
    els.project.value = activeProjectId === null ? '' : String(activeProjectId);
  }
  refreshWarehouseOptions();
  refreshProjectOptions();

  // --- Scène 3D (statiques reconstructibles au changement d'entrepôt) ---
  const canvas = $('scene');
  const sceneApi = createWarehouseScene(canvas, definition);
  const { camera, scene, renderer, controls } = sceneApi;
  // Poignée de débogage et de tests UI (lecture seule : caméra,
  // contrôles, état des libellés)
  window.simstepsDebug = { camera, controls, labelStats: sceneApi.labelStats };

  // --- État de la relecture ---
  let sim = null; // run courant : timeline, KPI, couches 3D
  let simTime = 0;
  let speed = 10;
  let playing = true;
  let lastFrame = performance.now();
  let lastKpiRefresh = 0;

  function selectedScenario() {
    return scenarios.find((s) => s.id === Number(els.scenario.value));
  }

  function sliderValues() {
    return {
      operators: Number(els.opCount.value),
      b2cShare: Number(els.b2cShare.value) / 100,
      ordersPerHour: Number(els.orderRate.value),
    };
  }

  function currentParams() {
    return mergeProjectParams(selectedScenario()?.params ?? {}, extraSettings, sliderValues());
  }

  function setSliders(params) {
    els.opCount.value = params.operators;
    els.b2cShare.value = Math.round(params.b2cShare * 100);
    els.orderRate.value = params.ordersPerHour;
    refreshSliderLabels();
  }

  function syncSlidersFromScenario() {
    setSliders({ ...DEFAULT_SCENARIO, ...(selectedScenario()?.params ?? {}) });
  }

  function refreshSliderLabels() {
    els.opCountVal.textContent = els.opCount.value;
    els.b2cShareVal.textContent = `${els.b2cShare.value} % B2C`;
    els.orderRateVal.textContent = `${els.orderRate.value} cmd/h`;
  }

  // Recharge un entrepôt et reconstruit la scène statique
  async function loadWarehouse(id) {
    warehouseId = id;
    ({ definition } = await fetchJson(`/api/warehouses/${id}`));
    warehouse = buildWarehouse(definition);
    sceneApi.setDefinition(definition);
    els.warehouse.value = String(id);
  }

  // --- Exécution d'un run et construction des couches 3D ---
  function runCurrent() {
    sim?.dispose();
    const params = currentParams();
    const merged = { ...DEFAULT_SCENARIO, ...params };
    const durationSec = merged.durationHours * 3600;

    const recorder = createRecorder(warehouse.graph);
    const sampler = createKpiSampler(20);
    const result = runSimulation(warehouse, params, { ...recorder.hooks, ...sampler.hooks });
    const tracks = recorder.finish(warehouse.shippingNodeId);
    sampler.finish(durationSec, result.orders, result.operators);

    const operators = createOperatorLayer(scene, tracks);
    const trails = createTrailLayer(scene, tracks);
    const heatmap = createHeatmapLayer(scene, warehouse.graph, result.traffic);
    trails.setVisible(els.toggleTrails.checked);
    heatmap.setVisible(els.toggleHeatmap.checked);

    sim = {
      samples: sampler.samples,
      kpis: result.kpis,
      durationSec,
      operators,
      trails,
      heatmap,
      dispose() {
        operators.dispose();
        trails.dispose();
        heatmap.dispose();
      },
    };
    simTime = 0;
    setPlaying(true);
    els.status.textContent =
      `${definition.name} — ${slotCount(definition)} empl. · ${merged.operators} opérateurs`;
  }

  // --- KPI en direct ---
  function refreshKpis() {
    const k = kpiAt(sim.samples, simTime);
    $('kpi-orders').textContent = `${intFr.format(k.ordersCompleted)} / ${intFr.format(k.ordersCreated)}`;
    $('kpi-oph').textContent = numFr.format(k.ordersPerHour);
    $('kpi-lph').textContent = numFr.format(k.linesPerHour);
    $('kpi-dist').textContent = `${intFr.format(k.avgDistancePerOperatorM)} m`;
    $('kpi-occ').textContent = `${numFr.format(k.occupancyRate * 100)} %`;
    $('kpi-cycle').textContent = formatCycle(k.avgCycleTimeSec);
    $('kpi-pending').textContent = intFr.format(k.pendingOrders);
    els.kpiSummary.textContent = kpiSummaryText(k);
  }

  // --- Transport ---
  const speedButtons = [...document.querySelectorAll('[data-speed]')];
  function setSpeed(value) {
    speed = value;
    for (const btn of speedButtons) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.speed) === value));
    }
  }
  for (const btn of speedButtons) {
    btn.addEventListener('click', () => setSpeed(Number(btn.dataset.speed)));
  }
  setSpeed(speed);

  function setPlaying(value) {
    playing = value;
    // Le bouton de la fenêtre et celui de la barre repliée restent synchrones
    for (const btn of [els.play, els.playMini]) {
      btn.textContent = playing ? '⏸' : '▶';
      btn.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
    }
  }
  function togglePlay() {
    if (!sim) return;
    if (!playing && simTime >= sim.durationSec) simTime = 0;
    setPlaying(!playing);
  }
  els.play.addEventListener('click', togglePlay);
  els.playMini.addEventListener('click', togglePlay);

  // --- Panneau : scénario, curseurs, interrupteurs ---
  els.scenario.addEventListener('change', () => {
    syncSlidersFromScenario();
    runCurrent();
  });
  for (const slider of [els.opCount, els.b2cShare, els.orderRate]) {
    slider.addEventListener('input', refreshSliderLabels);
    slider.addEventListener('change', runCurrent);
  }
  els.toggleTrails.addEventListener('change', () => {
    if (!sim) return;
    sim.trails.setVisible(els.toggleTrails.checked);
    sim.trails.update(simTime);
  });
  els.toggleHeatmap.addEventListener('change', () => {
    sim?.heatmap.setVisible(els.toggleHeatmap.checked);
  });

  // --- Libellés : interrupteur global et révélation au clic ---
  els.toggleLabels.addEventListener('change', () => {
    sceneApi.setLabelsVisible(!els.toggleLabels.checked);
  });
  // Un clic (sans glisser : l'orbite génère aussi un click) sur un objet
  // révèle son libellé quand les libellés sont masqués
  let pointerDownAt = null;
  canvas.addEventListener('pointerdown', (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('click', (event) => {
    if (!els.toggleLabels.checked) return;
    if (pointerDownAt &&
        Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 5) {
      return; // fin d'orbite, pas un clic de désignation
    }
    sceneApi.revealLabel(sceneApi.pick(event.clientX, event.clientY));
  });

  // --- Projets : application, création, mise à jour, suppression ---
  function activeProject() {
    return projects.find((p) => p.id === activeProjectId);
  }

  // Applique un projet : entrepôt, scénario, curseurs et extras
  async function applyProject(project) {
    activeProjectId = project.id;
    els.projectName.value = project.name;
    if (project.warehouse_id !== warehouseId) {
      await loadWarehouse(project.warehouse_id);
    }
    if (project.scenario_id !== null && scenarios.some((s) => s.id === project.scenario_id)) {
      els.scenario.value = String(project.scenario_id);
    }
    extraSettings = splitSettings(project.settings).extras;
    setSliders({
      ...DEFAULT_SCENARIO,
      ...(selectedScenario()?.params ?? {}),
      ...project.settings,
    });
    runCurrent();
    await refreshCompareOptions();
  }

  function clearProject() {
    activeProjectId = null;
    extraSettings = {};
    els.projectName.value = '';
  }

  function projectBody() {
    return {
      name: els.projectName.value.trim() || 'Projet sans nom',
      warehouseId,
      scenarioId: Number(els.scenario.value),
      settings: buildSettings(extraSettings, sliderValues()),
    };
  }

  els.project.addEventListener('change', async () => {
    setStatus(els.projectStatus, '');
    if (els.project.value === '') {
      clearProject();
      syncSlidersFromScenario();
      runCurrent();
      await refreshCompareOptions();
      return;
    }
    const project = projects.find((p) => p.id === Number(els.project.value));
    if (project) await applyProject(project);
  });

  els.projectCreate.addEventListener('click', async () => {
    setStatus(els.projectStatus, 'Création…');
    try {
      const created = await sendJson('/api/projects', 'POST', projectBody());
      projects = await fetchJson('/api/projects');
      activeProjectId = created.id;
      els.projectName.value = created.name;
      refreshProjectOptions();
      setStatus(els.projectStatus, `Projet « ${created.name} » créé.`);
      await refreshCompareOptions();
    } catch (error) {
      setStatus(els.projectStatus, `Échec : ${error.message}`, true);
    }
  });

  els.projectUpdate.addEventListener('click', async () => {
    if (activeProjectId === null) {
      setStatus(els.projectStatus, 'Aucun projet actif à mettre à jour.', true);
      return;
    }
    setStatus(els.projectStatus, 'Mise à jour…');
    try {
      const updated = await sendJson(`/api/projects/${activeProjectId}`, 'PUT', projectBody());
      projects = projects.map((p) => (p.id === updated.id ? updated : p));
      refreshProjectOptions();
      setStatus(els.projectStatus, `Projet « ${updated.name} » mis à jour.`);
    } catch (error) {
      setStatus(els.projectStatus, `Échec : ${error.message}`, true);
    }
  });

  els.projectDelete.addEventListener('click', async () => {
    const project = activeProject();
    if (!project) {
      setStatus(els.projectStatus, 'Aucun projet actif à supprimer.', true);
      return;
    }
    if (!window.confirm(`Supprimer le projet « ${project.name} » ? Les runs associés seront conservés.`)) return;
    try {
      await sendJson(`/api/projects/${project.id}`, 'DELETE');
      projects = projects.filter((p) => p.id !== project.id);
      clearProject();
      refreshProjectOptions();
      setStatus(els.projectStatus, 'Projet supprimé.');
      await refreshCompareOptions();
    } catch (error) {
      setStatus(els.projectStatus, `Échec : ${error.message}`, true);
    }
  });

  // --- Entrepôts : sélection, création, duplication, suppression ---
  els.warehouse.addEventListener('change', async () => {
    setStatus(els.warehouseStatus, '');
    await loadWarehouse(Number(els.warehouse.value));
    runCurrent();
    await refreshCompareOptions();
  });

  els.warehouseCreate.addEventListener('click', async () => {
    setStatus(els.warehouseStatus, 'Création…');
    try {
      const created = await sendJson('/api/warehouses', 'POST', minimalDefinition());
      warehousesList = await fetchJson('/api/warehouses');
      refreshWarehouseOptions();
      await loadWarehouse(created.id);
      runCurrent();
      await refreshCompareOptions();
      setStatus(els.warehouseStatus, `Entrepôt « ${created.name} » créé.`);
      enterEdit();
    } catch (error) {
      setStatus(els.warehouseStatus, `Échec : ${error.message}`, true);
    }
  });

  els.warehouseDuplicate.addEventListener('click', async () => {
    setStatus(els.warehouseStatus, 'Duplication…');
    try {
      const created = await sendJson('/api/warehouses', 'POST', duplicateDefinition(definition));
      warehousesList = await fetchJson('/api/warehouses');
      refreshWarehouseOptions();
      await loadWarehouse(created.id);
      runCurrent();
      await refreshCompareOptions();
      setStatus(els.warehouseStatus, `Entrepôt « ${created.name} » créé.`);
    } catch (error) {
      setStatus(els.warehouseStatus, `Échec : ${error.message}`, true);
    }
  });

  els.warehouseDelete.addEventListener('click', async () => {
    const entry = warehousesList.find((w) => w.id === warehouseId);
    if (warehousesList.length <= 1) {
      setStatus(els.warehouseStatus, 'Impossible de supprimer le dernier entrepôt.', true);
      return;
    }
    if (!window.confirm(
      `Supprimer l'entrepôt « ${entry.name} » ? Les runs et les projets associés seront supprimés.`
    )) return;
    try {
      await sendJson(`/api/warehouses/${warehouseId}`, 'DELETE');
      warehousesList = warehousesList.filter((w) => w.id !== warehouseId);
      projects = await fetchJson('/api/projects');
      if (activeProjectId !== null && !activeProject()) clearProject();
      refreshProjectOptions();
      refreshWarehouseOptions();
      await loadWarehouse(warehousesList[0].id);
      runCurrent();
      await refreshCompareOptions();
      setStatus(els.warehouseStatus, 'Entrepôt supprimé.');
    } catch (error) {
      setStatus(els.warehouseStatus, `Échec : ${error.message}`, true);
    }
  });

  // --- Éditeur 3D : mode édition de l'entrepôt courant ---
  let editing = false;
  let workingDef = null; // définition de travail (clonée à l'entrée)
  let selection = null; // { type, id } de l'élément sélectionné

  // Éléments neutralisés pendant l'édition
  const editLocked = [
    els.play, els.playMini, ...speedButtons, els.scenario, els.opCount, els.b2cShare, els.orderRate,
    els.saveRun, els.project, els.projectName, els.projectCreate, els.projectUpdate,
    els.projectDelete, els.warehouse, els.warehouseEdit, els.warehouseCreate,
    els.warehouseDuplicate, els.warehouseDelete, els.cmpA, els.cmpB, els.cmpRun,
  ];
  function setEditingUI(value) {
    for (const el of editLocked) el.disabled = value;
    els.editPanel.hidden = !value;
    // Une position mémorisée peut dépasser la fenêtre actuelle du navigateur
    if (value) editWindow.reclamp();
    els.editDot.hidden = !value; // point ambre sur l'onglet Configurer
    els.hint.textContent = value ? HINT_EDIT : HINT_DEFAULT;
  }

  function findFacility(def, kind, id) {
    return kind === 'workshop'
      ? def.workshops.find((w) => w.id === id)
      : facilityList(def[kind]).find((z) => z.id === id);
  }

  function renderSelectionPanel() {
    renderSelection(els.selProps, workingDef, selection, (props) => {
      let next;
      if (selection.type === 'corridor') {
        // La position d'un couloir vit dans les propriétés globales
        next = updateGlobals(workingDef, selection.id === 'front'
          ? { frontY: props.y }
          : { backY: props.y });
      } else {
        next = selection.type === 'aisle'
          ? updateAisle(workingDef, selection.id, props)
          : updateFacility(workingDef, selection.type, selection.id, props);
        if (props.id !== undefined) selection = { ...selection, id: props.id };
      }
      applyWorkingDef(next);
    });
  }
  function renderGlobalsPanel() {
    renderGlobals(els.globalProps, workingDef, (props) => {
      // Changer la taille du sol recadre la caméra : la profondeur
      // grandit vers la caméra, le nouvel espace serait hors écran
      const resized = props.width !== undefined || props.depth !== undefined;
      applyWorkingDef(updateGlobals(workingDef, props), { recenter: resized });
    });
  }

  // Applique une définition de travail : validation, reconstruction de
  // la scène si valide (sinon la scène garde le dernier état valide)
  function applyWorkingDef(next, { recenter = false } = {}) {
    workingDef = next;
    const errors = validateDefinition(workingDef, buildWarehouse);
    renderErrors(els.editErrors, errors);
    els.editSave.disabled = errors.length > 0;
    if (errors.length === 0) {
      // Pas de recadrage hors redimensionnement du sol : l'orientation
      // choisie pendant l'édition est conservée
      sceneApi.setDefinition(workingDef, { recenter });
      editorControls.setSelection(selection);
    }
    renderSelectionPanel();
    renderGlobalsPanel();
  }

  const editorControls = createEditorControls({
    canvas,
    camera,
    orbit: controls,
    getPickables: sceneApi.getPickables,
    onSelect(sel) {
      selection = sel;
      renderSelectionPanel();
    },
    // Aperçu du drag : mêmes accrochage et bornes que le commit
    constrainDelta(type, id, delta) {
      if (type === 'corridor') {
        const key = id === 'front' ? 'frontY' : 'backY';
        const y0 = workingDef.corridors[key];
        const moved = moveCorridor(workingDef, id, { y: y0 + delta.dz });
        return { dx: 0, dz: moved.corridors[key] - y0 };
      }
      if (type === 'aisle') {
        const aisle = workingDef.aisles.find((a) => a.id === id);
        const moved = moveAisle(workingDef, id, {
          x: aisle.x + delta.dx, yStart: aisle.yStart + delta.dz,
        }).aisles.find((a) => a.id === id);
        return { dx: moved.x - aisle.x, dz: moved.yStart - aisle.yStart };
      }
      const facility = findFacility(workingDef, type, id);
      const moved = findFacility(
        moveFacility(workingDef, type, id, { x: facility.x + delta.dx, y: facility.y + delta.dz }),
        type, id
      );
      return { dx: moved.x - facility.x, dz: moved.y - facility.y };
    },
    onMoved(type, id, delta) {
      if (type === 'corridor') {
        const y0 = workingDef.corridors[id === 'front' ? 'frontY' : 'backY'];
        applyWorkingDef(moveCorridor(workingDef, id, { y: y0 + delta.dz }));
        return;
      }
      if (type === 'aisle') {
        const aisle = workingDef.aisles.find((a) => a.id === id);
        applyWorkingDef(moveAisle(workingDef, id, {
          x: aisle.x + delta.dx, yStart: aisle.yStart + delta.dz,
        }));
      } else {
        const facility = findFacility(workingDef, type, id);
        applyWorkingDef(moveFacility(workingDef, type, id, {
          x: facility.x + delta.dx, y: facility.y + delta.dz,
        }));
      }
    },
  });

  function enterEdit() {
    if (editing) return;
    editing = true;
    setPlaying(false);
    sim?.dispose();
    sim = null;
    // Normalisation : zones en listes et dimensions par défaut explicites
    workingDef = normalizeDefinition(definition);
    selection = null;
    setEditingUI(true);
    editorControls.setEnabled(true);
    renderSelectionPanel();
    renderGlobalsPanel();
    renderErrors(els.editErrors, []);
    els.editSave.disabled = false;
    els.status.textContent = 'Mode édition — simulation en pause';
  }

  function exitEdit() {
    editing = false;
    selection = null;
    workingDef = null;
    editorControls.setEnabled(false);
    setEditingUI(false);
  }

  els.warehouseEdit.addEventListener('click', enterEdit);

  els.editAddAisle.addEventListener('click', () => {
    const next = addAisle(workingDef);
    selection = { type: 'aisle', id: next.aisles[next.aisles.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddWorkshop.addEventListener('click', () => {
    const next = addWorkshop(workingDef);
    selection = { type: 'workshop', id: next.workshops[next.workshops.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddShipping.addEventListener('click', () => {
    const next = addShipping(workingDef);
    selection = { type: 'shipping', id: next.shipping[next.shipping.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddReceiving.addEventListener('click', () => {
    const next = addReceiving(workingDef);
    selection = { type: 'receiving', id: next.receiving[next.receiving.length - 1].id };
    applyWorkingDef(next);
  });
  els.editRemoveSelection.addEventListener('click', () => {
    if (!selection) {
      renderErrors(els.editErrors, ['Aucun élément sélectionné.']);
      return;
    }
    try {
      let next;
      if (selection.type === 'corridor') throw new Error('Les couloirs ne peuvent pas être supprimés.');
      if (selection.type === 'aisle') next = removeAisle(workingDef, selection.id);
      else if (selection.type === 'workshop') next = removeWorkshop(workingDef, selection.id);
      else next = removeZone(workingDef, selection.type, selection.id);
      selection = null;
      applyWorkingDef(next);
    } catch (error) {
      renderErrors(els.editErrors, [error.message]);
    }
  });

  els.editSave.addEventListener('click', async () => {
    const errors = validateDefinition(workingDef, buildWarehouse);
    if (errors.length > 0) {
      renderErrors(els.editErrors, errors);
      return;
    }
    try {
      await sendJson(`/api/warehouses/${warehouseId}`, 'PUT', {
        name: workingDef.name,
        definition: workingDef,
      });
      definition = workingDef;
      warehouse = buildWarehouse(definition);
      const entry = warehousesList.find((w) => w.id === warehouseId);
      if (entry) entry.name = definition.name;
      exitEdit();
      refreshWarehouseOptions();
      sceneApi.setDefinition(definition, { recenter: false });
      runCurrent();
      setStatus(els.warehouseStatus, 'Entrepôt enregistré.');
    } catch (error) {
      renderErrors(els.editErrors, [error.message]);
    }
  });

  els.editCancel.addEventListener('click', () => {
    exitEdit();
    sceneApi.setDefinition(definition, { recenter: false });
    runCurrent();
    setStatus(els.warehouseStatus, 'Modifications abandonnées.');
  });

  // --- Enregistrement du run courant en base ---
  els.saveRun.addEventListener('click', async () => {
    setStatus(els.saveStatus, 'Enregistrement…');
    try {
      const run = await sendJson('/api/runs', 'POST', {
        warehouseId,
        scenarioId: Number(els.scenario.value),
        projectId: activeProjectId ?? undefined,
        overrides: buildSettings(extraSettings, sliderValues()),
      });
      setStatus(els.saveStatus, `Run nᵒ ${run.id} enregistré.`);
      await refreshCompareOptions();
    } catch (error) {
      setStatus(els.saveStatus, `Échec : ${error.message}`, true);
    }
  });

  // --- Comparaison : scénarios, run courant, runs enregistrés ---
  async function refreshCompareOptions() {
    // Avec un projet actif, seuls ses runs sont proposés
    const filter = activeProjectId !== null
      ? `projectId=${activeProjectId}`
      : `warehouseId=${warehouseId}`;
    const runs = await fetchJson(`/api/runs?${filter}`);
    for (const select of [els.cmpA, els.cmpB]) {
      const previous = select.value;
      select.innerHTML = '';
      select.append(new Option('Réglages actuels', 'current'));
      for (const s of scenarios) {
        select.append(new Option(`Scénario : ${s.name}`, `scenario:${s.id}`));
      }
      for (const r of runs) {
        const when = new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
        select.append(new Option(`Run nᵒ ${r.id} — ${r.scenario_snapshot.name ?? 'sans nom'} (${when})`, `run:${r.id}`));
      }
      if ([...select.options].some((o) => o.value === previous)) select.value = previous;
    }
    if (els.cmpB.options.length > 1 && els.cmpA.value === els.cmpB.value) {
      els.cmpB.selectedIndex = 1;
    }
  }

  async function kpisForOption(value) {
    if (value === 'current') return sim.kpis;
    if (value.startsWith('scenario:')) {
      const s = scenarios.find((x) => x.id === Number(value.slice('scenario:'.length)));
      return runSimulation(warehouse, s.params).kpis;
    }
    const run = await fetchJson(`/api/runs/${value.slice('run:'.length)}`);
    return run.kpis;
  }

  els.cmpRun.addEventListener('click', async () => {
    setStatus(els.cmpStatus, 'Comparaison…');
    try {
      const [kpisA, kpisB] = await Promise.all([
        kpisForOption(els.cmpA.value),
        kpisForOption(els.cmpB.value),
      ]);
      const tbody = els.cmpTable.querySelector('tbody');
      tbody.innerHTML = '';
      for (const row of buildComparisonRows(kpisA, kpisB)) {
        const tr = document.createElement('tr');
        const deltaClass = row.improved === true ? 'better' : row.improved === false ? 'worse' : '';
        tr.innerHTML =
          `<td>${row.label}</td><td>${row.a}</td><td>${row.b}</td>` +
          `<td class="${deltaClass}">${row.delta}</td>`;
        tbody.appendChild(tr);
      }
      els.cmpTable.hidden = false;
      setStatus(els.cmpStatus, '');
    } catch (error) {
      setStatus(els.cmpStatus, `Échec : ${error.message}`, true);
    }
  });

  // --- Boucle de rendu ---
  function fit() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  fit();
  window.addEventListener('resize', fit);

  renderer.setAnimationLoop((nowMs) => {
    const dt = (nowMs - lastFrame) / 1000;
    lastFrame = nowMs;
    if (sim && playing) {
      simTime += dt * speed;
      if (simTime >= sim.durationSec) {
        simTime = sim.durationSec;
        setPlaying(false);
      }
      sim.operators.update(simTime);
      sim.trails.update(simTime);
    }
    if (sim && nowMs - lastKpiRefresh > 250) {
      lastKpiRefresh = nowMs;
      refreshKpis();
      els.clock.textContent = `${formatClock(simTime)} / ${formatClock(sim.durationSec)}`;
      els.clockMini.textContent = formatClock(simTime);
      $('progressFill').style.width = `${(simTime / sim.durationSec) * 100}%`;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  // --- Démarrage ---
  syncSlidersFromScenario();
  runCurrent();
  await refreshCompareOptions();
} catch (error) {
  els.status.textContent = `Erreur de chargement : ${error.message}`;
  els.status.classList.add('error');
}
