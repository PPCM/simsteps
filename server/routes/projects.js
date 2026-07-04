// CRUD des projets : regroupement d'un entrepôt, d'un scénario et de
// paramétrages (surcharges de paramètres de scénario). Le projet
// référence les entités vivantes, sans copie ni versionnage.

import { validateProjectPayload } from '../validate.js';
import { ID_OPTS } from '../schemas.js';

// Vérifie l'existence des références du projet ; renvoie un 404 (même
// convention que les runs) et true si une référence est introuvable.
async function referencesMissing(pool, reply, { warehouseId, scenarioId }) {
  const warehouseRow = await pool.query('SELECT 1 FROM warehouses WHERE id = $1', [warehouseId]);
  if (warehouseRow.rows.length === 0) {
    reply.code(404).send({ error: 'Entrepôt introuvable' });
    return true;
  }
  if (scenarioId !== undefined && scenarioId !== null) {
    const scenarioRow = await pool.query('SELECT 1 FROM scenarios WHERE id = $1', [scenarioId]);
    if (scenarioRow.rows.length === 0) {
      reply.code(404).send({ error: 'Scénario introuvable' });
      return true;
    }
  }
  return false;
}

export function registerProjectRoutes(app, pool) {
  app.get('/api/projects', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, warehouse_id, scenario_id, settings, created_at, updated_at FROM projects ORDER BY id'
    );
    return rows;
  });

  app.get('/api/projects/:id', ID_OPTS, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Projet introuvable' });
    return rows[0];
  });

  app.post('/api/projects', async (request, reply) => {
    const { name, warehouseId, scenarioId, settings = {} } = request.body ?? {};
    const errors = validateProjectPayload({ name, warehouseId, scenarioId, settings });
    if (errors.length > 0) return reply.code(400).send({ errors });
    if (await referencesMissing(pool, reply, { warehouseId, scenarioId })) return;
    const { rows } = await pool.query(
      `INSERT INTO projects (name, warehouse_id, scenario_id, settings) VALUES ($1, $2, $3, $4)
       RETURNING id, name, warehouse_id, scenario_id, settings, created_at, updated_at`,
      [name, warehouseId, scenarioId ?? null, settings]
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/projects/:id', ID_OPTS, async (request, reply) => {
    const { name, warehouseId, scenarioId, settings = {} } = request.body ?? {};
    const errors = validateProjectPayload({ name, warehouseId, scenarioId, settings });
    if (errors.length > 0) return reply.code(400).send({ errors });
    if (await referencesMissing(pool, reply, { warehouseId, scenarioId })) return;
    const { rows } = await pool.query(
      `UPDATE projects SET name = $1, warehouse_id = $2, scenario_id = $3, settings = $4, updated_at = now()
       WHERE id = $5 RETURNING id, name, warehouse_id, scenario_id, settings, created_at, updated_at`,
      [name, warehouseId, scenarioId ?? null, settings, request.params.id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Projet introuvable' });
    return rows[0];
  });

  app.delete('/api/projects/:id', ID_OPTS, async (request, reply) => {
    const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Projet introuvable' });
    return reply.code(204).send();
  });
}
