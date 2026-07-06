# Guide Développeur

## Mode développement (sans Docker pour l'application)

```bash
docker compose up db        # la base PostgreSQL seule (port 5432)
cp .env.example .env        # PORT et DATABASE_URL
npm install
npm run dev                 # serveur local avec rechargement (--watch)
```

## Pile Docker construite depuis le code local

Le `docker-compose.yml` de la racine utilise l'image publiée sur Docker
Hub (`ppcm/simsteps`) : le démarrage rapide ne compile rien. Pour
exécuter la pile avec le code de travail, la surcharge
`docker-compose.dev.yml` construit une image locale (`simsteps-dev`) :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

C'est aussi ce que lancent les tests UI quand la pile ne tourne pas
déjà : ils doivent exercer le code local, pas l'image publiée.

## Commandes utiles

```bash
npm test                    # tests unitaires (runner natif de Node, sans base)
npm run test:ui             # tests UI Playwright (navigateur réel contre la pile
                            # Docker ; la démarre si besoin en construisant
                            # l'image locale ; prérequis :
                            # npx playwright install chromium)
npm run test:e2e            # alias de test:ui (test:e2e:headed, test:e2e:ui)
npm run sim                 # simulation en console (KPI, sans base ni 3D)
npm run sim demo/scenario-waves.json   # autre scénario
```

Les tests UI travaillent sur des entrepôts et projets jetables (noms
suffixés `[test …]`, nettoyés après chaque test) : les données réelles de
la base ne sont pas touchées.

## Chart Helm : construction et validation

Le chart vit dans `helm/simsteps/`. Ses dépendances (sous-chart
PostgreSQL Bitnami) se vendorisent dans `helm/simsteps/charts/`
(gitignoré) :

```bash
helm dependency build helm/simsteps   # télécharge le sous-chart PostgreSQL
helm lint helm/simsteps               # validation statique
helm template helm/simsteps           # rendu des manifestes (doit aboutir)
```

`helm template` échoue avec une erreur française explicite si aucun
mode de base de données n'est configuré. À chaque release (tag
`v*.*.*`), la CI aligne `Chart.yaml`, `values.yaml` et le README sur la
version publiée par un commit sur `main`.

## Schéma des tables principales

| Table | Colonnes principales | Rôle |
|---|---|---|
| `warehouses` | `id`, `name`, `definition` (JSONB), `created_at`, `updated_at` | Définitions d'entrepôts (le JSON importable est stocké tel quel) |
| `scenarios` | `id`, `name`, `params` (JSONB), `created_at`, `updated_at` | Paramètres de simulation |
| `projects` | `id`, `name`, `warehouse_id` (FK), `scenario_id` (FK, nullable), `settings` (JSONB), `created_at`, `updated_at` | Projets : références vivantes vers un entrepôt et un scénario + surcharges de paramètres |
| `runs` | `id`, `warehouse_id` (FK), `scenario_id` (FK, nullable), `project_id` (FK, nullable), `scenario_snapshot` (JSONB), `kpis` (JSONB), `traffic` (JSONB), `created_at` | Historique des runs : paramètres figés, KPI et trafic agrégé par arête |
| `schema_migrations` | `name`, `applied_at` | Suivi des migrations SQL (`db/migrations/`) |

Un run garde un **instantané** de ses paramètres : modifier ou supprimer le
scénario d'origine ne fausse pas l'historique.

## Structure du projet

```
sim/      moteur de simulation (pur : sans DOM ni base, testable, aussi
          exécuté dans le navigateur pour l'animation)
server/   API Fastify + accès PostgreSQL
web/      rendu 3D Three.js + interface (aucune étape de build)
db/       migrations SQL versionnées + seed
demo/     entrepôts et scénarios de démonstration (JSON, source du seed)
data/     dossier de travail (gitignoré, monté en volume dans Docker) :
          démos copiées au premier démarrage + fichiers de l'utilisateur
helm/     chart Helm (Kubernetes)
tests/    tests unitaires (node --test, sans base) et tests UI Playwright (tests/ui/)
```
