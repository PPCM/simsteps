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
- **Historique et comparaison** : entrepôts, scénarios et runs (KPI +
  trajets agrégés) conservés pour consultation et comparaison dans le temps.
- **KPI en direct** : commandes/h, lignes/h, distance moyenne, taux
  d'occupation, temps de cycle, commandes en attente.

---

## Documentation

| Document | Contenu |
|---|---|
| [Guide Utilisateur](doc/guide-utilisateur.md) | L'interface : lecture, projets, scénarios, atelier d'édition d'entrepôt, indicateurs, comparaison, couleurs d'état et congestion |
| [Guide Développeur](doc/guide-developpeur.md) | Mode développement, pile Docker locale, chart Helm, commandes et tests, schéma des tables, structure du projet |
| [API REST](doc/api-rest.md) | Les routes de l'API et leurs corps de requête |
| [Personnalisation](doc/personnalisation.md) | Décrire son entrepôt en JSON, paramètres de scénario, ajouter une stratégie de picking |

## Démarrage rapide (Docker)

Prérequis : Docker avec le plugin Compose. Seul le fichier
`docker-compose.yml` est nécessaire — l'application est tirée de
**Docker Hub** (image multi-arch
[`ppcm/simsteps`](https://hub.docker.com/r/ppcm/simsteps)), aucune
compilation locale :

```bash
curl -O https://raw.githubusercontent.com/PPCM/simsteps/main/docker-compose.yml
docker compose up
```

Puis ouvrez **http://localhost:3000**. Au premier démarrage, les migrations
s'appliquent automatiquement et trois projets de démonstration sont
insérés : « Piétons » (préparation à pied classique en vagues par
zone, 204 emplacements), « Flux complet » (entrepôt mixte de 832
emplacements — palettier, allées VNA, réserve en hauteur, camions,
emballeurs — avec sa flotte de sept types d'agents conduits, du piéton
au VNA, sans engin automatisé) et « Robots mobiles » (site automatisé
parcouru par des AMR avec station de charge et convoyeur).
Les fichiers de démonstration (entrepôts et scénarios JSON) sont
livrés dans `demo/` et copiés au premier démarrage dans le dossier de
travail persistant `data/` (voir la persistance ci-dessous).

## Configuration et persistance

Variables d'environnement de l'application (toutes facultatives) :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur — dans `docker-compose.yml`, pilote aussi le port publié sur la machine hôte |
| `DATABASE_URL` | `postgres://simsteps:simsteps@localhost:5432/simsteps` | Chaîne de connexion PostgreSQL (fournie automatiquement par Compose et par le chart Helm) |
| `NODE_ENV` | `development` | En `production` : journaux JSON structurés (sinon sortie lisible en console) |

Persistance des données :

| Données | Docker Compose | Kubernetes (Helm) |
|---|---|---|
| **Base** — entrepôts, scénarios, projets, runs | Volume nommé `pgdata` : survit aux redémarrages et aux mises à jour d'image (`docker compose pull`) | PersistentVolumeClaim du sous-chart PostgreSQL Bitnami (persistance activée par défaut, valeurs `postgresql.*`) ; avec une base externe, la persistance relève de cette base |
| **Fichiers `data/`** — copies des démonstrations et vos propres fichiers JSON | Volume nommé `appdata` monté sur `/app/data` : vos ajouts et modifications survivent | Non persistant par défaut : les démos manquantes sont recopiées depuis `demo/` à chaque démarrage de pod (les vraies données vivent en base) |

Le dossier `data/` est le **dossier de travail** : au premier démarrage,
l'application y copie les fichiers de démonstration depuis `demo/`
(livré avec l'application) **sans jamais écraser un fichier existant**
— vous pouvez donc modifier vos copies ou y déposer vos propres JSON.
Pour restaurer une démonstration d'origine :

```bash
docker compose exec app cp demo/warehouse-flux.json data/
```

Pour repartir entièrement de zéro (base et fichiers — les
démonstrations sont réinsérées au démarrage suivant) :
`docker compose down -v`.

## Déploiement Kubernetes (Helm)

Le chart n'est pas encore publié sur un registre : récupérez-le depuis
le dépôt (aucune compilation — le chart déploie l'image publiée sur
Docker Hub) puis installez-le, les dépendances se téléchargent seules
avec `--dependency-update` :

```bash
git clone --depth 1 https://github.com/PPCM/simsteps.git
helm install simsteps simsteps/helm/simsteps --dependency-update
kubectl port-forward svc/simsteps 3000:80
```

Principales valeurs (`values.yaml`, documenté) :

| Clé | Rôle | Défaut |
|---|---|---|
| `image.repository`, `image.tag` | Image applicative (publiée sur Docker Hub) | `ppcm/simsteps:0.8.0` |
| `replicaCount`, `resources` | Dimensionnement | 1 replica |
| `ingress.enabled`, `ingress.host` | Ingress désactivable | `false` |
| `postgresql.enabled` | Sous-chart PostgreSQL Bitnami | `true` |
| `database.externalUrl` | Base externe (si sous-chart désactivé) | — |
| `database.existingSecret` | Secret existant contenant `DATABASE_URL` | — |
| `migrations.enabled` | Migrations via initContainer | `true` |

Exemple avec base externe :

```bash
helm install simsteps simsteps/helm/simsteps --dependency-update \
  --set postgresql.enabled=false \
  --set database.externalUrl=postgres://user:motdepasse@pg.example.com:5432/simsteps
```

Les probes liveness/readiness interrogent `/health` ; les migrations sont
exécutées par un initContainer (`node db/migrate-cli.js`) avant chaque
démarrage de pod.
