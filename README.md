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

## Démarrage rapide (Docker)

Prérequis : Docker avec le plugin Compose.

```bash
docker compose up
```

L'application est tirée de **Docker Hub** (image multi-arch
[`ppcm/simsteps`](https://hub.docker.com/r/ppcm/simsteps)) : aucune
compilation locale. Puis ouvrez **http://localhost:3000**. Au premier
démarrage, les migrations s'appliquent automatiquement et trois projets
de démonstration sont insérés : « Piétons » (préparation à pied
classique en vagues par zone, 204 emplacements), « Flux complet »
(entrepôt mixte de 832 emplacements — palettier, allées VNA, réserve en
hauteur, camions, emballeurs — avec sa flotte de sept types d'agents
conduits, du piéton au VNA, sans engin automatisé) et « Robots
mobiles » (site automatisé parcouru par des AMR avec station de charge
et convoyeur).
L'entrepôt d'exemple historique reste disponible en gabarit dans
`data/warehouse-example.json` (CLI et tests).

## Documentation

| Document | Contenu |
|---|---|
| [Guide Utilisateur](doc/guide-utilisateur.md) | L'interface : lecture, projets, scénarios, atelier d'édition d'entrepôt, indicateurs, comparaison, couleurs d'état et congestion |
| [Guide Développeur](doc/guide-developpeur.md) | Mode développement, pile Docker locale, commandes et tests, schéma des tables, structure du projet |
| [API REST](doc/api-rest.md) | Les routes de l'API et leurs corps de requête |
| [Personnalisation](doc/personnalisation.md) | Décrire son entrepôt en JSON, paramètres de scénario, ajouter une stratégie de picking |

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
| `image.repository`, `image.tag` | Image applicative (publiée sur Docker Hub) | `ppcm/simsteps:0.8.0` |
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
