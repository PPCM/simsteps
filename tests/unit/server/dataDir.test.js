// Tests du dossier de travail data/ (copie des démos sans écrasement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDataDir } from '../../../server/dataDir.js';

async function makeDemoDir() {
  const root = await mkdtemp(join(tmpdir(), 'simsteps-datadir-'));
  const demoDir = join(root, 'demo');
  await mkdir(demoDir);
  await writeFile(join(demoDir, 'a.json'), '{"demo":"a"}');
  await writeFile(join(demoDir, 'b.json'), '{"demo":"b"}');
  return { root, demoDir, dataDir: join(root, 'data') };
}

test('premier démarrage : le dossier est créé et les démos copiées', async () => {
  const { root, demoDir, dataDir } = await makeDemoDir();
  const copied = await ensureDataDir(demoDir, dataDir);
  assert.deepEqual(copied, ['a.json', 'b.json']);
  assert.equal(await readFile(join(dataDir, 'a.json'), 'utf8'), '{"demo":"a"}');
  await rm(root, { recursive: true });
});

test('un fichier présent n’est jamais écrasé, les manquants sont copiés', async () => {
  const { root, demoDir, dataDir } = await makeDemoDir();
  await mkdir(dataDir);
  // L'utilisateur a modifié sa copie de a.json et ajouté un fichier à lui
  await writeFile(join(dataDir, 'a.json'), '{"modifie":true}');
  await writeFile(join(dataDir, 'mien.json'), '{"perso":true}');
  const copied = await ensureDataDir(demoDir, dataDir);
  assert.deepEqual(copied, ['b.json']);
  assert.equal(await readFile(join(dataDir, 'a.json'), 'utf8'), '{"modifie":true}');
  assert.equal(await readFile(join(dataDir, 'mien.json'), 'utf8'), '{"perso":true}');
  await rm(root, { recursive: true });
});

test('démarrage suivant : plus rien à copier', async () => {
  const { root, demoDir, dataDir } = await makeDemoDir();
  await ensureDataDir(demoDir, dataDir);
  assert.deepEqual(await ensureDataDir(demoDir, dataDir), []);
  await rm(root, { recursive: true });
});
