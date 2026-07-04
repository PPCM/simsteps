// Point d'entrée du serveur : attend la base, applique les migrations,
// insère les données d'exemple si nécessaire, puis démarre l'API.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, waitForDb } from './db.js';
import { runMigrations } from '../db/migrate.js';
import { seedIfEmpty } from '../db/seed.js';
import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://simsteps:simsteps@localhost:5432/simsteps';

const pool = createPool(DATABASE_URL);

await waitForDb(pool, { log: (msg) => console.log(msg) });

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const applied = await runMigrations(pool, migrationsDir);
if (applied.length > 0) console.log(`Migrations appliquées : ${applied.join(', ')}`);

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
if (await seedIfEmpty(pool, dataDir)) console.log('Données d’exemple insérées (seed)');

const webRoot = fileURLToPath(new URL('../web/public/', import.meta.url));
const threeRoot = fileURLToPath(new URL('../node_modules/three/', import.meta.url));
const simRoot = fileURLToPath(new URL('../sim/', import.meta.url));
const app = await buildApp({ pool, webRoot, threeRoot, simRoot, logger: true });

// Arrêt propre (docker stop, Ctrl+C)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: '0.0.0.0' });

// Bannière de démarrage : nom en ASCII art et version lue dans package.json
const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
const banner = `
  ____  _           ____  _
 / ___|(_)_ __ ___ / ___|| |_ ___ _ __  ___
 \\___ \\| | '_ \` _ \\\\___ \\| __/ _ \\ '_ \\/ __|
  ___) | | | | | | |___) | ||  __/ |_) \\__ \\
 |____/|_|_| |_| |_|____/ \\__\\___| .__/|___/
                                 |_|  v${version}`;
app.log.info(banner);
app.log.info(`Serveur disponible sur http://0.0.0.0:${PORT}`);
app.log.info(`Environnement : ${process.env.NODE_ENV ?? 'development'}`);
