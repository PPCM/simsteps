// Tests UI de la gestion des entrepôts : duplication, bascule entre
// entrepôts (reconstruction de la scène) et suppression avec repli.
// Tout part d'un entrepôt jetable ; sa copie contient aussi « [test »
// et est donc rattrapée par le nettoyage.

import { test, expect } from '@playwright/test';
import { openApp, createTestWarehouse, cleanupTestData } from './helpers.js';

let testWarehouse;

test.beforeEach(async ({ page, request, baseURL }) => {
  testWarehouse = await createTestWarehouse(request, baseURL);
  await openApp(page);
  await page.locator('#warehouse').selectOption(String(testWarehouse.id));
  await expect(page.locator('#status')).toContainText(testWarehouse.name);
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

test('dupliquer, basculer puis supprimer un entrepôt', async ({ page }) => {
  const copyName = `Copie de ${testWarehouse.name}`;

  // Duplication : la copie est créée et devient l'entrepôt affiché
  await page.locator('#warehouseDuplicate').click();
  await expect(page.locator('#warehouseStatus')).toContainText('créé');
  await expect(page.locator('#warehouse option:checked')).toHaveText(copyName);
  await expect(page.locator('#status')).toContainText(copyName);

  // Bascule vers l'original puis retour : la scène est reconstruite
  await page.locator('#warehouse').selectOption(String(testWarehouse.id));
  await expect(page.locator('#status')).toContainText(testWarehouse.name);
  await page.locator('#warehouse').selectOption({ label: copyName });
  await expect(page.locator('#status')).toContainText(copyName);

  // Suppression de la copie (confirm accepté) : repli sur un autre entrepôt
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#warehouseDelete').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt supprimé.');
  await expect(page.locator('#warehouse option', { hasText: copyName })).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('opérateurs');
});
