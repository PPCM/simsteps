# Importer des données Reflex WMS dans SimSteps

Procédure pour construire un entrepôt et un scénario SimSteps à partir
des données réelles d'un site géré sous Reflex WMS (Hardis Group).
Depuis l'assistant **« Importer depuis un WMS »**, tout se fait dans
l'interface : les CSV extraits de Reflex sont lus dans le navigateur,
l'entrepôt et le scénario calibré sont créés en un clic, la mise au
plan se termine dans l'éditeur 3D.

## Principe et limites

Trois points à garder en tête avant de commencer :

- **SimSteps génère lui-même les commandes** (processus de Poisson
  piloté par la graine `seed`) : on ne rejoue pas les commandes réelles
  de Reflex, on **calibre les paramètres** (cadence, part B2C, temps de
  prélèvement…) pour que le profil simulé reproduise statistiquement
  l'historique — c'est exactement ce que fait l'assistant ;
- **La topologie est agrégée** : SimSteps modélise des allées, des
  racks, des baies et des niveaux — pas chaque adresse Reflex
  individuellement. Le référentiel d'emplacements sert à compter
  (travées, niveaux, zones), pas à recopier adresse par adresse ;
- **Reflex ne contient pas les cotes du bâtiment** : l'assistant pose
  les allées sur une **trame par défaut** et les positions réelles
  (x, y, largeurs d'allées et de couloirs) s'ajustent ensuite dans
  l'éditeur 3D, d'après le plan du site (DWG/PDF coté).

## Prérequis

- Les fichiers CSV extraits de Reflex — la spécification détaillée à
  remettre à l'administrateur Reflex ou à la DSI est dans la procédure
  dédiée : **[Extractions Reflex WMS — spécification pour la
  DSI](extractions-reflex-dsi.md)**. En résumé : A. référentiel des
  emplacements (obligatoire), B. historique des commandes,
  C. historique des missions de préparation, D. historique des
  réceptions (B–D facultatifs, sur une même période représentative de
  2 à 4 semaines) ;
- Le plan du bâtiment coté en mètres (implantation des allées,
  couloirs, quais, postes d'emballage) ;
- L'application démarrée (`docker compose up`, http://localhost:3000).

## Étape 1 — Dérouler l'assistant

Onglet **Configurer**, section Entrepôt, bouton **« Importer depuis un
WMS »**. L'assistant enchaîne cinq écrans ; à chaque fichier déposé, il
propose la correspondance des colonnes (corrigez-la si besoin dans les
listes) puis **« Analyser »** affiche le résultat avec son explication.
Rien n'est créé avant le dernier écran.

1. **Emplacements (extraction A, obligatoire)** — déposez le CSV,
   vérifiez les colonnes allée / travée / niveau (zone, type et côté
   sont facultatifs), analysez : le tableau récapitule les allées
   détectées (travées, niveaux, zone) et signale les anomalies (lignes
   incomplètes, allée mono-travée…) ;
2. **Commandes (extraction B, facultatif)** — indiquez les **heures
   ouvrées par jour** et l'interprétation de chaque **type de flux**
   du site (B2C → atelier, B2B → expédition, ou Ignorer) : l'analyse
   calcule la cadence (`ordersPerHour`), la part B2C et le nombre de
   clients B2B, chaque valeur avec sa formule ;
3. **Missions de préparation (extraction C, facultatif)** — l'analyse
   calcule le temps par ligne (médiane des écarts entre validations
   d'une même mission, aberrations exclues) et l'effectif simultané
   moyen ;
4. **Réceptions (extraction D, facultatif)** — camions/jour et
   palettes par camion ; analyser cette extraction active le
   réapprovisionnement (stock fini) dans le scénario ;
5. **Récapitulatif** — nommez l'import puis **« Créer »** : l'entrepôt
   provisoire, le scénario calibré et le projet qui les lie sont créés,
   et l'éditeur 3D s'ouvre directement.

Les étapes facultatives se passent d'un clic (« Passer ») : les
paramètres concernés gardent leurs valeurs par défaut.

## Étape 2 — Mise au plan dans l'éditeur 3D

L'assistant a posé les allées au pas de 5 m avec deux couloirs
transversaux et des zones par défaut. Avec le plan du bâtiment sous les
yeux, ajustez dans l'éditeur (accrochage au mètre, validation en
continu dans la barre d'état) :

- les **dimensions du sol** et la position/longueur/largeur de chaque
  **allée** (la largeur praticable détermine le gabarit des engins
  admis) ;
- les **couloirs** réels (ajoutez-en, `access` piétons/engins, sens
  uniques) ;
- les **zones** : quais de réception, expédition, ateliers d'emballage,
  et le cas échéant tampons, parkings d'engins, obstacles, convoyeurs ;
- les **racks** (hauteur de niveau, profondeur) via le panneau de leur
  allée.

Puis **Enregistrer**. En cas d'erreur de topologie (allée sans
débouché, réseau non connexe…), le message en français dans le dock
désigne l'élément à corriger.

## Étape 3 — Compléter le scénario

L'assistant calibre ce que l'historique permet de calculer. Le reste se
saisit dans l'onglet **Piloter** (curseurs et panneau **« Tous les
paramètres »**, formules rappelées en infobulle) :

| Paramètre | Source |
|---|---|
| `strategy` / `waveSize` | Organisation du site : `zoneWave` si Reflex lance des vagues par zone, taille moyenne des vagues |
| `slotting` | `abc` si le site pratique un slotting par rotation |
| `slotCapacityUnits` / `replenishThresholdShare` | Paramétrage Reflex (capacité d'un emplacement picking, seuil de réappro ÷ capacité) |
| `packers` / `packTimePerOrderSec` | Emballeurs dédiés (exige des zones tampon dans l'entrepôt) |
| `speedMps`, `dropTimeSec`, `liftTimePerLevelSec` | Mesure terrain ou défauts |
| `fleet` | Parc d'engins réel (compteurs de la section Scénario) |

**« Enregistrer comme scénario »** fige le tout ; « Mettre à jour » le
projet conserve les surcharges. Un export/import JSON reste disponible
pour préparer ces valeurs hors ligne (boutons « Importer » /
« Exporter », format dans [personnalisation](personnalisation.md)).

## Étape 4 — Recaler la simulation sur le réel

Avant de comparer des scénarios d'organisation, vérifiez que le modèle
reproduit la situation actuelle. La fenêtre **Indicateurs** a une
section **« Recalage »** qui automatise l'essentiel :

1. Configurez la situation « telle quelle » (effectifs et organisation
   actuels) ;
2. Relevez dans Reflex la productivité réelle de la période :
   **lignes préparées par heure et par opérateur** (le meilleur
   indicateur, robuste aux différences de profil de commandes) ;
3. Saisissez cette valeur dans « Lignes / h / opérateur observées » et
   cliquez **« Calibrer »** : l'application itère sur le temps de
   prélèvement par ligne (la simulation est déterministe et
   instantanée) jusqu'à reproduire la productivité observée à ±5 %,
   puis affiche la valeur trouvée — **« Appliquer »** la reporte dans
   le scénario (rien n'est modifié sans ce clic) ;
4. Deux messages possibles au lieu d'un résultat : *cible
   inatteignable* (vérifiez effectifs, part B2C, cadence — raisonnez en
   lignes/heure) ou *productivité indépendante du temps de prélèvement*
   (les opérateurs sont sous-chargés et suivent la demande : le
   recalage n'a de sens qu'en charge) ;
5. Une fois recalé, **figez l'entrepôt, le scénario et la graine**
   (« Mettre à jour » le projet) : ce run devient la référence, et les
   variantes (effectifs, `zoneWave`, slotting ABC, flotte d'engins…) se
   comparent dans la section Comparaison et via les runs enregistrés.

## Récapitulatif

| # | Étape | Livrable | Outil |
|---|---|---|---|
| 0 | Extraire de Reflex | CSV A (+ B, C, D) | [Procédure DSI](extractions-reflex-dsi.md) |
| 1 | Assistant d'import | Entrepôt provisoire + scénario calibré + projet | « Importer depuis un WMS » |
| 2 | Mise au plan | Topologie fidèle au bâtiment | Éditeur 3D + plan coté |
| 3 | Compléter le scénario | Paramètres d'organisation saisis | Panneau « Tous les paramètres » |
| 4 | Recaler | Run de référence fidèle au réel (±5 %) | Section « Recalage » de la fenêtre Indicateurs |

## Pour les techniciens

L'équivalent hors interface existe toujours : construction manuelle des
JSON (format dans [personnalisation](personnalisation.md), modèles dans
`demo/`), validation hors ligne `npm run sim mon-scenario.json
mon-entrepot.json`, import par l'API (`POST /api/warehouses`,
`/api/scenarios`, `/api/projects`).
