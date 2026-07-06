// Tests UI de l'import/export JSON : import d'un entrepôt valide (la
// simulation démarre dessus), rejet d'un document invalide avec
// l'erreur française de l'API, export réimportable ; idem scénario.

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, openConfigTab, uniqueName, cleanupTestData } from './helpers.js';

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

// Fichier en mémoire pour setInputFiles
function jsonFile(name, value) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) };
}

test('import et export d’un entrepôt depuis l’interface', async ({ page }) => {
  const definition = JSON.parse(
    await readFile(new URL('../../demo/warehouse-example.json', import.meta.url), 'utf8')
  );
  definition.name = uniqueName('Entrepôt importé');

  await openApp(page);
  await openConfigTab(page);

  // Import : l'entrepôt est créé, sélectionné et la simulation tourne
  await page.locator('#warehouseImport').click();
  await page.locator('#warehouseFile').setInputFiles(jsonFile('entrepot.json', definition));
  await expect(page.locator('#warehouseStatus')).toContainText(`« ${definition.name} » importé`);
  await expect(page.locator('#warehouse option:checked')).toHaveText(definition.name);
  await expect(page.locator('#status')).toContainText('opérateurs');

  // Export : le téléchargement porte le bon nom et un contenu réimportable
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#warehouseExport').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^entrepot-importe.*\.json$/);
  const exported = JSON.parse(
    (await readFile(await download.path())).toString('utf8')
  );
  expect(exported.name).toBe(definition.name);
  expect(exported.aisles).toHaveLength(definition.aisles.length);
});

test('un entrepôt invalide est refusé avec l’erreur de l’API', async ({ page }) => {
  await openApp(page);
  await openConfigTab(page);
  const before = await page.locator('#warehouse option').count();

  // Pas de JSON du tout
  await page.locator('#warehouseImport').click();
  await page.locator('#warehouseFile').setInputFiles({
    name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('pas du json'),
  });
  await expect(page.locator('#warehouseStatus')).toContainText('n’est pas un JSON valide');

  // JSON valide mais topologie invalide (aucun couloir) : erreur française de l'API
  await page.locator('#warehouseImport').click();
  await page.locator('#warehouseFile').setInputFiles(jsonFile('invalide.json', {
    name: uniqueName('Entrepôt invalide'),
    dimensions: { width: 10, depth: 10 },
    aisles: [], racks: [], workshops: [],
  }));
  await expect(page.locator('#warehouseStatus')).toContainText('Échec de l\'import');
  // Rien n'a été créé
  await expect(page.locator('#warehouse option')).toHaveCount(before);
});

test('import et export d’un scénario depuis l’interface', async ({ page }) => {
  const params = JSON.parse(
    await readFile(new URL('../../demo/scenario-example.json', import.meta.url), 'utf8')
  );
  params.name = uniqueName('Scénario importé');
  params.operators = 7;

  await openApp(page);

  // Import : le scénario apparaît, est sélectionné et pilote les curseurs
  await page.locator('#scenarioImport').click();
  await page.locator('#scenarioFile').setInputFiles(jsonFile('scenario.json', params));
  await expect(page.locator('#scenarioStatus')).toContainText(`« ${params.name} » importé`);
  await expect(page.locator('#scenario option:checked')).toHaveText(params.name);
  await expect(page.locator('#opCountVal')).toHaveText('7');

  // Export : contenu réimportable avec le nom et les paramètres
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#scenarioExport').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^scenario-importe.*\.json$/);
  const exported = JSON.parse((await readFile(await download.path())).toString('utf8'));
  expect(exported.name).toBe(params.name);
  expect(exported.operators).toBe(7);
});
