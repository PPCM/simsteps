// Tests UI du panneau « Tous les paramètres » : modification d'un
// paramètre sans curseur (relance de la simulation, bornage),
// persistance dans un projet à travers un rechargement de page, et
// « Enregistrer comme scénario ».

import { test, expect } from '@playwright/test';
import { openApp, uniqueName, cleanupTestData } from './helpers.js';

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

async function openAdvanced(page) {
  await page.locator('#scenarioAdvanced summary').click();
  await expect(page.locator('#advancedFields [data-key="pickTimePerLineSec"]')).toBeVisible();
}

test('un paramètre du panneau pilote la simulation et se borne', async ({ page }) => {
  await openApp(page);
  await openAdvanced(page);

  // La valeur saisie devient un paramètre effectif du run
  const pick = page.locator('#advancedFields [data-key="pickTimePerLineSec"]');
  await pick.fill('30');
  await pick.blur();
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 30);

  // Saisie hors bornes : ramenée au maximum du champ
  await pick.fill('999');
  await pick.blur();
  await expect(pick).toHaveValue('120');
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 120);

  // La stratégie est une liste alimentée par le moteur
  const strategy = page.locator('#advancedFields [data-key="strategy"]');
  await strategy.selectOption('zoneWave');
  await page.waitForFunction(() => window.simstepsDebug.currentParams().strategy === 'zoneWave');
});

test('les paramètres du panneau survivent dans un projet', async ({ page }) => {
  const projectName = uniqueName('Projet paramètres');
  await openApp(page);
  await openAdvanced(page);

  const pick = page.locator('#advancedFields [data-key="pickTimePerLineSec"]');
  await pick.fill('42');
  await pick.blur();
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 42);

  // Création du projet avec la surcharge, puis rechargement complet
  await page.locator('#tabConfig').click();
  await page.locator('#projectName').fill(projectName);
  await page.locator('#projectCreate').click();
  await expect(page.locator('#projectStatus')).toContainText('créé');

  await page.reload();
  await expect(page.locator('#status')).toContainText('opérateurs', { timeout: 20_000 });
  await page.locator('#tabConfig').click();
  await page.locator('#project').selectOption({ label: projectName });
  await page.locator('#tabPilot').click();
  await openAdvanced(page);
  await expect(pick).toHaveValue('42');
  await page.waitForFunction(() => window.simstepsDebug.currentParams().pickTimePerLineSec === 42);
});

test('« Enregistrer comme scénario » matérialise les réglages courants', async ({ page }) => {
  const scenarioName = uniqueName('Scénario réglages');
  await openApp(page);
  await openAdvanced(page);

  const drop = page.locator('#advancedFields [data-key="dropTimeSec"]');
  await drop.fill('35');
  await drop.blur();
  await page.waitForFunction(() => window.simstepsDebug.currentParams().dropTimeSec === 35);

  page.once('dialog', (dialog) => dialog.accept(scenarioName));
  await page.locator('#scenarioSaveAs').click();
  await expect(page.locator('#scenarioStatus')).toContainText(`« ${scenarioName} » enregistré`);
  await expect(page.locator('#scenario option:checked')).toHaveText(scenarioName);

  // Le scénario créé porte bien la valeur : resélection après rechargement
  await page.reload();
  await expect(page.locator('#status')).toContainText('opérateurs', { timeout: 20_000 });
  await page.locator('#scenario').selectOption({ label: scenarioName });
  await openAdvanced(page);
  await expect(drop).toHaveValue('35');
});
