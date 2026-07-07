// Tests UI du recalage assisté : la calibration retrouve un temps de
// prélèvement connu à partir de la productivité qu'il produit, la
// valeur ne s'applique que sur clic, et une cible absurde est refusée
// avec une explication.

import { test, expect } from '@playwright/test';
import {
  openApp, openConfigTab, openPilotTab, createTestWarehouse, createTestScenario, cleanupTestData,
} from './helpers.js';

// Environnement contrôlé : entrepôt exemple + scénario simple jetables
// (le premier scénario de la base peut être la démo flux, où 2 piétons
// s'effondrent en ruptures et faussent toute calibration)
test.beforeEach(async ({ page, request, baseURL }) => {
  const warehouse = await createTestWarehouse(request, baseURL);
  const scenario = await createTestScenario(request, baseURL);
  await openApp(page);
  await openConfigTab(page);
  await page.locator('#warehouse').selectOption(String(warehouse.id));
  await expect(page.locator('#status')).toContainText(warehouse.name);
  await openPilotTab(page);
  await page.locator('#scenario').selectOption(String(scenario.id));
});

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

// Pousse un curseur à une valeur donnée (fill ne couvre pas les ranges)
async function setSlider(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

test('la calibration retrouve un temps de prélèvement connu', async ({ page }) => {
  // Sature le système (2 opérateurs, cadence max) : la productivité
  // devient pilotée par le temps de prélèvement, pas par la demande
  await setSlider(page, 'opCount', 2);
  await setSlider(page, 'orderRate', 120);
  await page.waitForFunction(() => window.simstepsDebug.currentParams().ordersPerHour === 120);

  // Fabrique la « réalité » : pickTime = 40 s → productivité observée
  await page.locator('#scenarioAdvanced summary').click();
  const pick = page.locator('#advancedFields [data-key="pickTimePerLineSec"]');
  await pick.fill('40');
  await pick.blur();
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 40);
  const observed = await page.evaluate(() => window.simstepsDebug.kpis().linesPerHourPerOperator);
  expect(observed).toBeGreaterThan(0);

  // Le KPI est affiché en direct dans la fenêtre Indicateurs
  await expect(page.locator('#kpi-lphop')).not.toHaveText('—');

  // Retour à la valeur par défaut : la calibration doit retrouver ~40 s
  await pick.fill('12');
  await pick.blur();
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 12);
  await page.locator('#calibrateTarget').fill(observed.toFixed(2));
  await page.locator('#calibrateRun').click();
  await expect(page.locator('#calibrateStatus')).toContainText('Cliquez « Appliquer »');
  await expect(page.locator('#calibrateApply')).toBeEnabled();

  // Rien n'est appliqué avant le clic
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 12);
  await page.locator('#calibrateApply').click();
  await expect(page.locator('#calibrateStatus')).toContainText('Valeur appliquée');
  await page.waitForFunction(() => {
    const value = window.simstepsDebug.currentParams().pickTimePerLineSec;
    return value >= 32 && value <= 48; // ±5 % de tolérance KPI autour de 40 s
  });
  // Le panneau « Tous les paramètres » reflète la valeur appliquée
  const shown = Number(await pick.inputValue());
  expect(shown).toBeGreaterThanOrEqual(32);
  expect(shown).toBeLessThanOrEqual(48);
});

test('cible inatteignable : message explicite, rien d’appliqué', async ({ page }) => {
  const before = await page.evaluate(() => window.simstepsDebug.currentParams().pickTimePerLineSec);

  await page.locator('#calibrateTarget').fill('9999');
  await page.locator('#calibrateRun').click();
  await expect(page.locator('#calibrateStatus')).toContainText('Cible inatteignable');
  await expect(page.locator('#calibrateApply')).toBeDisabled();
  const after = await page.evaluate(() => window.simstepsDebug.currentParams().pickTimePerLineSec);
  expect(after).toBe(before);

  // Saisie vide : demande la valeur observée
  await page.locator('#calibrateTarget').fill('');
  await page.locator('#calibrateRun').click();
  await expect(page.locator('#calibrateStatus')).toContainText('Saisissez la productivité observée');
});
