// Aides partagées des tests UI : noms uniques, attente du chargement,
// surveillance des erreurs console, sélection d'un élément dans la
// scène 3D et nettoyage des données de test via l'API.

import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

/** Nom unique par exécution, pour ne jamais collisionner avec la base. */
export function uniqueName(prefix) {
  return `${prefix} [test ${Date.now()}]`;
}

/**
 * Charge l'application et attend la fin du premier run (statut rempli).
 * Retourne un collecteur d'erreurs console à vérifier en fin de test.
 */
export async function openApp(page) {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('opérateurs', { timeout: 20_000 });
  return consoleErrors;
}

/** Ouvre l'onglet Configurer (projet, entrepôt, édition 3D). */
export async function openConfigTab(page) {
  await page.locator('#tabConfig').click();
  await expect(page.locator('#paneConfig')).toBeVisible();
}

/** Ouvre l'onglet Piloter (scénario, curseurs, affichage). */
export async function openPilotTab(page) {
  await page.locator('#tabPilot').click();
  await expect(page.locator('#panePilot')).toBeVisible();
}

/**
 * Clique dans la scène jusqu'à sélectionner un élément du type voulu
 * (le placement exact des racks à l'écran dépend de la caméra : on
 * balaie quelques points autour du centre, en évitant le bas de l'écran
 * où vit la fenêtre d'édition).
 * @returns {Promise<string>} le libellé de sélection (ex. « Allée A5 »)
 */
export async function selectInScene(page, labelPrefix) {
  const { width, height } = page.viewportSize();
  const placeholder = page.locator('#selProps .placeholder');
  for (const [fx, fy] of [[0.55, 0.55], [0.5, 0.5], [0.6, 0.5], [0.45, 0.55], [0.65, 0.45], [0.55, 0.4]]) {
    await page.mouse.click(width * fx, height * fy);
    const text = await placeholder.textContent();
    if (text?.startsWith(labelPrefix)) return text;
  }
  throw new Error(`Aucun élément « ${labelPrefix} » trouvé dans la scène`);
}

/** Valeurs des champs de la sélection courante du panneau d'édition. */
export async function selectionFields(page) {
  return page.locator('#selProps input').evaluateAll((inputs) => inputs.map((i) => i.value));
}

/**
 * Crée un entrepôt jetable (nom unique) via l'API, à partir du gabarit
 * historique demo/warehouse-example.json : les tests d'édition et de
 * runs travaillent dessus avec une géométrie connue, quel que soit le
 * contenu de la base. Ses runs et projets partent en CASCADE avec lui.
 * @returns {Promise<{id: number, name: string}>}
 */
export async function createTestWarehouse(request, baseURL) {
  const definition = JSON.parse(
    await readFile(new URL('../../demo/warehouse-example.json', import.meta.url), 'utf8')
  );
  definition.name = uniqueName('Entrepôt');
  const response = await request.post(`${baseURL}/api/warehouses`, { data: definition });
  return response.json();
}

/** Supprime via l'API tous les projets/entrepôts dont le nom contient [test. */
export async function cleanupTestData(request, baseURL) {
  const projects = await (await request.get(`${baseURL}/api/projects`)).json();
  for (const project of projects) {
    if (project.name.includes('[test')) {
      await request.delete(`${baseURL}/api/projects/${project.id}`);
    }
  }
  const warehouses = await (await request.get(`${baseURL}/api/warehouses`)).json();
  for (const warehouse of warehouses) {
    if (warehouse.name.includes('[test')) {
      await request.delete(`${baseURL}/api/warehouses/${warehouse.id}`);
    }
  }
}
