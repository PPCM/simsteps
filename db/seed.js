// Insertion des données d'exemple au premier démarrage : l'entrepôt
// historique, l'entrepôt de démonstration des flux, les scénarios de
// référence et un projet. Ne fait rien si la base contient déjà au
// moins un entrepôt.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Insère l'entrepôt, les scénarios et le projet d'exemple si la base est vide.
 * @param {import('pg').Pool} pool
 * @param {string} dataDir dossier contenant les JSON d'exemple
 * @returns {Promise<boolean>} true si le seed a été effectué
 */
export async function seedIfEmpty(pool, dataDir) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM warehouses');
  if (rows[0].n > 0) return false;

  const warehouse = JSON.parse(await readFile(join(dataDir, 'warehouse-example.json'), 'utf8'));
  const warehouseResult = await pool.query(
    'INSERT INTO warehouses (name, definition) VALUES ($1, $2) RETURNING id',
    [warehouse.name, warehouse]
  );
  // Entrepôt de démonstration des flux (racks en hauteur, flotte,
  // parkings, tampon, obstacles, voie réservée)
  const fluxWarehouse = JSON.parse(await readFile(join(dataDir, 'warehouse-flux.json'), 'utf8'));
  await pool.query(
    'INSERT INTO warehouses (name, definition) VALUES ($1, $2)',
    [fluxWarehouse.name, fluxWarehouse]
  );

  const scenarioIds = [];
  for (const file of ['scenario-example.json', 'scenario-waves.json', 'scenario-flux.json']) {
    const scenario = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
    const result = await pool.query(
      'INSERT INTO scenarios (name, params) VALUES ($1, $2) RETURNING id',
      [scenario.name, scenario]
    );
    scenarioIds.push(result.rows[0].id);
  }

  // Projet exemple : entrepôt + premier scénario + paramétrages surchargés
  const project = JSON.parse(await readFile(join(dataDir, 'project-example.json'), 'utf8'));
  await pool.query(
    'INSERT INTO projects (name, warehouse_id, scenario_id, settings) VALUES ($1, $2, $3, $4)',
    [project.name, warehouseResult.rows[0].id, scenarioIds[0], project.settings]
  );
  return true;
}
