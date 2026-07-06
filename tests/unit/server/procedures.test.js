// Tests des routes /api/procedures : liste triée avec titres, contenu
// Markdown, dossier absent toléré, noms de fichiers sûrs. Le dossier
// est un répertoire temporaire injecté dans buildApp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../../server/app.js';

const fakePool = { query: async () => ({ rows: [] }) };

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'simsteps-procedures-'));
  await writeFile(join(dir, 'zeta.md'), '# Zone Z — procédure\n\nContenu Z.\n');
  await writeFile(join(dir, 'alpha.md'), 'Sans titre de niveau 1.\n');
  await writeFile(join(dir, 'notes.txt'), 'pas une procédure');
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('GET /api/procedures liste les .md triés par titre, .txt ignoré', async () => {
  const app = await buildApp({ pool: fakePool, proceduresRoot: dir });
  const response = await app.inject({ method: 'GET', url: '/api/procedures' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [
    { file: 'alpha.md', title: 'alpha' }, // sans en-tête : nom du fichier
    { file: 'zeta.md', title: 'Zone Z — procédure' },
  ]);
  await app.close();
});

test('GET /api/procedures/:file renvoie le Markdown et son titre', async () => {
  const app = await buildApp({ pool: fakePool, proceduresRoot: dir });
  const response = await app.inject({ method: 'GET', url: '/api/procedures/zeta.md' });
  assert.equal(response.statusCode, 200);
  const doc = response.json();
  assert.equal(doc.title, 'Zone Z — procédure');
  assert.match(doc.markdown, /Contenu Z\./);
  await app.close();
});

test('fichier inconnu ou nom non sûr : 404 en français', async () => {
  const app = await buildApp({ pool: fakePool, proceduresRoot: dir });
  for (const url of [
    '/api/procedures/absent.md',
    '/api/procedures/..%2Fsecret.md',
    '/api/procedures/notes.txt',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 404, url);
    assert.equal(response.json().error, 'Procédure introuvable');
  }
  await app.close();
});

test('dossier absent ou non fourni : liste vide, pas d’erreur', async () => {
  for (const proceduresRoot of [undefined, join(dir, 'inexistant')]) {
    const app = await buildApp({ pool: fakePool, proceduresRoot });
    const response = await app.inject({ method: 'GET', url: '/api/procedures' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
    await app.close();
  }
});
