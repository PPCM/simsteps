// Tests UI de l'aide « Procédures » du mode édition : ouverture depuis
// le ruban, liste des documents, lecture d'une procédure rendue en HTML,
// retour à la liste et fermeture (bouton et Échap).

import { test, expect } from '@playwright/test';
import { openApp, openConfigTab, createTestWarehouse, cleanupTestData } from './helpers.js';

let testWarehouse;

test.beforeEach(async ({ page, request, baseURL }) => {
  testWarehouse = await createTestWarehouse(request, baseURL);
  await openApp(page);
  await openConfigTab(page);
  await page.locator('#warehouse').selectOption(String(testWarehouse.id));
  await expect(page.locator('#status')).toContainText(testWarehouse.name);
  await page.locator('#warehouseEdit').click();
  await expect(page.locator('#editChrome')).toBeVisible();
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

test('le ruban ouvre la liste des procédures puis une procédure rendue', async ({ page }) => {
  // Fermée par défaut, ouverte depuis le groupe Aide du ruban
  await expect(page.locator('#procWindow')).toBeHidden();
  await page.locator('#editProcedures').click();
  await expect(page.locator('#procWindow')).toBeVisible();

  // La liste contient la procédure Reflex livrée avec l'application
  const entry = page.locator('.proc-list button', { hasText: 'Reflex WMS' });
  await expect(entry).toBeVisible();

  // Ouverture : Markdown rendu (titre, section, tableau), bouton retour
  await entry.click();
  await expect(page.locator('#procBody h1')).toHaveText(
    'Importer des données Reflex WMS dans SimSteps'
  );
  await expect(page.locator('#procBody h2').first()).toContainText('Principe et limites');
  await expect(page.locator('#procBody table').first()).toBeVisible();
  await expect(page.locator('#procBack')).toBeVisible();

  // Retour à la liste
  await page.locator('#procBack').click();
  await expect(page.locator('.proc-list')).toBeVisible();
  await expect(page.locator('#procBack')).toBeHidden();
});

test('fermeture par le bouton, par Échap, et masquage en quittant l’édition', async ({ page }) => {
  await page.locator('#editProcedures').click();
  await expect(page.locator('#procWindow')).toBeVisible();
  await page.locator('#procClose').click();
  await expect(page.locator('#procWindow')).toBeHidden();

  // Raccourci « 0 » : ouverture ; Échap : fermeture (avant toute désélection)
  await page.keyboard.press('0');
  await expect(page.locator('#procWindow')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#procWindow')).toBeHidden();

  // La fenêtre ne survit pas à la sortie du mode édition
  await page.keyboard.press('0');
  await expect(page.locator('#procWindow')).toBeVisible();
  await page.locator('#editCancel').click();
  await expect(page.locator('#editChrome')).toBeHidden();
  await page.locator('#warehouseEdit').click();
  await expect(page.locator('#editChrome')).toBeVisible();
  await expect(page.locator('#procWindow')).toBeHidden();
});
