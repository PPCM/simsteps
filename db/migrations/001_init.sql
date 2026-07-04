-- Schéma initial : entrepôts, scénarios et runs de simulation.
-- Les définitions et paramètres sont stockés en JSONB : le format JSON
-- importable/exportable est la source de vérité, la base ajoute
-- l'identité, l'horodatage et les relations.

CREATE TABLE warehouses (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  definition  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenarios (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  params      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id                 SERIAL PRIMARY KEY,
  warehouse_id       INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  scenario_id        INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  -- Copie des paramètres au moment du run : le scénario d'origine peut
  -- être modifié ou supprimé sans fausser l'historique
  scenario_snapshot  JSONB NOT NULL,
  kpis               JSONB NOT NULL,
  -- Trajets agrégés : trafic par arête du graphe, pour heatmap/spaghetti
  traffic            JSONB NOT NULL DEFAULT '[]',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX runs_warehouse_id_idx ON runs (warehouse_id);
CREATE INDEX runs_scenario_id_idx ON runs (scenario_id);
