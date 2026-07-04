#!/usr/bin/env node
// Exécution autonome des migrations : utilisé par l'initContainer du
// chart Helm (et utilisable à la main). Attend la base, applique les
// migrations en attente, puis se termine.
// Usage : DATABASE_URL=postgres://… node db/migrate-cli.js

import { fileURLToPath } from 'node:url';
import { createPool, waitForDb } from '../server/db.js';
import { runMigrations } from './migrate.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://simsteps:simsteps@localhost:5432/simsteps';

const pool = createPool(DATABASE_URL);
try {
  await waitForDb(pool, { log: (msg) => console.log(msg) });
  const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url));
  const applied = await runMigrations(pool, migrationsDir);
  console.log(
    applied.length > 0
      ? `Migrations appliquées : ${applied.join(', ')}`
      : 'Aucune migration en attente'
  );
} finally {
  await pool.end();
}
