-- Projets : regroupement d'un entrepôt, d'un scénario et de paramétrages.
-- Pas de versionnage : le projet référence les entités vivantes, les
-- surcharges de paramètres vivent dans « settings » (JSONB).

CREATE TABLE projects (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  -- Un projet sans entrepôt est inexploitable : suppression en cascade
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  -- Le projet reste simulable sans scénario (défauts du moteur + settings)
  scenario_id  INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  settings     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_warehouse_id_idx ON projects (warehouse_id);
CREATE INDEX projects_scenario_id_idx ON projects (scenario_id);

-- Rattachement optionnel des runs à un projet ; l'historique survit à la
-- suppression du projet (le run est autoportant via scenario_snapshot)
ALTER TABLE runs ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX runs_project_id_idx ON runs (project_id);
