// Test de fumée : la page se charge, la simulation tourne, les deux
// fenêtres et leurs onglets sont complets et la console reste propre.

import { test, expect } from '@playwright/test';
import { openApp, openConfigTab } from './helpers.js';

test('la page se charge et la relecture démarre', async ({ page }) => {
  const consoleErrors = await openApp(page);

  // Fenêtre principale (onglet Piloter par défaut) et fenêtre Indicateurs
  for (const heading of ['Lecture', 'Scénario', 'Affichage', 'Indicateurs en direct', 'Comparaison']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // L'onglet Configurer porte le projet et l'entrepôt
  await openConfigTab(page);
  for (const heading of ['Projet', 'Entrepôt']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // L'horloge simulée avance (relecture en cours)
  const clock = page.locator('#clock');
  const before = await clock.textContent();
  await expect(clock).not.toHaveText(before, { timeout: 5_000 });

  // Sélecteurs peuplés depuis l'API
  expect(await page.locator('#warehouse option').count()).toBeGreaterThan(0);
  expect(await page.locator('#scenario option').count()).toBeGreaterThan(0);
  await expect(page.locator('#project option').first()).toHaveText('— Aucun projet —');

  expect(consoleErrors).toEqual([]);
});

test('la flotte d’engins se règle depuis l’onglet Piloter', async ({ page }) => {
  const consoleErrors = await openApp(page);
  // Ajoute 2 chariots rétractables à la flotte : la simulation se
  // relance avec 7 agents (5 piétons + 2 engins)
  const input = page.locator('#fleetInputs .field', { hasText: 'Chariot rétractable' }).locator('input');
  await input.fill('2');
  await input.blur();
  await expect(page.locator('#status')).toContainText('7 opérateurs');

  // Les engins sont rendus par leur modèle low-poly orientable
  const models = await page.evaluate(() => {
    let count = 0;
    window.simstepsDebug.scene.traverse((o) => {
      if (o.userData?.vehicleType === 'retractable') count++;
    });
    return count;
  });
  expect(models).toBe(2);

  // Le sélecteur de rangement relance la simulation sans erreur et le
  // KPI « Distance / ligne » s'alimente pendant la relecture (à ×60
  // pour dépasser rapidement les premiers prélèvements)
  await page.locator('#slotting').selectOption('abc');
  await expect(page.locator('#status')).toContainText('opérateurs');
  await page.locator('[data-speed="60"]').click();
  await expect(page.locator('#kpi-distline')).not.toHaveText('—', { timeout: 20_000 });

  expect(consoleErrors).toEqual([]);
});

test('masquer les libellés puis en révéler un au clic', async ({ page }) => {
  const consoleErrors = await openApp(page);
  const stats = () => page.evaluate(() => window.simstepsDebug.labelStats());

  // Tous les libellés sont visibles par défaut
  const initial = await stats();
  expect(initial.total).toBeGreaterThan(0);
  expect(initial.visible).toBe(initial.total);

  // Cocher la case masque tout
  await page.locator('#toggleLabels').check();
  expect((await stats()).visible).toBe(0);

  // Positions écran d'un rack et du couloir avant, par projection
  // caméra : indépendantes des dimensions de l'entrepôt
  const points = await page.evaluate(async () => {
    const warehouses = await (await fetch('/api/warehouses')).json();
    const { definition } = await (await fetch(`/api/warehouses/${warehouses[0].id}`)).json();
    const aisle = definition.aisles[0];
    const { camera } = window.simstepsDebug;
    const rect = document.getElementById('scene').getBoundingClientRect();
    const toScreen = (wx, wy, wz) => {
      const v = camera.position.clone().set(wx, wy, wz).project(camera);
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    };
    const front = Array.isArray(definition.corridors)
      ? definition.corridors.filter((c) => c.orientation !== 'vertical')
          .sort((a, b) => a.y - b.y)[0]
      : { x: 0, y: definition.corridors.frontY, length: definition.dimensions.width };
    return {
      rack: toScreen(aisle.x - 1.4, 1.2, (aisle.yStart + aisle.yEnd) / 2),
      corridor: toScreen(front.x + front.length - 6, 0, front.y),
    };
  });

  // Un clic sur un rack révèle le libellé de son allée
  await page.mouse.click(points.rack.x, points.rack.y);
  expect((await stats()).visible).toBe(1);

  // Clic dans le vide (hors de tout élément) : le libellé révélé se cache
  await page.mouse.click(10, page.viewportSize().height / 2);
  expect((await stats()).visible).toBe(0);

  // Les couloirs sont aussi des objets : clic sur la bande → libellé révélé
  await page.mouse.click(points.corridor.x, points.corridor.y);
  expect((await stats()).visible).toBe(1);

  // Décocher : tout revient
  await page.locator('#toggleLabels').uncheck();
  const restored = await stats();
  expect(restored.visible).toBe(restored.total);

  expect(consoleErrors).toEqual([]);
});
