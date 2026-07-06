// Tests UI de l'assistant d'import WMS : parcours nominal (emplacements
// analysés, commandes calibrées, étapes facultatives passées, création
// entrepôt + scénario + projet et ouverture de l'éditeur 3D) et cas
// d'erreur (CSV illisible, colonnes obligatoires absentes).

import { test, expect } from '@playwright/test';
import { openApp, openConfigTab, uniqueName, cleanupTestData } from './helpers.js';

test.afterEach(async ({ request, baseURL }) => {
  await cleanupTestData(request, baseURL);
});

function csvFile(name, text) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') };
}

// Référentiel : 6 allées × 5 travées × 2 niveaux (60 adresses)
function locationsCsv() {
  const lines = ['Allée;Travée;Niveau;Magasin'];
  for (let a = 1; a <= 6; a++) {
    for (let bay = 1; bay <= 5; bay++) {
      for (let level = 1; level <= 2; level++) {
        lines.push(`A0${a};${String(bay).padStart(2, '0')};${level};${a <= 3 ? 'PICKING' : 'RESERVE'}`);
      }
    }
  }
  return lines.join('\n');
}

// Commandes : 2 jours × (48 B2C WEB + 32 B2B MAGASIN, 4 clients)
// → 160 commandes / (2 j × 8 h) = 10/h, part B2C 0,6, 4 clients B2B
function ordersCsv() {
  const lines = ['N° Commande;Client;Type flux;Date création'];
  for (const day of ['2026-05-04', '2026-05-05']) {
    for (let i = 0; i < 48; i++) lines.push(`W-${day}-${i};WEB${i};WEB;${day} 08:30`);
    for (let i = 0; i < 32; i++) lines.push(`M-${day}-${i};CLI${i % 4};MAGASIN;${day} 09:15`);
  }
  return lines.join('\n');
}

test('parcours nominal : CSV → entrepôt + scénario calibré + projet + éditeur', async ({ page }) => {
  const name = uniqueName('Import WMS');
  await openApp(page);
  await openConfigTab(page);
  await page.locator('#warehouseWizard').click();
  await expect(page.locator('#wizard')).toBeVisible();

  // Étape 1 — emplacements : Suivant bloqué avant analyse
  await expect(page.locator('#wizardNext')).toBeDisabled();
  await page.locator('[data-role="file-locations"]').setInputFiles(csvFile('emplacements.csv', locationsCsv()));
  await expect(page.locator('#wizardStatus')).toContainText('60 ligne(s)');
  await page.locator('[data-role="analyze-locations"]').click();
  await expect(page.locator('[data-role="aisles-summary"] tr')).toHaveCount(7); // en-tête + 6 allées
  await expect(page.locator('#wizardBody')).toContainText('60 emplacements → 6 allée(s)');
  await expect(page.locator('#wizardNext')).toBeEnabled();
  await page.locator('#wizardNext').click();

  // Étape 2 — commandes : correspondance des flux proposée, analyse
  await page.locator('[data-role="file-orders"]').setInputFiles(csvFile('commandes.csv', ordersCsv()));
  await expect(page.locator('[data-role="flow-WEB"]')).toHaveValue('b2c');
  await page.locator('[data-role="flow-MAGASIN"]').selectOption('b2b');
  await page.locator('[data-role="analyze-orders"]').click();
  await expect(page.locator('#wizardBody')).toContainText('160 commandes sur 2 jour(s)');
  await expect(page.locator('#wizardBody')).toContainText('part B2C 60 %');
  await page.locator('#wizardNext').click();

  // Étapes 3 et 4 passées
  await page.locator('#wizardSkip').click();
  await page.locator('#wizardSkip').click();

  // Récapitulatif : nom, création, éditeur 3D ouvert sur l'entrepôt créé
  await page.locator('[data-role="wizard-name"]').fill(name);
  await page.locator('[data-role="wizard-name"]').blur();
  await expect(page.locator('#wizardBody')).toContainText('ordersPerHour = 10');
  await page.locator('#wizardNext').click();
  await expect(page.locator('#wizard')).toBeHidden();
  await expect(page.locator('#editChrome')).toBeVisible();
  await expect(page.locator('#editTitle')).toHaveText(name);

  // Sortie de l'édition : le projet et le scénario calibré sont actifs
  await page.locator('#editCancel').click();
  await expect(page.locator('#project option:checked')).toHaveText(name);
  await expect(page.locator('#scenario option:checked')).toHaveText(`${name} — scénario`);
  await page.waitForFunction(() => {
    const params = window.simstepsDebug.currentParams();
    return params.ordersPerHour === 10 && params.b2cShare === 0.6 && params.b2bClients === 4;
  });
});

test('erreurs : fichier illisible puis colonne obligatoire absente', async ({ page }) => {
  await openApp(page);
  await openConfigTab(page);
  await page.locator('#warehouseWizard').click();

  // CSV vide : erreur française, l'assistant reste ouvert
  await page.locator('[data-role="file-locations"]').setInputFiles(csvFile('vide.csv', '\n\n'));
  await expect(page.locator('#wizardStatus')).toContainText('CSV est vide');
  await expect(page.locator('#wizard')).toBeVisible();

  // Colonnes inconnues : l'analyse réclame la colonne obligatoire
  await page.locator('[data-role="file-locations"]').setInputFiles(csvFile('brouillon.csv', 'Foo;Bar\n1;2\n'));
  await page.locator('[data-role="analyze-locations"]').click();
  await expect(page.locator('#wizardStatus')).toContainText('« Allée » non identifiée');
  await expect(page.locator('#wizardNext')).toBeDisabled();

  // Fermeture propre
  await page.locator('#wizardClose').click();
  await expect(page.locator('#wizard')).toBeHidden();
});
