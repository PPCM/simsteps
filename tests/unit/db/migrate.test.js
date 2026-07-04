// Tests de la sélection des migrations en attente (fonction pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingMigrations } from '../../../db/migrate.js';

test('les migrations non appliquées sortent triées', () => {
  const files = ['002_runs.sql', '001_init.sql', '003_indexes.sql'];
  const result = pendingMigrations(files, new Set());
  assert.deepEqual(result, ['001_init.sql', '002_runs.sql', '003_indexes.sql']);
});

test('les migrations déjà appliquées sont exclues', () => {
  const files = ['001_init.sql', '002_runs.sql'];
  const result = pendingMigrations(files, new Set(['001_init.sql']));
  assert.deepEqual(result, ['002_runs.sql']);
});

test('les fichiers non SQL sont ignorés', () => {
  const files = ['001_init.sql', 'notes.md', '.gitkeep'];
  assert.deepEqual(pendingMigrations(files, new Set()), ['001_init.sql']);
});

test('rien à faire quand tout est appliqué', () => {
  const files = ['001_init.sql'];
  assert.deepEqual(pendingMigrations(files, new Set(['001_init.sql'])), []);
});
