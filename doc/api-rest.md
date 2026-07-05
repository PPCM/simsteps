# API REST

L'API est servie par l'application sur le même port que l'interface
(par défaut http://localhost:3000). Une limite de débit globale
s'applique (1000 requêtes/min par IP, statiques comprises).

| Méthode et route | Rôle |
|---|---|
| `GET /health` | État du serveur et de la base |
| `GET/POST /api/warehouses`, `GET/PUT/DELETE /api/warehouses/:id` | CRUD entrepôts (import/export JSON direct) |
| `GET/POST /api/scenarios`, `GET/PUT/DELETE /api/scenarios/:id` | CRUD scénarios |
| `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` | CRUD projets — corps : `{"name": "…", "warehouseId": 1, "scenarioId": 1, "settings": {"operators": 8, "strategy": "zoneWave"}}` (`scenarioId` optionnel, `settings` = surcharges de paramètres de scénario) |
| `POST /api/runs` | Exécute une simulation côté serveur et l'enregistre — corps : `{"warehouseId": 1, "scenarioId": 1, "projectId": 1, "overrides": {"operators": 8}}` (`projectId` optionnel) |
| `GET /api/runs?warehouseId=&scenarioId=&projectId=` | Liste des runs (KPI inclus) |
| `GET /api/runs/:id` | Détail d'un run (avec trajets agrégés) |
| `DELETE /api/runs/:id` | Suppression |

Le format du document d'entrepôt et les paramètres de scénario sont
détaillés dans la [personnalisation](personnalisation.md).
