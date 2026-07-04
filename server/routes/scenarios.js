// CRUD des scénarios : paramètres de simulation importables/exportables.

import { validateScenarioParams } from '../validate.js';
import { ID_OPTS } from '../schemas.js';

export function registerScenarioRoutes(app, pool) {
  app.get('/api/scenarios', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, params, created_at, updated_at FROM scenarios ORDER BY id'
    );
    return rows;
  });

  app.get('/api/scenarios/:id', ID_OPTS, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM scenarios WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Scénario introuvable' });
    return rows[0];
  });

  app.post('/api/scenarios', async (request, reply) => {
    const params = request.body?.params ?? request.body;
    const errors = validateScenarioParams(params);
    if (errors.length > 0) return reply.code(400).send({ errors });
    const name = request.body?.name ?? params.name ?? 'Scénario sans nom';
    const { rows } = await pool.query(
      'INSERT INTO scenarios (name, params) VALUES ($1, $2) RETURNING id, name, params, created_at, updated_at',
      [name, params]
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/scenarios/:id', ID_OPTS, async (request, reply) => {
    const params = request.body?.params ?? request.body;
    const errors = validateScenarioParams(params);
    if (errors.length > 0) return reply.code(400).send({ errors });
    const name = request.body?.name ?? params.name ?? 'Scénario sans nom';
    const { rows } = await pool.query(
      `UPDATE scenarios SET name = $1, params = $2, updated_at = now()
       WHERE id = $3 RETURNING id, name, params, created_at, updated_at`,
      [name, params, request.params.id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Scénario introuvable' });
    return rows[0];
  });

  app.delete('/api/scenarios/:id', ID_OPTS, async (request, reply) => {
    const { rowCount } = await pool.query('DELETE FROM scenarios WHERE id = $1', [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Scénario introuvable' });
    return reply.code(204).send();
  });
}
