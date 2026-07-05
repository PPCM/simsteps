// Point d'entrée du frontend : panneau latéral (projet, entrepôt,
// scénario, curseurs, spaghetti/heatmap), KPI en direct pendant la
// relecture, enregistrement des runs, comparaison et éditeur 3D
// d'entrepôt. La simulation s'exécute dans le navigateur ; chaque
// changement de paramètre relance un run complet (quelques
// millisecondes) puis la relecture repart de zéro.

import { buildWarehouse, facilityList } from '/sim/warehouse.js';
import { runSimulation, DEFAULT_SCENARIO } from '/sim/engine.js';
import { VEHICLES } from '/sim/vehicles.js';
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
  addShipping, addReceiving, removeZone, addParking, removeParking,
  addBuffer, removeBuffer, addObstacle, removeObstacle,
  addCorridor, removeCorridor, updateCorridor,
  addConveyor, removeConveyor, updateConveyor, moveConveyor,
  updateAisle, updateFacility, updateGlobals, validateDefinition,
  duplicateDefinition, duplicateElement, minimalDefinition, normalizeDefinition,
} from './editor/model.js';
import { createEditorControls } from './editor/controls.js';
import { renderSelection, renderGlobals, renderErrors, renderTree } from './editor/panel.js';
import { buildTree } from './editor/tree.js';
import { kpiSummaryText } from './panels.js';
import { setupWindow, setupTabs } from './windows.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), clock: $('clock'), play: $('play'), hint: $('hint'),
  playMini: $('playMini'), clockMini: $('clockMini'), kpiSummary: $('kpiSummary'),
  project: $('project'), projectName: $('projectName'),
  projectCreate: $('projectCreate'), projectUpdate: $('projectUpdate'),
  projectDelete: $('projectDelete'), projectStatus: $('projectStatus'),
  warehouse: $('warehouse'), warehouseEdit: $('warehouseEdit'),
  warehouseCreate: $('warehouseCreate'), warehouseDuplicate: $('warehouseDuplicate'),
  warehouseDelete: $('warehouseDelete'), warehouseStatus: $('warehouseStatus'),
  editChrome: $('editChrome'), editTree: $('editTree'),
  editTitle: $('editTitle'), editCoords: $('editCoords'), editValidity: $('editValidity'),
  editDuplicate: $('editDuplicate'),
  selProps: $('selProps'), globalProps: $('globalProps'),
  editAddAisle: $('editAddAisle'), editAddWorkshop: $('editAddWorkshop'),
  editAddShipping: $('editAddShipping'), editAddReceiving: $('editAddReceiving'),
  editAddCorridor: $('editAddCorridor'), editAddParking: $('editAddParking'),
  editAddBuffer: $('editAddBuffer'), editAddObstacle: $('editAddObstacle'),
  editAddConveyor: $('editAddConveyor'),
  replenishment: $('replenishment'), inboundTrucks: $('inboundTrucks'), packers: $('packers'),
  corridorExclusion: $('corridorExclusion'),
  editRemoveSelection: $('editRemoveSelection'),
  editSave: $('editSave'), editCancel: $('editCancel'), editErrors: $('editErrors'),
  scenario: $('scenario'), opCount: $('opCount'), fleetInputs: $('fleetInputs'),
  b2cShare: $('b2cShare'), orderRate: $('orderRate'), slotting: $('slotting'),
  opCountVal: $('opCountVal'), b2cShareVal: $('b2cShareVal'), orderRateVal: $('orderRateVal'),
  toggleTrails: $('toggleTrails'), toggleHeatmap: $('toggleHeatmap'),
  toggleLabels: $('toggleLabels'),
  saveRun: $('saveRun'), saveStatus: $('saveStatus'),
  cmpA: $('cmpA'), cmpB: $('cmpB'), cmpRun: $('cmpRun'), cmpStatus: $('cmpStatus'), cmpTable: $('cmpTable'),
};

