#!/usr/bin/env node
// Exécution d'un scénario en ligne de commande et export des KPI en console.
// Usage : node sim/cli.js [scenario.json] [warehouse.json]

import { readFile } from 'node:fs/promises';
import { buildWarehouse } from './warehouse.js';
import { runSimulation } from './engine.js';
import { getStrategy } from './strategies.js';
import { formatKpis } from './kpi.js';

const scenarioPath = process.argv[2] ?? 'demo/scenario-example.json';
const warehousePath = process.argv[3] ?? 'demo/warehouse-example.json';

const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
const warehouseSpec = JSON.parse(await readFile(warehousePath, 'utf8'));
const warehouse = buildWarehouse(warehouseSpec);

console.log('SimSteps — simulation de flux d’entrepôt');
console.log('─'.repeat(48));
console.log(`Entrepôt   : ${warehouse.name} (${warehouse.slots.size} emplacements)`);
console.log(`Scénario   : ${scenario.name ?? scenarioPath}`);
console.log(`Stratégie  : ${getStrategy(scenario.strategy ?? 'orderByOrder').label}`);
console.log(
  `Paramètres : ${scenario.operators ?? 5} opérateurs, ` +
    `${scenario.ordersPerHour ?? 30} cmd/h, ` +
    `${Math.round((scenario.b2cShare ?? 0.7) * 100)} % B2C, ` +
    `${scenario.durationHours ?? 2} h simulées`
);
console.log('─'.repeat(48));

const started = performance.now();
const { kpis } = runSimulation(warehouse, scenario);
const elapsed = performance.now() - started;

console.log(formatKpis(kpis));
console.log('─'.repeat(48));
console.log(`Simulation exécutée en ${elapsed.toFixed(0)} ms`);
