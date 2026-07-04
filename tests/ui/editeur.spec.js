// Tests UI de l'éditeur 3D : mode édition, sélection au clic dans la
// scène, glisser-déposer contraint, validation, ajout d'allée,
// enregistrement et annulation. Tout se passe sur un entrepôt jetable.

import { test, expect } from '@playwright/test';
import {
  openApp, openConfigTab, createTestWarehouse, cleanupTestData, selectInScene, selectionFields,
} from './helpers.js';

let testWarehouse;

test.beforeEach(async ({ page, request, baseURL }) => {
  testWarehouse = await createTestWarehouse(request, baseURL);
  await openApp(page);
  await openConfigTab(page);
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
  await expect(page.locator('#editDot')).toBeVisible(); // point ambre sur l'onglet
  for (const id of ['#play', '#scenario', '#project', '#warehouse', '#saveRun', '#cmpRun']) {
    await expect(page.locator(id)).toBeDisabled();
  }
  await expect(page.locator('#hint')).toContainText('Glisser un élément : déplacer');

  // Annuler : sortie propre, la relecture repart
  await page.locator('#editCancel').click();
  await expect(page.locator('#editPanel')).toBeHidden();
  await expect(page.locator('#editDot')).toBeHidden();
  await expect(page.locator('#status')).toContainText('opérateurs');
  await expect(page.locator('#play')).toBeEnabled();
});

test('sélection au clic et glisser contraint d’une allée', async ({ page, request, baseURL }) => {
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
  // Longueur conservée, allée entre les couloirs, position au mètre entier
  expect(Number(yEndAfter) - Number(yStartAfter)).toBe(length);
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  const y = Number(yStartAfter);
  expect(y).toBeGreaterThan(definition.corridors.frontY);
  expect(Number(yEndAfter)).toBeLessThan(definition.corridors.backY);
  expect(Number.isInteger(y)).toBe(true);
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  await page.locator('#editCancel').click();
});

test('validation, ajout d’allée et enregistrement', async ({ page, request, baseURL }) => {
  const { definition: before } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
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
  await expect(page.locator('#selProps .placeholder')).toContainText(`Allée A${before.aisles.length + 1}`);

  // Enregistrement : persisté, sortie d'édition, relecture relancée
  await page.locator('#editSave').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt enregistré.');
  await expect(page.locator('#editPanel')).toBeHidden();
  await expect(page.locator('#status')).toContainText('opérateurs');
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(definition.aisles).toHaveLength(before.aisles.length + 1);
});

test('modifier l’entrepôt ne recadre pas la caméra', async ({ page }) => {
  // Attend la fin de l'inertie d'OrbitControls puis lit la position caméra
  const settledCamera = async () => {
    await page.waitForFunction(() => {
      const p = window.simstepsDebug.camera.position;
      const prev = window.__camPrev;
      window.__camPrev = [p.x, p.y, p.z];
      return prev !== undefined &&
        Math.hypot(p.x - prev[0], p.y - prev[1], p.z - prev[2]) < 1e-4;
    }, undefined, { polling: 250 });
    return page.evaluate(() => window.simstepsDebug.camera.position.toArray());
  };

  // Orbite : l'utilisateur choisit son point de vue (glisser dans le
  // vide, en haut à droite — hors des trois fenêtres)
  const { width, height } = page.viewportSize();
  await page.mouse.move(width * 0.72, height * 0.12);
  await page.mouse.down();
  await page.mouse.move(width * 0.6, height * 0.28, { steps: 5 });
  await page.mouse.up();
  const before = await settledCamera();

  // Modification (ajout d'allée) : l'orientation choisie est conservée
  await page.locator('#editAddAisle').click();
  await expect(page.locator('#selProps .placeholder')).toContainText(/Allée A\d+/);
  const afterEdit = await settledCamera();
  for (let i = 0; i < 3; i++) expect(afterEdit[i]).toBeCloseTo(before[i], 1);

  // La sortie d'édition (annuler) ne recadre pas non plus
  await page.locator('#editCancel').click();
  await expect(page.locator('#editPanel')).toBeHidden();
  const afterExit = await settledCamera();
  for (let i = 0; i < 3; i++) expect(afterExit[i]).toBeCloseTo(before[i], 1);
});

test('ajouter et redimensionner une zone d’expédition', async ({ page, request, baseURL }) => {
  // Ajout : la zone est créée et sélectionnée automatiquement
  await page.locator('#editAddShipping').click();
  await expect(page.locator('#selProps .placeholder')).toContainText('Expédition EXP1');

  // Redimensionnement par champs (id, label, x, y, largeur, profondeur)
  const width = page.locator('#selProps input').nth(4);
  await width.fill('8');
  await width.blur();
  const depth = page.locator('#selProps input').nth(5);
  await depth.fill('4');
  await depth.blur();
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  // Enregistrement : persisté en base, zones au format liste
  await page.locator('#editSave').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt enregistré.');
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(Array.isArray(definition.shipping)).toBe(true);
  expect(definition.shipping).toHaveLength(2);
  const added = definition.shipping.find((z) => z.id === 'EXP1');
  expect(added.width).toBe(8);
  expect(added.depth).toBe(4);
});

test('annuler ne persiste aucune modification', async ({ page, request, baseURL }) => {
  const { definition: before } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  await page.locator('#editAddAisle').click();
  await expect(page.locator('#selProps .placeholder')).toContainText(`Allée A${before.aisles.length + 1}`);
  await page.locator('#editCancel').click();
  await expect(page.locator('#editPanel')).toBeHidden();
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(definition.aisles).toHaveLength(before.aisles.length);
});
