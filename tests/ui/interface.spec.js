// Test de fumée : la page se charge, la simulation tourne, les deux
// fenêtres et leurs onglets sont complets et la console reste propre.

import { test, expect } from '@playwright/test';
import { openApp, openConfigTab } from './helpers.js';

test('la page se charge et la relecture démarre', async ({ page }) => {
  const consoleErrors = await openApp(page);

  // Fenêtre principale (onglet Piloter par défaut) et fenêtre Indicateurs
  for (const heading of ['Lecture', 'Scénario', 'Affichage', 'Indicateurs en direct', 'Comparaison']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // L'onglet Configurer porte le projet et l'entrepôt
  await openConfigTab(page);
  for (const heading of ['Projet', 'Entrepôt']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // L'horloge simulée avance (relecture en cours)
  const clock = page.locator('#clock');
  const before = await clock.textContent();
  await expect(clock).not.toHaveText(before, { timeout: 5_000 });

  // Sélecteurs peuplés depuis l'API
  expect(await page.locator('#warehouse option').count()).toBeGreaterThan(0);
  expect(await page.locator('#scenario option').count()).toBeGreaterThan(0);
  await expect(page.locator('#project option').first()).toHaveText('— Aucun projet —');

  expect(consoleErrors).toEqual([]);
});
