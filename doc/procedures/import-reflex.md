# Importer des données Reflex WMS dans SimSteps

Procédure pour construire un entrepôt et un scénario SimSteps à partir des
données réelles d'un site géré sous Reflex WMS (Hardis Group) : quelles
données extraire de Reflex, comment les extraire, comment les transformer
au format SimSteps, puis comment les importer et recaler la simulation.

## Principe et limites

SimSteps ne lit pas les fichiers Reflex directement. « Importer des données
Reflex » consiste à produire **deux documents JSON** :

1. **Un entrepôt** (topologie physique : couloirs, allées, racks, zones) —
   importé via `POST /api/warehouses` (format détaillé dans
   [personnalisation](personnalisation.md)) ;
2. **Un scénario** (paramètres de flux : cadence de commandes, part B2C,
   effectifs, temps de prélèvement…) — importé via `POST /api/scenarios`.

Deux limites à garder en tête avant de commencer :

- **SimSteps génère lui-même les commandes** (processus de Poisson piloté
  par la graine `seed`) : on ne rejoue pas les commandes réelles de Reflex,
  on **calibre les paramètres** (`ordersPerHour`, `b2cShare`, `b2bClients`,
  temps de prélèvement…) pour que le profil simulé reproduise
  statistiquement l'historique.
- **La topologie est agrégée** : SimSteps modélise des allées, des racks,
  des baies et des niveaux — pas chaque adresse Reflex individuellement.
  Le référentiel d'emplacements sert à compter (travées, niveaux, zones),
  pas à recopier adresse par adresse.
