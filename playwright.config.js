// Configuration des tests UI Playwright (tests/ui/). Ils s'exécutent
// contre la pile Docker (app + PostgreSQL) : si elle tourne déjà, elle
// est réutilisée, sinon « docker compose up » est lancé automatiquement.
// Séparés des tests unitaires : `npm test` reste sans navigateur ni base.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  // Les tests partagent la même base : pas de parallélisme
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    // WebGL logiciel en headless (Three.js sans GPU)
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'docker compose up',
    url: (process.env.BASE_URL ?? 'http://localhost:3000') + '/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
