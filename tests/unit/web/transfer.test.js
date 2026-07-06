// Tests de l'import/export JSON côté interface : analyse du fichier
// importé et nom de fichier d'export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedJson, exportFilename } from '../../../web/public/js/transfer.js';

test('un objet JSON valide est rendu tel quel', () => {
  assert.deepEqual(parseImportedJson('{"name": "Essai", "operators": 5}'),
    { name: 'Essai', operators: 5 });
});

test('un fichier non JSON est refusé en français', () => {
  assert.throws(() => parseImportedJson('pas du json'), /JSON valide/);
});

test('un JSON qui n’est pas un objet est refusé', () => {
  for (const text of ['42', '"texte"', '[1, 2]', 'null']) {
    assert.throws(() => parseImportedJson(text), /objet JSON/, text);
  }
});

test('le nom de fichier retire accents et caractères spéciaux', () => {
  assert.equal(exportFilename('Entrepôt exemple SimSteps'), 'entrepot-exemple-simsteps.json');
  assert.equal(exportFilename('Flux complet — flotte mixte'), 'flux-complet-flotte-mixte.json');
});

test('un nom vide retombe sur le nom de repli', () => {
  assert.equal(exportFilename('', 'entrepot'), 'entrepot.json');
  assert.equal(exportFilename('***', 'scenario'), 'scenario.json');
  assert.equal(exportFilename(undefined), 'export.json');
});
