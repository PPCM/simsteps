# Extractions Reflex WMS — spécification pour la DSI

Spécification des quatre fichiers CSV à extraire de Reflex WMS (Hardis
Group) pour alimenter l'assistant « Importer depuis un WMS » de
SimSteps. Document à remettre à l'administrateur Reflex ou à la DSI ;
les noms d'écrans et de tables varient selon la version et le
paramétrage du site, seules les **données** listées ici comptent.

## Format attendu

- Un fichier **CSV par extraction**, une ligne par enregistrement, avec
  **ligne d'en-têtes** ;
- Séparateur `;`, `,` ou tabulation — encodage UTF-8 ou latin-1 —
  virgule ou point décimal : l'assistant tolère tout cela ;
- Les noms de colonnes sont libres : l'assistant les reconnaît
  (français ou anglais) et l'utilisateur peut corriger la
  correspondance à l'écran. Les intitulés ci-dessous sont donc
  indicatifs ;
- Période : pour les historiques (B, C, D), une **période
  représentative** de 2 à 4 semaines, hors pics saisonniers et hors
  incidents — la même pour les trois fichiers.

## Voies d'extraction (par ordre de préférence)

1. **Exports CSV/Excel des écrans de consultation** du client web
   Reflex (la plupart des listes ont un bouton d'export) ;
2. **Infocentre / requêteur / éditions personnalisées**, ou le BI de
   l'entreprise alimenté par Reflex ;
3. **Requête SQL sur la base Reflex**, ou réutilisation des **fichiers
   d'interface** hôte ↔ Reflex existants.

## Extraction A — Référentiel des emplacements (obligatoire)

Une ligne par adresse de stockage **active**.

| Colonne | Obligatoire | Contenu |
|---|---|---|
| Allée | oui | Code de l'allée |
| Travée / colonne | oui | Position dans l'allée |
| Niveau | oui | Niveau de stockage (1 = sol) |
| Zone / magasin | non | Regroupement logique (sert aux vagues par zone) |
| Type d'emplacement | non | picking / réserve |
| Côté | non | pair/impair ou gauche/droite |

## Extraction B — Historique des commandes (recommandé)

Une ligne par commande (ou par ligne de commande — l'assistant
regroupe par n° de commande).

| Colonne | Obligatoire | Contenu |
|---|---|---|
| N° de commande | oui | Identifiant unique |
| Type de flux | oui | B2B / B2C / e-commerce… selon la typologie du site (les valeurs sont réinterprétées à l'écran) |
| Date/heure de création | oui | `AAAA-MM-JJ HH:MM[:SS]` ou `JJ/MM/AAAA HH:MM` |
| Code client | non | Sert à compter les clients B2B distincts |

## Extraction C — Historique des missions de préparation (recommandé)

Une ligne par **mouvement de prélèvement validé**.

| Colonne | Obligatoire | Contenu |
|---|---|---|
| N° de mission (ou vague) | oui | Regroupe les prélèvements d'une même tournée |
| Horodatage de validation | oui | Mêmes formats que ci-dessus |
| Opérateur | oui | Sert à l'effectif simultané |
| Type de mission | non | picking / réappro / rangement |

## Extraction D — Historique des réceptions (si étude des flux entrants)

Une ligne par réception (idéalement par camion ou annonce/ASN).

| Colonne | Obligatoire | Contenu |
|---|---|---|
| Date de réception | oui | Jour de la réception |
| Palettes / supports | oui | Quantité reçue |

## Paramétrage à relever en plus (hors fichiers)

Auprès de l'administrateur Reflex, pour la saisie manuelle dans
SimSteps : capacité d'un emplacement picking (en UVC), seuil de
déclenchement du réapprovisionnement, règle de slotting (classes de
rotation ABC), organisation des vagues (taille moyenne).
