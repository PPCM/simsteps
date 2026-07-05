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
npm run test:ui             # tests UI Playwright (navigateur réel contre la pile
                            # Docker ; la démarre si besoin, prérequis :
                            # npx playwright install chromium)
npm run sim                 # simulation en console (KPI, sans base ni 3D)
npm run sim data/scenario-waves.json   # autre scénario
```

Les tests UI travaillent sur des entrepôts et projets jetables (noms
suffixés `[test …]`, nettoyés après chaque test) : les données réelles de
la base ne sont pas touchées.

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
| `image.repository`, `image.tag` | Image applicative (publiée sur Docker Hub) | `ppcm/simsteps:0.4.1` |
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

L'interface s'organise en deux fenêtres flottantes, déplaçables par leur
barre de titre et rétractables d'un clic sur le chevron (position, repli
et onglet actif sont mémorisés par le navigateur) :

- la **fenêtre principale** porte la Lecture, toujours visible, et deux
  onglets : **Piloter** (scénario, curseurs, affichage, enregistrement
  du run) et **Configurer** (projet, entrepôt, éditeur 3D — un point
  ambre sur l'onglet signale une édition en cours). Repliée, sa barre
  de titre conserve lecture/pause et l'horloge simulée.
- la **fenêtre Indicateurs** porte les KPI en direct et la comparaison.
  Repliée, sa barre de titre affiche les deux KPI clés (commandes/h et
  occupation), mis à jour en continu.

Le détail des sections :

- **Lecture** : lecture/pause, vitesse x1/x10/x60, horloge simulée.
- **Projet** : un projet regroupe un entrepôt, un scénario et des
  paramétrages (n'importe quel paramètre de scénario peut être surchargé,
  y compris ceux sans curseur comme la stratégie). Sélectionner un projet
  applique le tout d'un coup ; « Créer » enregistre les réglages courants
  sous le nom saisi, « Mettre à jour » et « Supprimer » gèrent le projet
  actif. Pas de versionnage : le projet référence l'entrepôt et le
  scénario vivants.
- **Entrepôt** : choix de l'entrepôt affiché, création (modèle minimal),
  duplication et suppression (les runs et projets associés sont supprimés
  avec l'entrepôt). « Éditer » met la simulation en pause et ouvre une
  fenêtre d'édition dédiée en bas de l'écran (flottante et rétractable
  comme les autres), aux propriétés disposées horizontalement : cliquer
  un élément dans la scène (allée, atelier, expédition, réception) le
  sélectionne, glisser le déplace par pas d'un mètre — le bord
  gauche/avant de l'élément s'aligne sur le carroyage au sol, un élément
  de dimensions entières remplit donc des carreaux entiers, et les
  champs x/y des zones expriment ces bords (valeurs entières après
  accrochage) — dans les limites du plan et des couloirs ; les couloirs
  avant et arrière se glissent aussi à la souris (axe y, entre le bord
  du sol et le débouché des allées) ; la fenêtre expose les propriétés de la sélection
  (baies, zone, identifiants, largeur/profondeur — chaque élément est
  redimensionnable), les propriétés globales (nom, dimensions), et
  l'ajout/la suppression d'allées, d'ateliers, de zones d'expédition ou
  de réception et de couloirs (au moins un couloir et une zone de
  chaque type doivent rester). Les couloirs sont des objets à part
  entière : position, longueur, largeur et orientation
  (horizontal/vertical, menu déroulant) modifiables, connexion
  automatique aux croisements — de quoi dessiner de vrais chemins de
  circulation entre les zones.
  « Enregistrer » valide et persiste la définition (modification en
  place : tous les projets qui référencent l'entrepôt la voient),
  Les racks se règlent depuis le panneau de leur allée (niveaux, hauteur
  de niveau, profondeur — appliqués aux deux côtés) ; la hauteur sous
  plafond, dans les propriétés globales, borne leur élévation.
  « Annuler » restaure l'état d'entrée. Limites assumées : pas
  d'annulation fine, pas de redimensionnement à la souris, racks dérivés
  des allées (deux racks gauche/droite).
- **Scénario** : choix du scénario de base, curseurs opérateurs à pied /
  mix B2C / cadence, et compteurs d'engins de manutention (transpalette,
  gerbeur, frontal, rétractable, VNA, préparateur — l'infobulle rappelle
  gabarit d'allée et hauteur de levée de chacun ; les engins sont rendus
  en 3D à leur gabarit). Tout changement relance instantanément la
  simulation (elle s'exécute dans le navigateur en quelques
  millisecondes) ; la relecture repart de zéro.
- **Enregistrer ce run en base** : fige les paramètres courants, les KPI et
  les trajets agrégés côté serveur, pour comparaison ultérieure.
- **Affichage** : traînées de déplacement (une couleur par opérateur),
  heatmap de fréquentation au sol, et masquage des libellés 3D — quand
  ils sont masqués, un clic sur un élément (allée, atelier, zone,
  couloir) révèle le sien, un clic dans le vide le cache.
- **Indicateurs en direct** : les KPI évoluent pendant la relecture.
- **Comparaison** : deux sources au choix (réglages actuels, scénarios,
  runs enregistrés) et tableau des écarts, colorés selon le sens de
  l'amélioration. Avec un projet actif, seuls les runs du projet sont
  proposés ; sinon, ceux de l'entrepôt affiché.

Couleurs des opérateurs : bleu = déplacement, ambre = prélèvement,
vert = dépose, gris = inactif.

## API REST

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

## Décrire son propre entrepôt (JSON)

Un entrepôt est un document JSON (voir `data/warehouse-example.json`),
importable via `POST /api/warehouses`. La circulation est reconstruite en
graphe (nœuds de baie le long des allées, deux couloirs transversaux) et le
pathfinding des opérateurs utilise A* sur ce graphe.

```jsonc
{
  "name": "Mon entrepôt",
  // height (facultatif) : hauteur sous plafond, borne la hauteur des racks
  "dimensions": { "width": 44, "depth": 42 },      // mètres au sol
  // Réseau de couloirs : segments horizontaux (le long de x) ou
  // verticaux (le long de y), partant de (x, y) sur `length` mètres.
  // Deux couloirs qui se croisent ou se touchent sont connectés.
  // Format historique accepté : { "frontY": 4, "backY": 38 } (deux
  // couloirs transversaux pleine largeur).
  "corridors": [
    { "id": "C1", "label": "Couloir avant", "x": 0, "y": 4, "length": 44, "orientation": "horizontal" },
    { "id": "C2", "label": "Couloir arrière", "x": 0, "y": 38, "length": 44, "orientation": "horizontal" }
  ],
  "aisles": [
    // x : abscisse de l'allée ; yStart/yEnd : étendue ; bays : nb de baies ;
    // zone : groupe utilisé par la stratégie « vagues par zone » ;
    // width (facultatif, 1.4) : largeur du couloir entre les deux racks
    { "id": "A1", "x": 6, "yStart": 7, "yEnd": 35, "bays": 17, "zone": "Z1", "width": 1.4 }
  ],
  "racks": [
    // Un rack par côté d'allée ; levels : niveaux de stockage par baie ;
    // levelHeight (facultatif, 2 m) : hauteur d'un niveau ; depth
    // (facultatif, 1.4 m) : profondeur du rack perpendiculaire à l'allée.
    // Emplacements générés : R01-01-1 … R01-17-1 (rack-baie-niveau) ;
    // prélever en hauteur coûte liftTimePerLevelSec par niveau au-delà
    // du premier.
    { "id": "R01", "aisle": "A1", "side": "gauche", "levels": 1 },
    { "id": "R02", "aisle": "A1", "side": "droite", "levels": 1 }
  ],
  "workshops": [
    // Postes d'emballage : cibles de dépose des commandes B2C.
    // width/depth (facultatifs, 4.8 × 3) : emprise au sol en mètres
    { "id": "AT1", "label": "Atelier emballage 1", "x": 9, "y": 2 }
  ],
  // Une zone unique (objet) ou une liste de zones ; mêmes width/depth
  // facultatifs que les ateliers
  "shipping":  [{ "id": "EXP", "label": "Expédition", "x": 28, "y": 2 }],
  "receiving": [{ "id": "REC", "label": "Réception", "x": 36, "y": 40 }]
}
```

Règles : chaque rack référence une allée existante ; chaque allée doit
déboucher sur au moins un couloir horizontal au-delà d'une de ses
extrémités (les impasses sont autorisées) ; les ateliers, les zones
d'expédition et de réception sont raccordés par projection sur le
couloir le plus proche ; l'ensemble du réseau de circulation doit être
connexe (un couloir isolé ou une zone inaccessible est refusé avec un
message explicite). Les commandes B2B sont déposées à la zone
d'expédition la plus proche du dernier prélèvement, les B2C à l'atelier
le plus proche. Il faut au moins un couloir, une zone d'expédition et
une de réception (`shipping`/`receiving` acceptent un objet unique —
format historique — ou une liste). L'API valide la cohérence
topologique à l'import.

## Paramètres d'un scénario

Tous facultatifs (défauts entre parenthèses) — voir
`data/scenario-example.json` :

| Paramètre | Rôle |
|---|---|
| `seed` (1) | Graine du générateur aléatoire — même graine, même run |
| `durationHours` (2) | Durée simulée |
| `operators` (5) | Nombre d'opérateurs à pied (rétro-compatibilité) |
| `fleet` (—) | Composition de flotte `{ type: nombre }` — types : `pieton`, `transpalette`, `gerbeur`, `frontal`, `retractable`, `vna`, `preparateur` ; prime sur `operators`. Chaque engin a ses vitesses à vide et en charge, sa hauteur de levée (borne les niveaux de rack accessibles) et son gabarit d'allée minimal — le routage n'emprunte que les voies assez larges : élargissez allées et couloirs en conséquence, sinon l'engin reste à quai et les lignes hors d'atteinte restent en attente |
| `ordersPerHour` (30) | Cadence d'arrivée des commandes (processus de Poisson) |
| `b2cShare` (0.7) | Part de commandes B2C (0 à 1) |
| `strategy` (`orderByOrder`) | `orderByOrder` ou `zoneWave` |
| `slotting` (`aleatoire`) | Placement des classes de rotation ABC : `aleatoire` (rotations dispersées) ou `abc` (20 % de références « A » — 80 % des lignes — au plus près de l'expédition). À comparer via le KPI « Distance / ligne » |
| `waveSize` (20) | Taille max d'une vague (stratégie `zoneWave`) |
| `speedMps` (1.2) | Vitesse de marche (m/s) |
| `pickTimePerLineSec` (12) | Temps de prélèvement par ligne |
| `liftTimePerLevelSec` (6) | Surcoût d'élévation par niveau de rack au-delà du premier |
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
data/     entrepôt et scénarios d'exemple (JSON)
helm/     chart Helm (Kubernetes)
tests/    tests unitaires (node --test, sans base) et tests UI Playwright (tests/ui/)
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
