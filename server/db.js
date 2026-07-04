// Connexion PostgreSQL : pool partagé et attente de disponibilité de la
// base au démarrage (utile avec docker compose, même avec le healthcheck).

import pg from 'pg';

/**
 * Crée le pool de connexions.
 * @param {string} databaseUrl chaîne de connexion postgres://…
 */
export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl });
}

/**
 * Attend que la base réponde, avec réessais.
 * @param {import('pg').Pool} pool
 * @param {{retries?: number, delayMs?: number, log?: (msg: string) => void}} [options]
 */
export async function waitForDb(pool, { retries = 30, delayMs = 1000, log = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt >= retries) {
        throw new Error(`Base de données injoignable après ${retries} tentatives : ${error.message}`);
      }
      log(`Base indisponible (tentative ${attempt}/${retries}), nouvel essai dans ${delayMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