- **Reflex ne contient pas les cotes du bâtiment** : les positions
  métriques (`x`, `y`, largeurs d'allées et de couloirs) viennent du plan
  du site (DWG/PDF coté), pas du WMS.

## Prérequis

- Un accès Reflex avec droits de consultation et d'export — ou l'appui de
  l'administrateur Reflex / de la DSI pour les extractions ;
- Le plan du bâtiment coté en mètres (implantation des allées, couloirs,
  quais, postes d'emballage) ;
- Le choix d'une **période représentative** de l'activité (2 à 4 semaines
  hors pics saisonniers et hors incidents), notée « période P » ci-dessous.

## Étape 1 — Extraire les données de Reflex

### Voies d'extraction (par ordre de préférence)

1. **Exports CSV/Excel des écrans de consultation** du client web Reflex :
   la plupart des listes (emplacements, commandes, mouvements, réceptions)
   disposent d'un bouton d'export ;
2. **Infocentre / requêteur / éditions personnalisées** si le site en
   dispose (ou le BI de l'entreprise alimenté par Reflex) ;
3. **Requête SQL par la DSI** sur la base Reflex, ou réutilisation des
   **fichiers d'interface** hôte ↔ Reflex existants (commandes, articles,
   mouvements) qui contiennent déjà l'essentiel.

Les noms exacts d'écrans et de tables varient selon la version et le
paramétrage du site : les cinq extractions ci-dessous décrivent les
**données** à obtenir (toutes existent dans tout Reflex), à traduire avec
l'administrateur du site. Format cible : CSV, une ligne par enregistrement.

### Extraction A — Référentiel des emplacements (topologie)

Une ligne par adresse de stockage active. Colonnes :

| Colonne | Usage SimSteps |
|---|---|
| Code emplacement (adresse) | Contrôle de complétude |
| Allée | Une entrée `aisles[]` par allée distincte |
| Travée / colonne | `bays` = nombre de travées distinctes de l'allée |
| Niveau | `levels` du rack = niveau max de l'allée |
| Zone (magasin / zone Reflex) | `zone` de l'allée (utilisée par la stratégie `zoneWave`) |
| Type d'emplacement (picking / réserve) | Vérifie l'hypothèse SimSteps « picking au niveau 1, réserve au-dessus » (mode `replenishment`) |
| Côté (pair/impair ou gauche/droite, si codé) | Répartition des racks `gauche`/`droite` |

### Extraction B — Historique des commandes (période P)

**En-têtes** : n° de commande, code client, type de flux (B2B / B2C /
e-commerce selon la typologie du site), date et heure de création (ou de
lancement en vague).
**Lignes** : n° de commande, article, quantité, emplacement de prélèvement.

Sert à calculer `ordersPerHour`, `b2cShare`, `b2bClients` et à vérifier le
profil (lignes par commande) — voir l'étape 3.

### Extraction C — Historique des missions / mouvements de préparation (période P)

Une ligne par mouvement de prélèvement : horodatage (début/fin ou
validation), opérateur, type de mission (picking / réapprovisionnement /
rangement), emplacement d'origine, destination, n° de mission ou de vague.

Sert à calculer le temps par ligne (`pickTimePerLineSec`), l'effectif
simultané réel (`operators` / `fleet`) et la taille des vagues (`waveSize`).

### Extraction D — Historique des réceptions (période P)

Une ligne par réception : date, nombre de supports/palettes reçus
(idéalement par camion ou par annonce/ASN).

Sert à `inboundTrucksPerDay` et `palletsPerTruck` — uniquement si vous
activez le module flux (`replenishment`).

### Extraction E — Paramétrage picking / réapprovisionnement (facultatif)

Auprès de l'administrateur Reflex : capacité des emplacements picking (en
UVC), seuil de déclenchement du réapprovisionnement, classes de rotation
ABC des articles et règle de slotting appliquée.

Sert à `slotCapacityUnits`, `replenishThresholdShare` et `slotting`.

## Étape 2 — Construire le JSON d'entrepôt

Partez de `demo/warehouse-example.json` (simple) ou
`demo/warehouse-flux.json` (complet : couloirs multiples, voies réservées,
tampons, parkings, convoyeur) et du format documenté dans
[personnalisation](personnalisation.md).

### 2.1 Depuis l'extraction A (agrégation par allée)

Pour chaque allée Reflex :

- `bays` = nombre de travées distinctes ;
- `levels` (des deux racks de l'allée) = niveau maximum observé ;
- `zone` = zone Reflex (regroupement utilisé par les vagues par zone) ;
- un rack `gauche` et un rack `droite` par allée (SimSteps impose un rack
  par côté ; si une allée Reflex ne sert qu'un côté, gardez les deux racks
  et ignorez l'écart, ou fusionnez deux allées adossées).

Exemple : les adresses `A05-01-1` … `A05-17-3` (allée A05, travées 01 à 17,
niveaux 1 à 3) deviennent :

```json
{ "id": "A05", "x": 26, "yStart": 7, "yEnd": 35, "bays": 17, "zone": "PICKING" }
```

avec deux racks `{ "levels": 3, "levelHeight": 2.2, "depth": 1.4 }`.

### 2.2 Depuis le plan du bâtiment (cotes en mètres)

Le plan fournit tout ce que Reflex n'a pas :

- `dimensions` : `width` × `depth` du sol (et `height` si vous voulez
  borner la hauteur des racks) ;
- pour chaque allée : `x` (abscisse de l'axe de circulation de l'allée),
  `yStart`/`yEnd` (étendue des racks), `width` (largeur praticable entre
  les deux racks — déterminante pour le gabarit des engins) ;
- `corridors` : les couloirs de circulation (segments horizontaux ou
  verticaux, largeur `width` ; `access: "pietons"|"engins"` pour les voies
  réservées, `oneWay` pour les sens uniques) ;
- `receiving` : les quais de réception ; `shipping` : la zone d'expédition ;
  `workshops` : les postes d'emballage ; et le cas échéant `buffers`
  (zones tampon), `parkings` (remisage des engins), `obstacles` (poteaux),
  `conveyors`.

Conventions : coordonnées en mètres, origine au coin du bâtiment, `x` en
largeur et `y` en profondeur ; pour les racks, `levelHeight` = hauteur d'un
niveau, `depth` = profondeur du rack.

### 2.3 Règles de validation à anticiper

L'API (et le moteur) refusent avec un message en français explicite :

- moins d'un couloir, d'une zone d'expédition ou d'une zone de réception ;
- une allée qui ne débouche sur aucun couloir horizontal ;
- un réseau de circulation non connexe (couloir isolé, zone inaccessible,
  sens uniques sans retour possible) ;
- `bays` < 2 ; une emprise qui dépasse le sol ; des racks plus hauts que
  `dimensions.height`.

Astuce : après l'import, le **mode édition 3D** de l'interface permet
d'ajuster visuellement positions et dimensions (accrochage au mètre,
validation en direct dans la barre d'état) — inutile de viser le
centimètre dans le JSON initial.

## Étape 3 — Calibrer le scénario

Partez de `demo/scenario-example.json` (ou `demo/scenario-flux.json` pour
le module flux). Chaque paramètre se calcule depuis les extractions :

| Paramètre SimSteps | Source Reflex | Formule |
|---|---|---|
| `durationHours` | — | Durée à étudier (ex. un poste = 7 à 8 h) |
| `operators` / `fleet` | Extraction C + parc réel | Nombre moyen d'opérateurs **simultanés** (opérateurs distincts actifs par heure, pas l'effectif inscrit) ; `fleet` reflète le parc d'engins réel (`pieton`, `transpalette`, `gerbeur`, `frontal`, `retractable`, `vna`, `preparateur`, `agv`, `amr`) |
| `ordersPerHour` | Extraction B | Nombre de commandes de la période ÷ heures **ouvrées** de la période |
| `b2cShare` | Extraction B | Commandes B2C ÷ total (d'après le type de flux) |
| `b2bClients` | Extraction B | Nombre de clients B2B distincts actifs sur la période |
| `strategy` | Organisation du site | `zoneWave` si Reflex lance des vagues par zone, sinon `orderByOrder` |
| `waveSize` | Extraction C | Taille moyenne des vagues (lignes ou commandes par vague) |
| `pickTimePerLineSec` | Extraction C | Médiane du temps entre deux validations de prélèvement **consécutives d'une même mission** (la médiane écarte les trajets longs et les pauses) ; à défaut, garder 12 s et recaler à l'étape 5 |
| `liftTimePerLevelSec` | — | Mesure terrain ou défaut (6 s) — ne concerne que les prélèvements au-dessus du niveau 1 |
| `dropTimeSec` | Extraction C | Temps de dépose observé à l'expédition/atelier ; à défaut 20 s |
| `speedMps` | — | Vitesse de marche : mesure terrain ou standard (1,2 m/s) |
| `slotting` | Extraction E | `abc` si le site pratique un slotting par rotation, sinon `aleatoire` |
| `replenishment` | Extraction E | `true` pour simuler le stock fini picking/réserve |
| `slotCapacityUnits` | Extraction E | Capacité d'un emplacement picking (UVC) ≈ contenu d'une palette |
| `replenishThresholdShare` | Extraction E | Seuil de réappro Reflex ÷ capacité de l'emplacement |
| `inboundTrucksPerDay` | Extraction D | Camions (ou annonces) reçus par jour ouvré |
| `palletsPerTruck` | Extraction D | Palettes moyennes par camion |
| `packers` / `packTimePerOrderSec` | Organisation du site | Emballeurs dédiés (exige des zones `buffers` dans l'entrepôt) |
| `seed` | — | Valeur libre mais **fixe** : même graine = même run (comparaisons reproductibles) |

Contrôle de cohérence utile (extraction B) : le nombre moyen de lignes par
commande B2C et B2B. SimSteps génère ses propres profils de commandes — si
votre réel s'en écarte fortement, l'écart se verra à l'étape 5 et se
compense sur `ordersPerHour` (raisonner en **lignes/heure** plutôt qu'en
commandes/heure).

## Étape 4 — Importer dans SimSteps

Avec l'application démarrée (`docker compose up`, http://localhost:3000),
tout se fait dans l'interface :

1. Onglet **Configurer**, section Entrepôt : bouton **« Importer »** →
   sélectionnez `mon-entrepot.json`. Le document est **validé à
   l'import** : une erreur de topologie (allée sans débouché, réseau non
   connexe, emprise hors sol…) s'affiche en français sous les boutons —
   corrigez le fichier et réimportez. Quand l'import passe, l'entrepôt
   est sélectionné et la simulation démarre dessus immédiatement ;
2. Onglet **Piloter**, section Scénario : bouton **« Importer »** →
   sélectionnez `mon-scenario.json`. Le scénario apparaît dans le
   sélecteur et pilote les curseurs ;
3. Créez un **projet** (onglet Configurer) associant l'entrepôt et le
   scénario importés, puis sélectionnez-le : la simulation se rejoue en
   direct ;
4. Ajustez la topologie au besoin dans le **mode édition 3D**
   (l'entrepôt modifié est réenregistré en base) ;
5. Les boutons **« Exporter »** téléchargent à tout moment le document
   JSON réimportable (entrepôt ou scénario).

Pour les techniciens, l'équivalent en ligne de commande reste
disponible : validation hors ligne `npm run sim mon-scenario.json
mon-entrepot.json` (sans base de données, KPI en console) et import
`curl -X POST http://localhost:3000/api/warehouses -H 'Content-Type:
application/json' -d @mon-entrepot.json` (idem `/api/scenarios`).

## Étape 5 — Recaler la simulation sur le réel

Avant de comparer des scénarios d'organisation, vérifiez que le modèle
reproduit la situation actuelle :

1. Lancez un run sur la configuration « telle quelle » (effectifs et
   organisation actuels) ;
2. Comparez les KPI simulés aux chiffres Reflex de la période P :
   **lignes préparées par heure et par opérateur** (le meilleur indicateur,
   robuste aux différences de profil de commandes), commandes servies,
   taux d'occupation des opérateurs ;
3. Écart > ~10 % : ajustez dans l'ordre `pickTimePerLineSec` (l'effet le
   plus fort), puis `dropTimeSec` et `speedMps` — et vérifiez `b2cShare`
   et le raisonnement en lignes/heure ;
4. Une fois recalé, **figez l'entrepôt, le scénario et la graine** : ce
   run devient la référence, et les variantes (effectifs, `zoneWave`,
   slotting ABC, flotte d'engins…) se comparent dans la fenêtre KPI
   (section Comparaison) et via les runs enregistrés.

## Récapitulatif

| # | Étape | Livrable | Outil |
|---|---|---|---|
| 1 | Extraire de Reflex (A–E) | 4–5 CSV + paramétrage | Exports Reflex / infocentre / DSI |
| 2 | Construire l'entrepôt | `mon-entrepot.json` | Extraction A + plan coté |
| 3 | Calibrer le scénario | `mon-scenario.json` | Extractions B–E |
| 4 | Importer (validation incluse) | Entrepôt + scénario + projet en base | Boutons « Importer » de l'interface |
| 5 | Recaler | Run de référence fidèle au réel (±10 %) | Fenêtre KPI / comparaison |
