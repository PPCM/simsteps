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

test('glisser un couloir le déplace au mètre, borné dans le sol', async ({ page, request, baseURL }) => {
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  // Couloir horizontal le plus en avant (formats historique et liste)
  const front = Array.isArray(definition.corridors)
    ? definition.corridors.filter((c) => c.orientation !== 'vertical')
        .sort((a, b) => a.y - b.y)[0]
    : { x: 0, y: definition.corridors.frontY, length: definition.dimensions.width };
  // Cible : 2 m plus bas, sans dépasser le débouché des allées (un
  // couloir au milieu des baies déconnecterait le réseau)
  const targetY = Math.min(front.y + 2, Math.min(...definition.aisles.map((a) => a.yStart)) - 1);
  const points = await page.evaluate(({ c, targetY }) => {
    const { camera } = window.simstepsDebug;
    const rect = document.getElementById('scene').getBoundingClientRect();
    const toScreen = (wx, wz) => {
      const v = camera.position.clone().set(wx, 0, wz).project(camera);
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    };
    return { from: toScreen(c.x + c.length - 6, c.y), to: toScreen(c.x + c.length - 6, targetY) };
  }, { c: front, targetY });
  const point = points.from;

  // Sélection au clic : le panneau montre le couloir et ses propriétés
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#selProps .placeholder')).toHaveText(/^Couloir C/);

  // Le panneau de sélection grandit et la fenêtre d'édition peut alors
  // recouvrir le point de drag : on la replie le temps du geste
  await page.locator('#editPanel .win-toggle').click();

  // Glisser jusqu'à la cible projetée : déterministe quel que soit le
  // cadrage de la caméra
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(
      point.x + (points.to.x - point.x) * i / 4,
      point.y + (points.to.y - point.y) * i / 4
    );
  }
  await page.mouse.up();
  // Champs : id, label, x, y, longueur, largeur (l'orientation est un menu)
  const y = Number(await page.locator('#selProps input').nth(3).inputValue());
  expect(y).toBe(targetY);
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  // Redéplie la fenêtre d'édition pour sortir proprement
  await page.locator('#editPanel .win-toggle').click();
  await page.locator('#editCancel').click();
});

test('les racks d’une allée se règlent depuis son panneau', async ({ page, request, baseURL }) => {
  const label = await selectInScene(page, 'Allée');
  const aisleId = label.replace('Allée ', '');
  const setField = async (name, value) => {
    const input = page.locator('#selProps .field', { hasText: name }).first().locator('input');
    await input.fill(String(value));
    await input.blur();
  };
  await setField('Niveaux de rack', 3);
  await setField('Hauteur de niveau', 2.5);
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  // Les pavés des racks de l'allée culminent à 3 × 2,5 = 7,5 m
  const heights = await page.evaluate((id) => {
    const out = [];
    window.simstepsDebug.scene.traverse((o) => {
      if (o.parent?.userData?.type === 'aisle' && o.parent.userData.id === id
          && o.geometry?.parameters?.height !== undefined && o.isMesh) {
        out.push(o.geometry.parameters.height);
      }
    });
    return out;
  }, aisleId);
  expect(heights).toEqual([7.5, 7.5]);

  // Enregistrement : les deux racks de l'allée sont persistés
  await page.locator('#editSave').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt enregistré.');
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  const racks = definition.racks.filter((r) => r.aisle === aisleId);
  expect(racks).toHaveLength(2);
  for (const rack of racks) {
    expect(rack.levels).toBe(3);
    expect(rack.levelHeight).toBe(2.5);
  }
});

test('un réseau invalide reste visible, signalé et non enregistrable', async ({ page }) => {
  // Nouveau couloir, déplacé par champs près de la réception : elle s'y
  // raccorde et devient inaccessible → réseau non connexe. La scène doit
  // suivre le modèle (bande à la nouvelle position) malgré l'erreur.
  await page.locator('#editAddCorridor').click();
  await expect(page.locator('#selProps .placeholder')).toHaveText(/^Couloir C/);
  const setField = async (label, value) => {
    const input = page.locator('#selProps .field', { hasText: label }).first().locator('input, select');
    await input.fill(String(value));
    await input.blur();
  };
  await setField('x', 33); // hors de l'axe de toute allée : aucun débouché
  await setField('y', 39); // à 1 m de la réception, qui s'y raccroche

  const bandOf = (id) => page.evaluate((cid) => {
    let found = null;
    window.simstepsDebug.scene.traverse((o) => {
      if (o.parent?.userData?.type === 'corridor' && o.parent.userData.id === cid
          && o.geometry?.parameters?.width !== undefined) {
        found = { x: o.position.x, z: o.position.z };
      }
    });
    return found;
  }, id);

  // La bande suit le modèle même si le réseau est cassé
  const band = await bandOf('C3');
  expect(band.z).toBe(39);
  const errors = page.locator('#editErrors li');
  await expect(page.locator('#editSave')).toBeDisabled();
  await expect(errors.first()).toContainText('non connexe');

  // Reconnexion : le couloir couvre l'axe d'une allée et lui offre un
  // débouché — l'erreur disparaît, Enregistrer revient
  await setField('x', 20);
  await expect(errors).toHaveCount(0);
  await expect(page.locator('#editSave')).toBeEnabled();

  await page.locator('#editCancel').click();
});

test('changer la taille du sol recadre la caméra sur le nouveau terrain', async ({ page, request, baseURL }) => {
  const before = await page.evaluate(() => window.simstepsDebug.camera.position.toArray());

  // Profondeur + 20 m : le sol grandit vers la caméra, hors champ sans
  // recadrage — la caméra doit se replacer pour montrer tout le terrain
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  const newDepth = definition.dimensions.depth + 20;
  const depth = page.locator('#globalProps input').nth(2);
  await depth.fill(String(newDepth));
  await depth.blur();
  await expect(page.locator('#editErrors li')).toHaveCount(0);
  const after = await page.evaluate(() => window.simstepsDebug.camera.position.toArray());
  expect(after).not.toEqual(before);
  const target = await page.evaluate(() => window.simstepsDebug.controls.target.toArray());
  expect(target[2]).toBeCloseTo(newDepth / 2, 1); // centre du nouveau sol

  await page.locator('#editCancel').click();
});

test('ajouter un parking d’agents et l’enregistrer', async ({ page, request, baseURL }) => {
  await page.locator('#editAddParking').click();
  await expect(page.locator('#selProps .placeholder')).toHaveText('Parking PK1');
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  // Les engins admis se cochent dans le catalogue (le panneau se
  // re-rend après chaque coche)
  await page.locator('#selProps .check-item', { hasText: 'Chariot rétractable' })
    .locator('input').check();
  await page.locator('#selProps .check-item', { hasText: 'Chariot tridirectionnel (VNA)' })
    .locator('input').check();
  await expect(page.locator('#selProps .check-item input:checked')).toHaveCount(2);
  await expect(page.locator('#editErrors li')).toHaveCount(0);

  await page.locator('#editSave').click();
  await expect(page.locator('#warehouseStatus')).toHaveText('Entrepôt enregistré.');
  const { definition } = await (await request.get(`${baseURL}/api/warehouses/${testWarehouse.id}`)).json();
  expect(definition.parkings).toHaveLength(1);
  expect(definition.parkings[0].id).toBe('PK1');
  expect(definition.parkings[0].vehicles).toEqual(['retractable', 'vna']);
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
