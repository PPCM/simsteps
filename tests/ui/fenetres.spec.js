// Tests UI des fenêtres flottantes : repli sur la barre de titre
// (résumés vivants), déplacement par glisser et mémorisation de l'état
// entre les rechargements (localStorage).

import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('replier les fenêtres laisse des barres de titre vivantes', async ({ page }) => {
  const consoleErrors = await openApp(page);

  // Fenêtre Indicateurs : repli → résumé des deux KPI clés
  await page.locator('#winKpi .win-toggle').click();
  await expect(page.locator('#winKpi .win-body')).toBeHidden();
  await expect(page.locator('#kpiSummary')).toContainText('cmd/h');

  // Fenêtre principale : repli → lecture et horloge dans la barre
  await page.locator('#winMain .win-toggle').click();
  await expect(page.locator('#winMain .win-body')).toBeHidden();
  await expect(page.locator('#playMini')).toBeVisible();
  const miniClock = page.locator('#clockMini');
  const before = await miniClock.textContent();
  await expect(miniClock).not.toHaveText(before, { timeout: 5_000 });

  // Le mini-bouton pilote bien la relecture
  await page.locator('#playMini').click();
  await expect(page.locator('#playMini')).toHaveText('▶');

  // Dépli : le contenu revient
  await page.locator('#winMain .win-toggle').click();
  await expect(page.locator('#winMain .win-body')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('déplacer une fenêtre et recharger restaure position et repli', async ({ page }) => {
  await openApp(page);

  // Glisser la fenêtre principale par sa barre de titre
  const before = await page.locator('#winMain').boundingBox();
  await page.mouse.move(before.x + 60, before.y + 14);
  await page.mouse.down();
  await page.mouse.move(before.x + 260, before.y + 74, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator('#winMain').boundingBox();
  expect(after.x).toBeCloseTo(before.x + 200, 0);
  expect(after.y).toBeCloseTo(before.y + 60, 0);

  // Repli de la fenêtre Indicateurs, puis rechargement
  await page.locator('#winKpi .win-toggle').click();
  await page.reload();
  await expect(page.locator('#status')).toContainText('opérateurs', { timeout: 20_000 });

  // Position et repli restaurés depuis localStorage
  const restored = await page.locator('#winMain').boundingBox();
  expect(Math.round(restored.x)).toBe(Math.round(after.x));
  expect(Math.round(restored.y)).toBe(Math.round(after.y));
  await expect(page.locator('#winKpi .win-body')).toBeHidden();
});
