// CRUD des entrepôts. La définition JSON complète est importée/exportée
// telle quelle : GET /api/warehouses/:id renvoie le document réimportable.

import { validateWarehouseDefinition } from '../validate.js';
import { ID_OPTS } from '../schemas.js';

export function registerWarehouseRoutes(app, pool) {
  app.get('/api/warehouses', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, created_at, updated_at FROM warehouses ORDER BY id'
    );
    return rows;
  });

  app.get('/api/warehouses/:id', ID_OPTS, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM warehouses WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Entrepôt introuvable' });
    return rows[0];
  });

  app.post('/api/warehouses', async (request, reply) => {
    const definition = request.body?.definition ?? request.body;
    const errors = validateWarehouseDefinition(definition);
    if (errors.length > 0) return reply.code(400).send({ errors });
    const name = request.body?.name ?? definition.name;
    const { rows } = await pool.query(
      'INSERT INTO warehouses (name, definition) VALUES ($1, $2) RETURNING id, name, created_at, updated_at',
      [name, definition]
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/warehouses/:id', ID_OPTS, async (request, reply) => {
    const definition = request.body?.definition ?? request.body;
    const errors = validateWarehouseDefinition(definition);
    if (errors.length > 0) return reply.code(400).send({ errors });
    const name = request.body?.name ?? definition.name;
    const { rows } = await pool.query(
      `UPDATE warehouses SET name = $1, definition = $2, updated_at = now()
       WHERE id = $3 RETURNING id, name, created_at, updated_at`,
      [name, definition, request.params.id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Entrepôt introuvable' });
    return rows[0];
  });

  app.delete('/api/warehouses/:id', ID_OPTS, async (request, reply) => {
    const { rowCount } = await pool.query('DELETE FROM warehouses WHERE id = $1', [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Entrepôt introuvable' });
    return reply.code(204).send();
  });
}
