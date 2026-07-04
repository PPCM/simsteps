// Exécution et historique des runs de simulation. Un run référence un
// entrepôt et (optionnellement) un scénario stocké ; les paramètres
// effectifs sont figés dans scenario_snapshot pour les comparaisons.

import { buildWarehouse } from '../../sim/warehouse.js';
import { runSimulation } from '../../sim/engine.js';
import { validateScenarioParams } from '../validate.js';
import { ID_OPTS, RUN_LIST_OPTS } from '../schemas.js';

export function registerRunRoutes(app, pool) {
  app.post('/api/runs', async (request, reply) => {
    const { warehouseId, scenarioId, projectId, overrides = {} } = request.body ?? {};
    if (!warehouseId) return reply.code(400).send({ errors: ['« warehouseId » est requis'] });

    const warehouseRow = await pool.query('SELECT definition FROM warehouses WHERE id = $1', [warehouseId]);
    if (warehouseRow.rows.length === 0) return reply.code(404).send({ error: 'Entrepôt introuvable' });

    let baseParams = {};
    if (scenarioId) {
      const scenarioRow = await pool.query('SELECT params FROM scenarios WHERE id = $1', [scenarioId]);
      if (scenarioRow.rows.length === 0) return reply.code(404).send({ error: 'Scénario introuvable' });
      baseParams = scenarioRow.rows[0].params;
    }
    if (projectId) {
      const projectRow = await pool.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
      if (projectRow.rows.length === 0) return reply.code(404).send({ error: 'Projet introuvable' });
    }
    const params = { ...baseParams, ...overrides };
    const errors = validateScenarioParams(params);
    if (errors.length > 0) return reply.code(400).send({ errors });

    const warehouse = buildWarehouse(warehouseRow.rows[0].definition);
    const { kpis, scenario, traffic } = runSimulation(warehouse, params);

    const { rows } = await pool.query(
      `INSERT INTO runs (warehouse_id, scenario_id, project_id, scenario_snapshot, kpis, traffic)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, warehouse_id, scenario_id, project_id, scenario_snapshot, kpis, created_at`,
      [warehouseId, scenarioId ?? null, projectId ?? null, scenario, kpis, JSON.stringify(traffic)]
    );
    return reply.code(201).send(rows[0]);
  });

  app.get('/api/runs', RUN_LIST_OPTS, async (request) => {
    // Filtres optionnels pour la comparaison de runs
    const conditions = [];
    const values = [];
    if (request.query.warehouseId) {
      values.push(request.query.warehouseId);
      conditions.push(`warehouse_id = $${values.length}`);
    }
    if (request.query.scenarioId) {
      values.push(request.query.scenarioId);
      conditions.push(`scenario_id = $${values.length}`);
    }
    if (request.query.projectId) {
      values.push(request.query.projectId);
      conditions.push(`project_id = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, warehouse_id, scenario_id, project_id, scenario_snapshot, kpis, created_at
       FROM runs ${where} ORDER BY id DESC`,
      values
    );
    return rows;
  });

  app.get('/api/runs/:id', ID_OPTS, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM runs WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Run introuvable' });
    return rows[0];
  });

  app.delete('/api/runs/:id', ID_OPTS, async (request, reply) => {
    const { rowCount } = await pool.query('DELETE FROM runs WHERE id = $1', [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Run introuvable' });
    return reply.code(204).send();
  });
}
