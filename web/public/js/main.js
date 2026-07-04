// Point d'entrée du frontend — étape 5 : panneau latéral (scénario,
// curseurs, spaghetti/heatmap), KPI en direct pendant la relecture,
// enregistrement des runs en base et mode comparaison.
// La simulation s'exécute dans le navigateur ; chaque changement de
// paramètre relance un run complet (quelques millisecondes) puis la
// relecture repart de zéro.

import { buildWarehouse } from '/sim/warehouse.js';
import { runSimulation, DEFAULT_SCENARIO } from '/sim/engine.js';
import { createWarehouseScene } from './scene.js';
import { createRecorder } from './timeline.js';
import { createOperatorLayer } from './operators.js';
import { createTrailLayer } from './spaghetti.js';
import { createHeatmapLayer } from './heatmap.js';
import { createKpiSampler, kpiAt } from './kpiSampler.js';
import { buildComparisonRows } from './compare.js';
import { slotCount } from './layout.js';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), clock: $('clock'), play: $('play'),
  scenario: $('scenario'), opCount: $('opCount'), b2cShare: $('b2cShare'), orderRate: $('orderRate'),
  opCountVal: $('opCountVal'), b2cShareVal: $('b2cShareVal'), orderRateVal: $('orderRateVal'),
  toggleTrails: $('toggleTrails'), toggleHeatmap: $('toggleHeatmap'),
  saveRun: $('saveRun'), saveStatus: $('saveStatus'),
  cmpA: $('cmpA'), cmpB: $('cmpB'), cmpRun: $('cmpRun'), cmpStatus: $('cmpStatus'), cmpTable: $('cmpTable'),
};

const numFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const intFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
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

try {
  // --- Chargement initial : entrepôt et scénarios ---
  const warehousesList = await fetchJson('/api/warehouses');
  if (warehousesList.length === 0) throw new Error('Aucun entrepôt en base');
  const warehouseId = warehousesList[0].id;
  const { definition } = await fetchJson(`/api/warehouses/${warehouseId}`);
  const warehouse = buildWarehouse(definition);

  const scenarios = await fetchJson('/api/scenarios');
  for (const s of scenarios) {
    els.scenario.append(new Option(s.name, s.id));
  }

  // --- Scène 3D (construite une seule fois) ---
  const canvas = $('scene');
  const { camera, scene, renderer, controls } = createWarehouseScene(canvas, definition);

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

  function currentParams() {
    return {
      ...(selectedScenario()?.params ?? {}),
      operators: Number(els.opCount.value),
      b2cShare: Number(els.b2cShare.value) / 100,
      ordersPerHour: Number(els.orderRate.value),
    };
  }

  function syncSlidersFromScenario() {
    const params = { ...DEFAULT_SCENARIO, ...(selectedScenario()?.params ?? {}) };
    els.opCount.value = params.operators;
    els.b2cShare.value = Math.round(params.b2cShare * 100);
    els.orderRate.value = params.ordersPerHour;
    refreshSliderLabels();
  }

  function refreshSliderLabels() {
    els.opCountVal.textContent = els.opCount.value;
    els.b2cShareVal.textContent = `${els.b2cShare.value} % B2C`;
    els.orderRateVal.textContent = `${els.orderRate.value} cmd/h`;
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
    els.play.textContent = playing ? '⏸' : '▶';
    els.play.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  }
  els.play.addEventListener('click', () => {
    if (!playing && simTime >= sim.durationSec) simTime = 0;
    setPlaying(!playing);
  });

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
    sim.trails.setVisible(els.toggleTrails.checked);
    sim.trails.update(simTime);
  });
  els.toggleHeatmap.addEventListener('change', () => {
    sim.heatmap.setVisible(els.toggleHeatmap.checked);
  });

  // --- Enregistrement du run courant en base ---
  els.saveRun.addEventListener('click', async () => {
    els.saveStatus.classList.remove('error');
    els.saveStatus.textContent = 'Enregistrement…';
    try {
      const run = await fetchJson('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          scenarioId: Number(els.scenario.value),
          overrides: {
            operators: Number(els.opCount.value),
            b2cShare: Number(els.b2cShare.value) / 100,
            ordersPerHour: Number(els.orderRate.value),
          },
        }),
      });
      els.saveStatus.textContent = `Run nᵒ ${run.id} enregistré.`;
      await refreshCompareOptions();
    } catch (error) {
      els.saveStatus.classList.add('error');
      els.saveStatus.textContent = `Échec : ${error.message}`;
    }
  });

  // --- Comparaison : scénarios, run courant, runs enregistrés ---
  async function refreshCompareOptions() {
    const runs = await fetchJson(`/api/runs?warehouseId=${warehouseId}`);
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
    els.cmpStatus.classList.remove('error');
    els.cmpStatus.textContent = 'Comparaison…';
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
      els.cmpStatus.textContent = '';
    } catch (error) {
      els.cmpStatus.classList.add('error');
      els.cmpStatus.textContent = `Échec : ${error.message}`;
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
    if (playing) {
      simTime += dt * speed;
      if (simTime >= sim.durationSec) {
        simTime = sim.durationSec;
        setPlaying(false);
      }
      sim.operators.update(simTime);
      sim.trails.update(simTime);
    }
    if (nowMs - lastKpiRefresh > 250) {
      lastKpiRefresh = nowMs;
      refreshKpis();
      els.clock.textContent = `${formatClock(simTime)} / ${formatClock(sim.durationSec)}`;
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
