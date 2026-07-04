// Tests des routes projets et du rattachement des runs à un projet,
// via inject() et un pool factice paramétrable (aucune base requise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../../../server/app.js';

const warehouseDefinition = JSON.parse(
  await readFile(new URL('../../../data/warehouse-example.json', import.meta.url), 'utf8')
);

// Pool factice paramétrable : chaque handler est un couple [fragment SQL,
// réponse] ; le premier fragment trouvé dans la requête gagne. Toutes les
// requêtes sont journalisées pour les assertions.
function makePool(handlers = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      for (const [fragment, response] of handlers) {
        if (sql.includes(fragment)) {
          return typeof response === 'function' ? response(sql, values) : response;
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const PROJECT_ROW = {
  id: 1, name: 'Projet test', warehouse_id: 2, scenario_id: 3,
  settings: { operators: 4 }, created_at: 't', updated_at: 't',
};

test('GET /api/projects renvoie la liste', async () => {
  const pool = makePool([['FROM projects', { rows: [PROJECT_ROW] }]]);
  const app = await buildApp({ pool });
  const response = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [PROJECT_ROW]);
  await app.close();
});

test('GET /api/projects/:id renvoie 404 si absent', async () => {
  const app = await buildApp({ pool: makePool() });
  const response = await app.inject({ method: 'GET', url: '/api/projects/9' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'Projet introuvable');
  await app.close();
});

test('POST /api/projects crée un projet valide', async () => {
  const pool = makePool([
    ['FROM warehouses', { rows: [{ '?column?': 1 }] }],
    ['FROM scenarios', { rows: [{ '?column?': 1 }] }],
    ['INSERT INTO projects', { rows: [PROJECT_ROW] }],
  ]);
  const app = await buildApp({ pool });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Projet test', warehouseId: 2, scenarioId: 3, settings: { operators: 4 } },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), PROJECT_ROW);
  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO projects'));
  assert.deepEqual(insert.values, ['Projet test', 2, 3, { operators: 4 }]);
  await app.close();
});

test('POST /api/projects accepte un scénario absent (null)', async () => {
  const pool = makePool([
    ['FROM warehouses', { rows: [{ '?column?': 1 }] }],
    ['INSERT INTO projects', { rows: [PROJECT_ROW] }],
  ]);
  const app = await buildApp({ pool });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'Sans scénario', warehouseId: 2 },
  });
  assert.equal(response.statusCode, 201);
  // Aucune vérification d'existence de scénario ne doit avoir eu lieu
  assert.ok(!pool.calls.some((c) => c.sql.includes('FROM scenarios')));
  await app.close();
});

test('POST /api/projects rejette les paramétrages invalides', async () => {
  const app = await buildApp({ pool: makePool() });
  for (const settings of [
    { strategy: 'magique' },
    { operators: 0 },
    { inconnu: 1 },
    { name: 'interdit' },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'P', warehouseId: 1, settings },
    });
    assert.equal(response.statusCode, 400, JSON.stringify(settings));
    assert.ok(response.json().errors.length > 0);
  }
  await app.close();
});

test('POST /api/projects rejette un nom vide ou un warehouseId manquant', async () => {
  const app = await buildApp({ pool: makePool() });
  const noName = await app.inject({ method: 'POST', url: '/api/projects', payload: { warehouseId: 1 } });
  assert.equal(noName.statusCode, 400);
  const noWarehouse = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P' } });
  assert.equal(noWarehouse.statusCode, 400);
  await app.close();
});

test('POST /api/projects renvoie 404 si l’entrepôt référencé n’existe pas', async () => {
  const app = await buildApp({ pool: makePool() });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'P', warehouseId: 99 },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'Entrepôt introuvable');
  await app.close();
});

test('PUT /api/projects/:id met à jour puis 404 si absent', async () => {
  const okPool = makePool([
    ['FROM warehouses', { rows: [{ '?column?': 1 }] }],
    ['UPDATE projects', { rows: [PROJECT_ROW] }],
  ]);
  const app = await buildApp({ pool: okPool });
  const payload = { name: 'Projet test', warehouseId: 2 };
  const ok = await app.inject({ method: 'PUT', url: '/api/projects/1', payload });
  assert.equal(ok.statusCode, 200);
  await app.close();

  const missingPool = makePool([['FROM warehouses', { rows: [{ '?column?': 1 }] }]]);
  const app2 = await buildApp({ pool: missingPool });
  const missing = await app2.inject({ method: 'PUT', url: '/api/projects/9', payload });
  assert.equal(missing.statusCode, 404);
  await app2.close();
});

test('DELETE /api/projects/:id renvoie 204 puis 404', async () => {
  const app = await buildApp({ pool: makePool([['DELETE FROM projects', { rows: [], rowCount: 1 }]]) });
  const ok = await app.inject({ method: 'DELETE', url: '/api/projects/1' });
  assert.equal(ok.statusCode, 204);
  await app.close();

  const app2 = await buildApp({ pool: makePool() });
  const missing = await app2.inject({ method: 'DELETE', url: '/api/projects/1' });
  assert.equal(missing.statusCode, 404);
  await app2.close();
});

test('GET /api/runs?projectId=3 filtre par projet', async () => {
  const pool = makePool([['FROM runs', { rows: [] }]]);
  const app = await buildApp({ pool });
  const response = await app.inject({ method: 'GET', url: '/api/runs?projectId=3' });
  assert.equal(response.statusCode, 200);
  const query = pool.calls.find((c) => c.sql.includes('FROM runs'));
  assert.match(query.sql, /project_id = \$1/);
  assert.deepEqual(query.values, [3]);
  await app.close();
});

test('POST /api/runs avec un projectId inconnu renvoie 404 avant simulation', async () => {
  const pool = makePool([
    ['FROM warehouses', { rows: [{ definition: warehouseDefinition }] }],
    // Aucune ligne pour le projet
  ]);
  const app = await buildApp({ pool });
  const response = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { warehouseId: 1, projectId: 42 },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'Projet introuvable');
  assert.ok(!pool.calls.some((c) => c.sql.includes('INSERT INTO runs')));
  await app.close();
});

test('POST /api/runs avec projectId enregistre project_id', async () => {
  const pool = makePool([
    ['FROM warehouses', { rows: [{ definition: warehouseDefinition }] }],
    ['FROM projects', { rows: [{ '?column?': 1 }] }],
    ['INSERT INTO runs', (sql, values) => ({ rows: [{ id: 1, project_id: values[2] }] })],
  ]);
  const app = await buildApp({ pool });
  const response = await app.inject({
    method: 'POST',
    url: '/api/runs',
    payload: { warehouseId: 1, projectId: 7, overrides: { durationHours: 0.05 } },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().project_id, 7);
  await app.close();
});
