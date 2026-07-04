// Test de fumée : la page se charge, la simulation tourne, le panneau
// est complet et la console reste propre.

import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('la page se charge et la relecture démarre', async ({ page }) => {
  const consoleErrors = await openApp(page);

  // Panneau complet : toutes les sections attendues
  for (const heading of ['Lecture', 'Projet', 'Entrepôt', 'Scénario', 'Affichage', 'Indicateurs en direct', 'Comparaison']) {
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
