# SimSteps

**Simulateur de flux d'entrepôt visualisable en 3D dans le navigateur.**

SimSteps modélise les déplacements d'opérateurs de préparation (picking) dans
les allées, au niveau des racks et vers les ateliers, pour une clientèle mixte
B2B et B2C. Objectif : repérer les goulets d'étranglement et comparer des
scénarios d'organisation.

- Moteur de **simulation à événements discrets** (horloge simulée, file
  d'événements), déterministe à partir d'une graine, découplé du rendu.
- **Visualisation 3D** (Three.js) : entrepôt, opérateurs animés colorés selon
  leur état, traînées de déplacement (spaghetti), heatmap de fréquentation.
- **Deux profils de commandes** : B2C (nombreuses commandes courtes) et B2B
  (commandes longues, regroupées par client).
- **Stratégies de picking comparables** : commande par commande, vagues par
  zone — et une interface simple pour en ajouter.
- **PostgreSQL** : entrepôts, scénarios et runs (KPI + trajets agrégés)
  stockés pour consultation et comparaison dans le temps.
- **KPI en direct** : commandes/h, lignes/h, distance moyenne, taux
  d'occupation, temps de cycle, commandes en attente.

---

## Démarrage rapide (Docker)

Prérequis : Docker avec le plugin Compose.

```bash
docker compose up
```

Puis ouvrez **http://localhost:3000**. Au premier démarrage, les migrations
s'appliquent automatiquement et un entrepôt d'exemple (6 allées,
204 emplacements, 2 ateliers) est inséré avec deux scénarios.

## Mode développement (sans Docker pour l'application)

```bash
docker compose up db        # la base PostgreSQL seule (port 5432)
cp .env.example .env        # PORT et DATABASE_URL
npm install
npm run dev                 # serveur local avec rechargement (--watch)
```

Autres commandes utiles :

```bash
npm test                    # tests unitaires (runner natif de Node, sans base)
npm run sim                 # simulation en console (KPI, sans base ni 3D)
npm run sim data/scenario-waves.json   # autre scénario
```

## Déploiement Kubernetes (Helm)

Le chart est dans `helm/simsteps/`.

```bash
helm dependency build helm/simsteps     # récupère le sous-chart PostgreSQL Bitnami
helm install simsteps helm/simsteps
kubectl port-forward svc/simsteps 3000:80
```

Principales valeurs (`values.yaml`, documenté) :

| Clé | Rôle | Défaut |
|---|---|---|
| `image.repository`, `image.tag` | Image applicative (publiée sur Docker Hub) | `ppcm/simsteps:0.1.2` |
| `replicaCount`, `resources` | Dimensionnement | 1 replica |
| `ingress.enabled`, `ingress.host` | Ingress désactivable | `false` |
| `postgresql.enabled` | Sous-chart PostgreSQL Bitnami | `true` |
| `database.externalUrl` | Base externe (si sous-chart désactivé) | — |
| `database.existingSecret` | Secret existant contenant `DATABASE_URL` | — |
| `migrations.enabled` | Migrations via initContainer | `true` |

Exemple avec base externe :

```bash
helm install simsteps helm/simsteps \
  --set postgresql.enabled=false \
  --set database.externalUrl=postgres://user:motdepasse@pg.example.com:5432/simsteps
```

Les probes liveness/readiness interrogent `/health` ; les migrations sont
exécutées par un initContainer (`node db/migrate-cli.js`) avant chaque
démarrage de pod.

## Utilisation de l'interface

Le panneau latéral regroupe tout :

- **Lecture** : lecture/pause, vitesse x1/x10/x60, horloge simulée.
- **Scénario** : choix du scénario de base, curseurs opérateurs / mix B2C /
  cadence. Tout changement relance instantanément la simulation (elle
  s'exécute dans le navigateur en quelques millisecondes) ; la relecture
  repart de zéro.
- **Enregistrer ce run en base** : fige les paramètres courants, les KPI et
  les trajets agrégés côté serveur, pour comparaison ultérieure.
- **Affichage** : traînées de déplacement (une couleur par opérateur) et
  heatmap de fréquentation au sol.
- **Indicateurs en direct** : les KPI évoluent pendant la relecture.
- **Comparaison** : deux sources au choix (réglages actuels, scénarios,
  runs enregistrés) et tableau des écarts, colorés selon le sens de
  l'amélioration.

Couleurs des opérateurs : bleu = déplacement, ambre = prélèvement,
vert = dépose, gris = inactif.

## API REST

| Méthode et route | Rôle |
|---|---|
| `GET /health` | État du serveur et de la base |
| `GET/POST /api/warehouses`, `GET/PUT/DELETE /api/warehouses/:id` | CRUD entrepôts (import/export JSON direct) |
| `GET/POST /api/scenarios`, `GET/PUT/DELETE /api/scenarios/:id` | CRUD scénarios |
| `POST /api/runs` | Exécute une simulation côté serveur et l'enregistre — corps : `{"warehouseId": 1, "scenarioId": 1, "overrides": {"operators": 8}}` |
| `GET /api/runs?warehouseId=&scenarioId=` | Liste des runs (KPI inclus) |
| `GET /api/runs/:id` | Détail d'un run (avec trajets agrégés) |
| `DELETE /api/runs/:id` | Suppression |

## Décrire son propre entrepôt (JSON)

Un entrepôt est un document JSON (voir `data/warehouse-example.json`),
importable via `POST /api/warehouses`. La circulation est reconstruite en
graphe (nœuds de baie le long des allées, deux couloirs transversaux) et le
pathfinding des opérateurs utilise A* sur ce graphe.

```jsonc
{
  "name": "Mon entrepôt",
  "dimensions": { "width": 44, "depth": 42 },      // mètres au sol
  "corridors": { "frontY": 4, "backY": 38 },       // couloirs transversaux (y)
  "aisles": [
    // x : abscisse de l'allée ; yStart/yEnd : étendue ; bays : nb de baies ;
    // zone : groupe utilisé par la stratégie « vagues par zone »
    { "id": "A1", "x": 6, "yStart": 7, "yEnd": 35, "bays": 17, "zone": "Z1" }
  ],
  "racks": [
    // Un rack par côté d'allée ; levels : niveaux picking par baie.
    // Emplacements générés : R01-01-1 … R01-17-1 (rack-baie-niveau)
    { "id": "R01", "aisle": "A1", "side": "gauche", "levels": 1 },
    { "id": "R02", "aisle": "A1", "side": "droite", "levels": 1 }
  ],
  "workshops": [
    // Postes d'emballage : cibles de dépose des commandes B2C
    { "id": "AT1", "label": "Atelier emballage 1", "x": 9, "y": 2 }
  ],
  "shipping":  { "id": "EXP", "label": "Expédition", "x": 28, "y": 2 },
  "receiving": { "id": "REC", "label": "Réception", "x": 36, "y": 40 }
}
```

Règles : chaque rack référence une allée existante ; les ateliers, l'expédition
et la réception sont rattachés au couloir le plus proche ; les commandes B2B
sont déposées à l'expédition, les B2C à l'atelier le plus proche du dernier
prélèvement. L'API valide la cohérence topologique à l'import.

## Paramètres d'un scénario

Tous facultatifs (défauts entre parenthèses) — voir
`data/scenario-example.json` :

| Paramètre | Rôle |
|---|---|
| `seed` (1) | Graine du générateur aléatoire — même graine, même run |
| `durationHours` (2) | Durée simulée |
| `operators` (5) | Nombre d'opérateurs |
| `ordersPerHour` (30) | Cadence d'arrivée des commandes (processus de Poisson) |
| `b2cShare` (0.7) | Part de commandes B2C (0 à 1) |
| `strategy` (`orderByOrder`) | `orderByOrder` ou `zoneWave` |
| `waveSize` (20) | Taille max d'une vague (stratégie `zoneWave`) |
| `speedMps` (1.2) | Vitesse de marche (m/s) |
| `pickTimePerLineSec` (12) | Temps de prélèvement par ligne |
| `dropTimeSec` (20) | Temps de dépose |
| `b2bClients` (8) | Taille du portefeuille clients B2B |

## Ajouter une stratégie de picking

Les stratégies vivent dans `sim/strategies.js`. Une stratégie est un objet
`{ id, label, plan }` où `plan(orders, need, ctx)` renvoie au plus `need`
missions, chacune étant un tableau de lignes **en attente** (`state ===
'pending'`) ; le moteur marque les lignes, ordonne la tournée en serpentin et
gère les déposes.

```js
// 1. Définir la stratégie
export const shortestFirst = {
  id: 'shortestFirst',
  label: 'Commandes courtes d’abord',
  plan(orders, need) {
    return orders
      .filter((o) => o.lines.every((l) => l.state === 'pending'))
      .sort((a, b) => a.lines.length - b.lines.length)
      .slice(0, need)
      .map((o) => [...o.lines]);
  },
};

// 2. L'enregistrer
export const STRATEGIES = new Map([
  [orderByOrder.id, orderByOrder],
  [zoneWave.id, zoneWave],
  [shortestFirst.id, shortestFirst],   // ← ajout
]);
```

Elle devient immédiatement utilisable dans les scénarios
(`"strategy": "shortestFirst"`), via l'API et la CLI. Ajoutez un test dans
`tests/unit/sim/strategies.test.js`.

## Schéma des tables principales

| Table | Colonnes principales | Rôle |
|---|---|---|
| `warehouses` | `id`, `name`, `definition` (JSONB), `created_at`, `updated_at` | Définitions d'entrepôts (le JSON importable est stocké tel quel) |
| `scenarios` | `id`, `name`, `params` (JSONB), `created_at`, `updated_at` | Paramètres de simulation |
| `runs` | `id`, `warehouse_id` (FK), `scenario_id` (FK, nullable), `scenario_snapshot` (JSONB), `kpis` (JSONB), `traffic` (JSONB), `created_at` | Historique des runs : paramètres figés, KPI et trafic agrégé par arête |
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
data/     entrepôt et scénarios d'exemple (JSON)
helm/     chart Helm (Kubernetes)
tests/    tests unitaires (node --test), exécutables sans base
```

## Pistes d'évolution

1. **Import de données depuis un WMS** : convertisseur CSV/API vers le format
   `warehouse.json` et génération des commandes depuis l'historique réel.
2. **Contraintes de croisement dans les allées étroites** : arêtes à capacité
   limitée dans le graphe, files d'attente et détours — les congestions
   deviendraient visibles dans la heatmap.
3. **Chariots et caristes** : second type d'agent (vitesse, gabarit et règles
   de priorité propres), missions de réapprovisionnement des emplacements
   picking depuis la réception.
