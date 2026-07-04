// Tests UI de l'éditeur 3D : mode édition, sélection au clic dans la
// scène, glisser-déposer contraint, validation, ajout d'allée,
// enregistrement et annulation. Tout se passe sur un entrepôt jetable.

import { test, expect } from '@playwright/test';
import { openApp, createTestWarehouse, cleanupTestData, selectInScene, selectionFields } from './helpers.js';

let testWarehouse;

test.beforeEach(async ({ page, request, baseURL }) => {
  testWarehouse = await createTestWarehouse(request, baseURL);
  await openApp(page);
  await page.locator('#warehouse').selectOption(String(testWarehouse.id));
  await expect(page.locator('#status')).toContainText(testWarehouse.name);
  await page.locator('#warehouseEdit').click();
  await expect(page.locator('#status')).toHaveText('Mode édition — simulation en pause');
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

test('le mode édition fige la simulation et neutralise le panneau', async ({ page }) => {
  await expect(page.locator('#editPanel')).toBeVisible();
  for (const id of ['#play', '#scenario', '#project', '#warehouse', '#saveRun', '#cmpRun']) {
    await expect(page.locator(id)).toBeDisabled();
  }
  await expect(page.locator('#hint')).toContainText('Glisser un élément : déplacer');

  // Annuler : sortie propre, la relecture repart
  await page.locator('#editCancel').click();
  await expect(page.locator('#editPanel')).toBeHidden();
  await expect(page.locator('#status')).toContainText('opérateurs');
  await expect(page.locator('#play')).toBeEnabled();
});

test('sélection au clic et glisser contraint d’une allée', async ({ page }) => {
  const label = await selectInScene(page, 'Allée');
  const aisleId = label.replace('Allée ', '');
  const [, , , yStartBefore, yEndBefore] = await selectionFields(page);
  const length = Number(yEndBefore) - Number(yStartBefore);

  // Glisser vers le bas de l'écran : l'allée bute sur un couloir
  const { width, height } = page.viewportSize();
  await page.mouse.move(width * 0.55, height * 0.55);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(width * 0.55, height * 0.55 + i * 30);
  }
  await page.mouse.up();

  const [id, , , yStartAfter, yEndAfter] = await selectionFields(page);
  expect(id).toBe(aisleId);
  // Longueur conservée, position accrochée au mètre, aucune erreur
  expect(Number(yEndAfter) - Number(yStartAfter)).toBe(length);
  expect(Number.isInteger(Number(yStartAfter))).toBe(true);
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  await page.locator('#editCancel').click();
});

test('validation, ajout d’allée et enregistrement', async ({ page, request, baseURL }) => {
  await selectInScene(page, 'Allée');

  // bays = 1 : erreur française et enregistrement bloqué
  const bays = page.locator('#selProps input').nth(2);
  await bays.fill('1');
  await bays.blur();
  await expect(page.locator('#editErrors li')).toContainText('doit être un entier ≥ 2');
  await expect(page.locator('#editSave')).toBeDisabled();

  // Correction : l'erreur disparaît
  await bays.fill('17');
  await bays.blur();
  await expect(page.locator('#editErrors li')).toHaveCount(0);
  await expect(page.locator('#editSave')).toBeEnabled();

  // Ajout d'une allée : sélectionnée automatiquement
  await page.locator('#editAddAisle').click();
  await expect(page.locator('#selProps .placeholder')).toContainText('Allée A7');

  // Enregistrement : persisté, sortie d'édition, relecture relancée
  await page.locator('#editSave').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt enregistré.');
  await expect(page.locator('#editPanel')).toBeHidden();
  await expect(page.locator('#status')).toContainText('opérateurs');
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(definition.aisles).toHaveLength(7);
});

test('annuler ne persiste aucune modification', async ({ page, request, baseURL }) => {
  await page.locator('#editAddAisle').click();
  await expect(page.locator('#selProps .placeholder')).toContainText('Allée A7');
  await page.locator('#editCancel').click();
  await expect(page.locator('#editPanel')).toBeHidden();
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(definition.aisles).toHaveLength(6);
});
