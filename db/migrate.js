// Migrations SQL versionnées, appliquées automatiquement au démarrage.
// Chaque fichier db/migrations/NNN_nom.sql est exécuté une seule fois,
// dans l'ordre lexicographique, au sein d'une transaction.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Détermine les migrations restant à appliquer, dans l'ordre.
 * @param {string[]} files noms de fichiers .sql présents sur disque
 * @param {Set<string>} applied noms déjà enregistrés en base
 * @returns {string[]}
 */
export function pendingMigrations(files, applied) {
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));
}

/**
 * Applique les migrations en attente.
 * @param {import('pg').Pool} pool
 * @param {string} dir dossier contenant les fichiers .sql
 * @returns {Promise<string[]>} noms des migrations appliquées lors de cet appel
 */
export async function runMigrations(pool, dir) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  const files = await readdir(dir);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const pending = pendingMigrations(files, new Set(rows.map((r) => r.name)));

  const client = await pool.connect();
  try {
    for (const name of pending) {
      const sql = await readFile(join(dir, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} en échec : ${error.message}`);
      }
    }
  } finally {
    client.release();
  }
  return pending;
}
