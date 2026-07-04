// Tests UI des projets : création depuis les réglages courants, run
// rattaché, comparaison filtrée, mise à jour et suppression. Tout se
// passe sur un entrepôt jetable pour ne pas polluer les données réelles.

import { test, expect } from '@playwright/test';
import {
  openApp, openConfigTab, openPilotTab, uniqueName, createTestWarehouse, cleanupTestData,
} from './helpers.js';

let testWarehouse;

test.beforeEach(async ({ page, request, baseURL }) => {
  testWarehouse = await createTestWarehouse(request, baseURL);
  await openApp(page);
  await openConfigTab(page); // projet et entrepôt vivent dans l'onglet Configurer
  await page.locator('#warehouse').selectOption(String(testWarehouse.id));
  await expect(page.locator('#status')).toContainText(testWarehouse.name);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

test('cycle de vie complet d’un projet', async ({ page, request, baseURL }) => {
  const projectName = uniqueName('Projet');

  // Création depuis les réglages courants : le projet devient actif
  await page.locator('#projectName').fill(projectName);
  await page.locator('#projectCreate').click();
  await expect(page.locator('#projectStatus')).toContainText('créé');
  await expect(page.locator('#project option:checked')).toHaveText(projectName);
  const projectId = Number(await page.locator('#project').inputValue());

  // Le run enregistré est rattaché au projet (bouton dans l'onglet Piloter)
  await openPilotTab(page);
  await page.locator('#saveRun').click();
  await expect(page.locator('#saveStatus')).toContainText('enregistré');
  const projectRuns = await (await request.get(`${baseURL}/api/runs?projectId=${projectId}`)).json();
  expect(projectRuns).toHaveLength(1);
  expect(projectRuns[0].warehouse_id).toBe(testWarehouse.id);

  // La comparaison ne propose que les runs du projet actif
  const runOptions = page.locator('#cmpA option', { hasText: 'Run nᵒ' });
  await expect(runOptions).toHaveCount(1);
  await expect(runOptions).toHaveText(new RegExp(`Run nᵒ ${projectRuns[0].id}`));

  // Mise à jour du projet actif (nouveau réglage de curseur)
  await page.locator('#opCount').fill('9');
  await openConfigTab(page);
  await page.locator('#projectUpdate').click();
  await expect(page.locator('#projectStatus')).toContainText('mis à jour');
  const updated = await (await request.get(`${baseURL}/api/projects/${projectId}`)).json();
  expect(updated.settings.operators).toBe(9);

  // Resélection : le projet réapplique ses réglages
  await page.locator('#project').selectOption('');
  await openPilotTab(page);
  await page.locator('#opCount').fill('3');
  await openConfigTab(page);
  await page.locator('#project').selectOption(String(projectId));
  await expect(page.locator('#opCountVal')).toHaveText('9');

  // Suppression (confirm accepté) : retour à « Aucun projet »
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#projectDelete').click();
  await expect(page.locator('#projectStatus')).toContainText('supprimé');
  await expect(page.locator('#project option:checked')).toHaveText('— Aucun projet —');
  expect((await request.get(`${baseURL}/api/projects/${projectId}`)).status()).toBe(404);
});

test('mettre à jour sans projet actif affiche un message', async ({ page }) => {
  await page.locator('#projectUpdate').click();
  await expect(page.locator('#projectStatus')).toContainText('Aucun projet actif');
});
