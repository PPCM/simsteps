// Insertion des données de démonstration au premier démarrage : les
// deux entrepôts (flux complet et site robotisé), leurs scénarios et
// un projet pour chacun. Ne fait rien si la base contient déjà au
// moins un entrepôt. L'entrepôt d'exemple historique
// (data/warehouse-example.json) reste un gabarit pour la CLI et les
// tests, mais n'est plus semé.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Insère les entrepôts, scénarios et projets de démonstration si la
 * base est vide.
 * @param {import('pg').Pool} pool
 * @param {string} dataDir dossier contenant les JSON d'exemple
 * @returns {Promise<boolean>} true si le seed a été effectué
 */
export async function seedIfEmpty(pool, dataDir) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM warehouses');
  if (rows[0].n > 0) return false;

  // Chaque projet regroupe un entrepôt et le scénario qui le met en valeur
  const pairs = [
    { warehouse: 'warehouse-flux.json', scenario: 'scenario-flux.json', project: 'Flux complet' },
    { warehouse: 'warehouse-amr.json', scenario: 'scenario-amr.json', project: 'Robots mobiles' },
  ];
  for (const pair of pairs) {
    const warehouse = JSON.parse(await readFile(join(dataDir, pair.warehouse), 'utf8'));
    const warehouseResult = await pool.query(
      'INSERT INTO warehouses (name, definition) VALUES ($1, $2) RETURNING id',
      [warehouse.name, warehouse]
    );
    const scenario = JSON.parse(await readFile(join(dataDir, pair.scenario), 'utf8'));
    const scenarioResult = await pool.query(
      'INSERT INTO scenarios (name, params) VALUES ($1, $2) RETURNING id',
      [scenario.name, scenario]
    );
    await pool.query(
      'INSERT INTO projects (name, warehouse_id, scenario_id, settings) VALUES ($1, $2, $3, $4)',
      [pair.project, warehouseResult.rows[0].id, scenarioResult.rows[0].id, {}]
    );
  }
  return true;
}
