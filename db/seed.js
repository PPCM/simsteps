// Insertion des données d'exemple au premier démarrage : un entrepôt
// et les deux scénarios de référence. Ne fait rien si la base contient
// déjà au moins un entrepôt.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Insère l'entrepôt et les scénarios d'exemple si la base est vide.
 * @param {import('pg').Pool} pool
 * @param {string} dataDir dossier contenant les JSON d'exemple
 * @returns {Promise<boolean>} true si le seed a été effectué
 */
export async function seedIfEmpty(pool, dataDir) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM warehouses');
  if (rows[0].n > 0) return false;

  const warehouse = JSON.parse(await readFile(join(dataDir, 'warehouse-example.json'), 'utf8'));
  await pool.query(
    'INSERT INTO warehouses (name, definition) VALUES ($1, $2)',
    [warehouse.name, warehouse]
  );

  for (const file of ['scenario-example.json', 'scenario-waves.json']) {
    const scenario = JSON.parse(await readFile(join(dataDir, file), 'utf8'));
    await pool.query(
      'INSERT INTO scenarios (name, params) VALUES ($1, $2)',
      [scenario.name, scenario]
    );
  }
  return true;
}