// Fenêtres flottantes (drag, repli, mémorisation) et onglets — branchés
// avant le chargement des données pour rester utilisables même en erreur
setupWindow($('winMain'), 'simsteps.fenetre.principale');
setupWindow($('winKpi'), 'simsteps.fenetre.indicateurs');
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
  // contrôles, état des libellés, scène)
  window.simstepsDebug = { camera, controls, labelStats: sceneApi.labelStats, scene };

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

  // Compteurs d'engins de manutention, générés depuis le catalogue
  // (le piéton est piloté par le curseur Opérateurs)
  const fleetEls = new Map();
  for (const [type, profile] of Object.entries(VEHICLES)) {
    if (type === 'pieton') continue;
    const label = document.createElement('label');
    label.className = 'field';
    label.title = `Gabarit d'allée min. ${profile.aisleWidthM} m · levée ${profile.liftM} m`;
    const head = document.createElement('span');
    head.className = 'field-head';
    head.innerHTML = `<span>${profile.label}</span>`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '50';
    input.step = '1';
    input.value = '0';
    label.append(head, input);
    els.fleetInputs.append(label);
    fleetEls.set(type, input);
  }

  function sliderValues() {
    const fleet = { pieton: Number(els.opCount.value) };
    for (const [type, input] of fleetEls) {
      const count = Number(input.value);
      if (count > 0) fleet[type] = count;
    }
    return {
      operators: Number(els.opCount.value),
      fleet,
      b2cShare: Number(els.b2cShare.value) / 100,
      ordersPerHour: Number(els.orderRate.value),
      slotting: els.slotting.value,
      replenishment: els.replenishment.checked,
      inboundTrucksPerDay: Number(els.inboundTrucks.value),
      packers: Number(els.packers.value),
      corridorExclusion: els.corridorExclusion.checked,
    };
  }

  function currentParams() {
    return mergeProjectParams(selectedScenario()?.params ?? {}, extraSettings, sliderValues());
  }

  function setSliders(params) {
    els.opCount.value = params.fleet?.pieton ?? params.operators;
    for (const [type, input] of fleetEls) {
      input.value = params.fleet?.[type] ?? 0;
    }
    els.b2cShare.value = Math.round(params.b2cShare * 100);
    els.orderRate.value = params.ordersPerHour;
    els.slotting.value = params.slotting ?? 'aleatoire';
    els.replenishment.checked = params.replenishment === true;
    els.inboundTrucks.value = params.inboundTrucksPerDay ?? 0;
    els.packers.value = params.packers ?? 0;
    els.corridorExclusion.checked = params.corridorExclusion === true;
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

  // Une flotte vide n'a pas de sens : garantit au moins un agent
  function ensureFleet() {
    const engins = [...fleetEls.values()].reduce((sum, input) => sum + Number(input.value), 0);
    if (Number(els.opCount.value) + engins === 0) {
      els.opCount.value = 1;
      refreshSliderLabels();
    }
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
    ensureFleet();
    const params = currentParams();
    const merged = { ...DEFAULT_SCENARIO, ...params };
    const durationSec = merged.durationHours * 3600;

    const recorder = createRecorder(warehouse.graph);
    const sampler = createKpiSampler(20);
    const result = runSimulation(warehouse, params, { ...recorder.hooks, ...sampler.hooks });
    const tracks = recorder.finish(
      result.operators.map((op) => ({ id: op.id, startNodeId: op.startNodeId }))
    );
    sampler.finish(durationSec, result.orders, result.operators);

    const vehicleByOp = new Map(result.operators.map((op) => [op.id, op.vehicle]));
    const operators = createOperatorLayer(scene, tracks, vehicleByOp);
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
    const agents = merged.fleet
      ? Object.values(merged.fleet).reduce((sum, count) => sum + count, 0)
      : merged.operators;
    els.status.textContent =
      `${definition.name} — ${slotCount(definition)} empl. · ${agents} opérateurs`;
  }

  // --- KPI en direct ---
  function refreshKpis() {
    const k = kpiAt(sim.samples, simTime);
    $('kpi-orders').textContent = `${intFr.format(k.ordersCompleted)} / ${intFr.format(k.ordersCreated)}`;
    $('kpi-oph').textContent = numFr.format(k.ordersPerHour);
    $('kpi-lph').textContent = numFr.format(k.linesPerHour);
    $('kpi-dist').textContent = `${intFr.format(k.avgDistancePerOperatorM)} m`;
    $('kpi-distline').textContent = k.distancePerLineM !== null && k.distancePerLineM !== undefined
      ? `${numFr.format(k.distancePerLineM)} m` : '—';
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
  for (const input of fleetEls.values()) {
    input.addEventListener('change', runCurrent);
  }
  els.slotting.addEventListener('change', runCurrent);
  for (const control of [els.replenishment, els.inboundTrucks, els.packers, els.corridorExclusion]) {
    control.addEventListener('change', runCurrent);
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

  // Le mode édition remplace les fenêtres flottantes (et les aides de
  // relecture) par le chrome fixe : ruban, dock droit, barre d'état
  function setEditingUI(value) {
    $('winMain').hidden = value;
    $('winKpi').hidden = value;
    els.hint.hidden = value;
    document.querySelector('.legend').hidden = value;
    els.editChrome.hidden = !value;
  }

  function findFacility(def, kind, id) {
    if (kind === 'workshop') return def.workshops.find((w) => w.id === id);
    if (kind === 'parking') return (def.parkings ?? []).find((p) => p.id === id);
    if (kind === 'buffer') return (def.buffers ?? []).find((b) => b.id === id);
    if (kind === 'obstacle') return (def.obstacles ?? []).find((o) => o.id === id);
    return facilityList(def[kind]).find((z) => z.id === id);
  }

  function renderSelectionPanel() {
    renderSelection(els.selProps, workingDef, selection, (props) => {
      let next;
      if (selection.type === 'corridor') next = updateCorridor(workingDef, selection.id, props);
      else if (selection.type === 'conveyor') next = updateConveyor(workingDef, selection.id, props);
      else if (selection.type === 'aisle') next = updateAisle(workingDef, selection.id, props);
      else next = updateFacility(workingDef, selection.type, selection.id, props);
      if (props.id !== undefined) selection = { ...selection, id: props.id };
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
  // Arborescence « Structure » : un clic sélectionne comme dans la scène
  function renderTreePanel() {
    renderTree(els.editTree, buildTree(workingDef), selection, (type, id) => {
      selection = { type, id };
      editorControls.setSelection(selection);
      refreshEditPanels();
    });
  }
  // Dock droit : propriétés de la sélection, ou de l'entrepôt sinon
  function refreshEditPanels() {
    els.globalProps.hidden = selection !== null;
    renderSelectionPanel();
    if (selection === null) renderGlobalsPanel();
    renderTreePanel();
  }
  // État de validation dans la barre d'état (le détail reste dans le dock)
  function setValidity(errors) {
    const n = errors.length;
    els.editValidity.textContent = n === 0
      ? '✓ Plan valide'
      : `✗ ${n} erreur${n > 1 ? 's' : ''} de validation`;
    els.editValidity.classList.toggle('ok', n === 0);
    els.editValidity.classList.toggle('bad', n > 0);
  }

  // Applique une définition de travail : validation puis reconstruction
  // de la scène. La scène suit le modèle même quand le réseau de
  // circulation est invalide (l'erreur s'affiche, Enregistrer se
  // bloque) : seules les erreurs géométriques — qui rendraient le plan
  // inconstructible — figent la scène sur le dernier état sain.
  function applyWorkingDef(next, { recenter = false } = {}) {
    workingDef = next;
    els.editTitle.textContent = workingDef.name;
    const errors = validateDefinition(workingDef, buildWarehouse);
    renderErrors(els.editErrors, errors);
    setValidity(errors);
    els.editSave.disabled = errors.length > 0;
    const renderable = errors.every((e) => e.startsWith('définition incohérente'));
    if (renderable) {
      // Pas de recadrage hors redimensionnement du sol : l'orientation
      // choisie pendant l'édition est conservée
      sceneApi.setDefinition(workingDef, { recenter });
      editorControls.setSelection(selection);
    }
    refreshEditPanels();
  }

  const editorControls = createEditorControls({
    canvas,
    camera,
    orbit: controls,
    getPickables: sceneApi.getPickables,
    onSelect(sel) {
      selection = sel;
      refreshEditPanels();
    },
    // Coordonnées du pointeur sur le sol, dans la barre d'état
    onHover(point) {
      els.editCoords.textContent = point
        ? `x ${numFr.format(point.x)} · y ${numFr.format(point.z)} m`
        : '—';
    },
    // Aperçu du drag : mêmes accrochage et bornes que le commit
    constrainDelta(type, id, delta) {
      if (type === 'corridor') {
        const corridor = workingDef.corridors.find((c) => c.id === id);
        const moved = moveCorridor(workingDef, id, {
          x: corridor.x + delta.dx, y: corridor.y + delta.dz,
        }).corridors.find((c) => c.id === id);
        return { dx: moved.x - corridor.x, dz: moved.y - corridor.y };
      }
      if (type === 'conveyor') {
        const conveyor = workingDef.conveyors.find((c) => c.id === id);
        const moved = moveConveyor(workingDef, id, {
          x: conveyor.x + delta.dx, y: conveyor.y + delta.dz,
        }).conveyors.find((c) => c.id === id);
        return { dx: moved.x - conveyor.x, dz: moved.y - conveyor.y };
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
        const corridor = workingDef.corridors.find((c) => c.id === id);
        applyWorkingDef(moveCorridor(workingDef, id, {
          x: corridor.x + delta.dx, y: corridor.y + delta.dz,
        }));
        return;
      }
      if (type === 'conveyor') {
        const conveyor = workingDef.conveyors.find((c) => c.id === id);
        applyWorkingDef(moveConveyor(workingDef, id, {
          x: conveyor.x + delta.dx, y: conveyor.y + delta.dz,
        }));
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
    els.editTitle.textContent = workingDef.name;
    els.editCoords.textContent = '—';
    refreshEditPanels();
    renderErrors(els.editErrors, []);
    setValidity([]);
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
  els.editAddCorridor.addEventListener('click', () => {
    const next = addCorridor(workingDef);
    selection = { type: 'corridor', id: next.corridors[next.corridors.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddParking.addEventListener('click', () => {
    const next = addParking(workingDef);
    selection = { type: 'parking', id: next.parkings[next.parkings.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddBuffer.addEventListener('click', () => {
    const next = addBuffer(workingDef);
    selection = { type: 'buffer', id: next.buffers[next.buffers.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddObstacle.addEventListener('click', () => {
    const next = addObstacle(workingDef);
    selection = { type: 'obstacle', id: next.obstacles[next.obstacles.length - 1].id };
    applyWorkingDef(next);
  });
  els.editAddConveyor.addEventListener('click', () => {
    const next = addConveyor(workingDef);
    selection = { type: 'conveyor', id: next.conveyors[next.conveyors.length - 1].id };
    applyWorkingDef(next);
  });
  // Duplication de la sélection : la copie (dernière de sa liste)
  // devient la sélection courante, prête à être glissée en place
  const LIST_KEYS = {
    aisle: 'aisles', corridor: 'corridors', workshop: 'workshops',
    shipping: 'shipping', receiving: 'receiving', parking: 'parkings',
    buffer: 'buffers', obstacle: 'obstacles', conveyor: 'conveyors',
  };
  els.editDuplicate.addEventListener('click', () => {
    if (!selection) {
      renderErrors(els.editErrors, ['Aucun élément sélectionné.']);
      return;
    }
    try {
      const next = duplicateElement(workingDef, selection.type, selection.id);
      const list = next[LIST_KEYS[selection.type]];
      selection = { type: selection.type, id: list[list.length - 1].id };
      applyWorkingDef(next);
    } catch (error) {
      renderErrors(els.editErrors, [error.message]);
    }
  });
  els.editRemoveSelection.addEventListener('click', () => {
    if (!selection) {
      renderErrors(els.editErrors, ['Aucun élément sélectionné.']);
      return;
    }
    try {
      let next;
      if (selection.type === 'corridor') next = removeCorridor(workingDef, selection.id);
      else if (selection.type === 'aisle') next = removeAisle(workingDef, selection.id);
      else if (selection.type === 'workshop') next = removeWorkshop(workingDef, selection.id);
      else if (selection.type === 'parking') next = removeParking(workingDef, selection.id);
      else if (selection.type === 'buffer') next = removeBuffer(workingDef, selection.id);
      else if (selection.type === 'obstacle') next = removeObstacle(workingDef, selection.id);
      else if (selection.type === 'conveyor') next = removeConveyor(workingDef, selection.id);
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
