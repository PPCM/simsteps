# Prompt pour Claude Code — SimSteps, simulateur de flux d'entrepôt 3D

Copie le texte ci-dessous tel quel dans Claude Code.

---

Développe **SimSteps**, un simulateur de flux d'entrepôt visualisable en 3D dans un navigateur. Je suis logisticien : je veux modéliser les déplacements de mes opérateurs de préparation (picking) dans les allées, au niveau des racks, et vers les ateliers, pour une clientèle mixte B2B et B2C, afin d'identifier les goulets d'étranglement et comparer des scénarios d'organisation.

## Identité du projet

- Nom du projet : **SimSteps** (domaines réservés : simsteps.com / simsteps.net).
- Nom du package npm : `simsteps`. Utilise ce nom pour le dossier racine et le `package.json`.
- Affiche le nom « SimSteps » dans l'interface (en-tête de la page, titre de l'onglet) et dans le README. Crée un petit logo texte sobre (pas d'image nécessaire).

## Stack technique imposée

- **Backend : Node.js** (Express ou Fastify) servant le frontend et exposant une API REST simple.
- **Base de données : PostgreSQL** — stocke les entrepôts, les scénarios, les runs de simulation et leurs résultats (KPI, trajets agrégés) pour comparer des runs dans le temps. Accès via `pg` ou un ORM léger (Drizzle ou Knex). Migrations SQL versionnées, lancées automatiquement au démarrage. Import/export JSON conservé pour échanger des entrepôts et scénarios.
- **Frontend : navigateur**, une seule page. **Three.js** pour la 3D. Pas de framework lourd obligatoire (vanilla JS ou Vite + modules ES acceptés).
- **Déploiement : Docker** — fournis un `Dockerfile` (build multi-étapes, image finale légère) et un `docker-compose.yml` avec 2 services : `app` (Node.js) et `db` (PostgreSQL 16) avec volume persistant et healthcheck ; l'app attend que la base soit prête. Configuration par variables d'environnement (`.env.example` fourni : port, DATABASE_URL).
- **Déploiement Kubernetes : chart Helm** — fournis un chart dans `helm/simsteps/` : Deployment + Service + Ingress (désactivable) pour l'app, PostgreSQL soit via sous-chart Bitnami (dépendance optionnelle), soit via `DATABASE_URL` externe fournie en valeur. `values.yaml` documenté (image, tag, ressources, replicas, ingress, base de données), secrets via `Secret` Kubernetes, probes liveness/readiness sur un endpoint `/health`, et exécution des migrations via initContainer ou hook Helm. Le chart doit passer `helm lint` et un `helm template` sans erreur.
- Démarrage en 1 commande : `docker compose up`, puis ouverture sur `http://localhost:3000`. Conserve aussi un mode développement sans Docker (`npm install` + `npm run dev` avec une base locale ou le conteneur db seul).

## Modèle de l'entrepôt (configurable)

- L'entrepôt est décrit dans un format JSON documenté (`warehouse.json`, importable/exportable via l'API et stocké en base) : dimensions au sol, allées, racks (position, niveaux, emplacements picking), zones de réception/expédition, **ateliers** (postes d'emballage/travail), points de dépose. Un entrepôt d'exemple est inséré en base au premier démarrage (seed).
- Représente la circulation comme un **graphe** : nœuds (intersections d'allées, emplacements, ateliers) et arêtes (segments de circulation avec sens autorisé et largeur). Le pathfinding des opérateurs utilise A* sur ce graphe.
- Fournis un entrepôt d'exemple réaliste : ~6 allées, ~200 emplacements picking, 2 ateliers, 1 zone expédition.

## Moteur de simulation

- **Simulation à événements discrets** (horloge simulée, file d'événements), découplée du rendu : la simulation peut tourner plus vite que le temps réel (x1, x10, x60).
- **Commandes** générées selon deux profils paramétrables :
  - **B2C** : beaucoup de commandes, 1 à 3 lignes, petites quantités.
  - **B2B** : moins de commandes, 10 à 50 lignes, grosses quantités, contraintes de regroupement par client.
- **Opérateurs** (nombre paramétrable) : agents qui prennent une mission de picking, se déplacent sur le graphe à vitesse réaliste (~1,2 m/s à pied), prélèvent (temps de prélèvement paramétrable par ligne), déposent à l'atelier ou en expédition. Gère l'affectation des missions (au plus proche, ou par zone).
- **Stratégies de picking comparables** (au moins 2) : commande par commande vs. vagues/regroupement par zone. L'objectif est de comparer les scénarios.
- Paramètres regroupés dans un **scénario** (stocké en base, importable/exportable en JSON) : nombre d'opérateurs, mix B2B/B2C, cadence de commandes, stratégie, vitesses, temps de prélèvement. Chaque **run** de simulation est enregistré en base avec son scénario et ses KPI pour consultation et comparaison ultérieures.

## Visualisation 3D

- Vue 3D de l'entrepôt : sol, racks en volumes simples, allées, ateliers et zones colorés et étiquetés. Caméra orbitale (rotation, zoom, pan) — utilise OrbitControls.
- **Animation fluide des opérateurs** (petites figurines ou capsules colorées) se déplaçant le long de leurs chemins, avec interpolation entre les ticks de simulation.
- **Traînées de déplacement** activables (diagramme spaghetti 3D) et **heatmap au sol** de la fréquentation des allées, pour repérer les zones de congestion.
- Couleur des opérateurs selon leur état : en déplacement, en prélèvement, en dépose, inactif.

## Interface utilisateur — simple avant tout

- Panneau latéral épuré : boutons Lecture/Pause/Vitesse, sélection du scénario, curseurs pour les paramètres principaux (opérateurs, mix B2B/B2C, cadence), interrupteurs spaghetti/heatmap.
- **Tableau de bord des KPI** en direct : commandes traitées/h, lignes prélevées/h, distance moyenne parcourue par opérateur, taux d'occupation des opérateurs, temps moyen de cycle d'une commande, commandes en attente.
- Un mode **comparaison** : lancer deux scénarios et afficher leurs KPI côte à côte.
- Design soigné et moderne : thème sombre, typographie lisible, animations discrètes, l'esthétique compte. Tout doit être compréhensible sans documentation par un non-développeur.

## Qualité et structure

- Code modulaire : `sim/` (moteur, indépendant du DOM et de la base, testable), `web/` (rendu 3D + UI), `server/` (API + accès PostgreSQL), `db/` (migrations, seed), `data/` (exemples JSON d'entrepôt et de scénario).
- Quelques tests unitaires sur le moteur (pathfinding, file d'événements, génération de commandes) avec le runner de test natif de Node — exécutables sans base de données.
- README en français, titré « SimSteps » : installation (Docker, Helm/Kubernetes et mode dev), utilisation, comment décrire son propre entrepôt en JSON, comment ajouter une stratégie de picking, schéma des tables principales.
- Commente le code en français.

## Étapes de livraison

Procède dans cet ordre et vérifie chaque étape avant de passer à la suivante :

1. Moteur de simulation seul (sans 3D ni base) avec tests + export des KPI en console.
2. API + PostgreSQL (migrations, seed, CRUD entrepôts/scénarios, enregistrement des runs) + docker-compose fonctionnel.
3. Rendu 3D statique de l'entrepôt d'exemple.
4. Animation des opérateurs branchée sur le moteur.
5. UI, KPI temps réel, spaghetti/heatmap, mode comparaison (y compris entre runs enregistrés en base).
6. Chart Helm (lint + template validés).
7. Polish du design + README + vérification du build Docker de bout en bout.

À la fin, montre-moi comment lancer le projet et propose 3 pistes d'évolution (import de données depuis un WMS, contraintes de croisement dans les allées étroites, chariots/caristes).
