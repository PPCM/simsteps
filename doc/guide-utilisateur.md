# Guide Utilisateur

Ce guide décrit l'interface de SimSteps, servie sur
**http://localhost:3000** (voir le [README](../README.md) pour le
démarrage).

## Organisation de l'écran

L'interface s'organise en deux fenêtres flottantes, déplaçables par leur
barre de titre et rétractables d'un clic sur le chevron (position, repli
et onglet actif sont mémorisés par le navigateur) :

- la **fenêtre principale** porte la Lecture, toujours visible, et deux
  onglets : **Piloter** (scénario, curseurs, affichage, enregistrement
  du run) et **Configurer** (projet, entrepôt, éditeur 3D). Repliée, sa
  barre de titre conserve lecture/pause et l'horloge simulée.
- la **fenêtre Indicateurs** porte les KPI en direct et la comparaison.
  Repliée, sa barre de titre affiche les deux KPI clés (commandes/h et
  occupation), mis à jour en continu.

## Le détail des sections

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
  avec l'entrepôt). « Éditer » ouvre l'atelier d'édition (voir plus bas).
  « Importer » charge un document d'entrepôt JSON (validé à l'import,
  erreurs affichées en français) et « Exporter » télécharge le document
  réimportable de l'entrepôt courant. « Importer depuis un WMS » ouvre
  un assistant qui lit les CSV extraits d'un WMS (Reflex…) — référentiel
  des emplacements, historiques de commandes, missions et réceptions —,
  propose la correspondance des colonnes, explique chaque valeur
  calculée, puis crée d'un coup l'entrepôt provisoire, le scénario
  calibré et le projet, et ouvre l'éditeur 3D pour la mise au plan (voir
  la [procédure d'import Reflex](procedures/import-reflex.md)).
- **Scénario** : choix du scénario de base — « Importer » /
  « Exporter » échangent ses paramètres en JSON —, curseurs opérateurs à pied /
  mix B2C / cadence, et compteurs d'engins de manutention (transpalette,
  gerbeur, frontal, rétractable, VNA, préparateur — l'infobulle rappelle
  gabarit d'allée et hauteur de levée de chacun ; chaque type d'engin est
  rendu par un modèle low-poly reconnaissable — timon et fourches basses
  du transpalette, mât du gerbeur, contrepoids et toit du frontal,
  longerons du rétractable, fourches en tourelle du VNA, plateforme à
  garde-corps du préparateur — orienté selon sa direction de déplacement,
  avec un conducteur visible dès qu'il est en mission — debout derrière
  le timon pour les engins accompagnants — et un anneau d'état au sol ;
  à l'arrêt, les engins d'un même parking s'étalent sur des places
  distinctes). Le bloc « Flux » active le réapprovisionnement
  (stock fini, réserve aux niveaux hauts), les camions entrants et les
  emballeurs (voir les [paramètres de scénario](personnalisation.md)).
  Le bloc « Circulation » active les croisements exclusifs dans les
  couloirs étroits (`corridorExclusion`, voir la section congestion
  ci-dessous). Le panneau repliable **« Tous les paramètres »** expose
  le reste des [paramètres de scénario](personnalisation.md) — durée,
  graine, stratégie, taille de vague, temps opératoires, module flux,
  autonomie AGV — groupés, bornés, avec la formule de calibrage en
  infobulle ; une valeur modifiée devient une surcharge du scénario de
  base, enregistrée avec le projet. **« Enregistrer comme scénario »**
  fige les réglages courants sous un nouveau nom. Tout changement
  relance instantanément la simulation (elle s'exécute dans le
  navigateur en quelques millisecondes) ; la relecture repart de zéro.
- **Enregistrer ce run en base** : fige les paramètres courants, les KPI et
  les trajets agrégés côté serveur, pour comparaison ultérieure.
- **Affichage** : traînées de déplacement (une couleur par opérateur),
  heatmap de fréquentation au sol, et masquage des libellés 3D — quand
  ils sont masqués, un clic sur un élément (allée, atelier, zone,
  couloir) révèle le sien, un clic dans le vide le cache.
- **Indicateurs en direct** : les KPI évoluent pendant la relecture
  (dont « Lignes / h / op. », la productivité par agent).
- **Recalage** : saisissez la productivité réelle observée dans votre
  WMS (lignes/heure/opérateur) et « Calibrer » retrouve le temps de
  prélèvement par ligne qui la reproduit à ±5 % (quelques runs
  déterministes) ; « Appliquer » reporte la valeur dans le scénario.
  Si la cible est inatteignable ou si la productivité simulée ne dépend
  pas du temps de prélèvement (opérateurs sous-chargés), un message
  explique quoi ajuster.
- **Comparaison** : deux sources au choix (réglages actuels, scénarios,
  runs enregistrés) et tableau des écarts, colorés selon le sens de
  l'amélioration. Avec un projet actif, seuls les runs du projet sont
  proposés ; sinon, ceux de l'entrepôt affiché.

## L'atelier d'édition d'entrepôt

« Éditer » (onglet Configurer) met la simulation en pause et bascule
dans un **atelier d'édition plein écran** : les fenêtres flottantes
s'effacent, la scène devient l'espace de travail et un chrome fixe
d'application de bureau l'encadre —

- **ruban en haut** : les outils de création groupés (Structure :
  allée, couloir ; Zones : atelier, expédition, réception, parking,
  tampon ; Flux : obstacle, convoyeur) et les actions Modifier
  (« Dupliquer » copie la sélection sous un identifiant libre, décalée
  de 2 m, racks compris pour une allée ; « Supprimer »), avec
  « ↶ Annuler » / « ↷ Rétablir » près du titre (historique complet de
  la session d'édition) et « Enregistrer » / « Quitter sans
  enregistrer » à droite ; tout à droite du ruban, le groupe **Aide**
  ouvre la fenêtre « Procédures » : les guides pas à pas livrés avec
  l'application (par exemple l'[import de données Reflex
  WMS](procedures/import-reflex.md)), rendus dans un volet à gauche de
  la scène — cliquer un titre l'ouvre, « ← » revient à la liste, « ✕ »
  ou Échap ferme ;
- **dock à droite** : l'arborescence « Structure » (les éléments
  groupés par type avec leur résumé — baies et niveaux d'une allée,
  orientation et longueur d'un couloir… ; un clic sélectionne sans
  chercher dans la 3D) au-dessus des propriétés de la sélection
  (baies, zone, identifiants, largeur/profondeur — chaque élément est
  redimensionnable ; les racks se règlent depuis le panneau de leur
  allée : niveaux, hauteur de niveau, profondeur, appliqués aux deux
  côtés) ; sans sélection, le dock montre les propriétés de
  l'entrepôt (nom, dimensions, hauteur sous plafond qui borne les
  racks) et la liste des erreurs de validation ;
- **barre d'état en bas** : coordonnées du pointeur sur le sol, pas
  d'accrochage, état de validation en continu (« ✓ Plan valide » ou
  le nombre d'erreurs en rouge) et rappel des gestes.

Raccourcis clavier (chacun rappelé dans l'infobulle de son bouton) :
**1 à 9** ajoutent les éléments dans l'ordre du ruban (allée, couloir,
atelier, expédition, réception, parking, tampon, obstacle, convoyeur),
**0** ouvre ou ferme les procédures,
**Ctrl+Z** / **Ctrl+Y** annulent et rétablissent, **Ctrl+D** duplique
la sélection, **Suppr** la supprime, **Ctrl+S** enregistre et
**Échap** ferme l'aide ouverte, sinon désélectionne. Les raccourcis
s'effacent pendant la saisie dans un champ.

Dans la scène : cliquer un élément le sélectionne, glisser le déplace
par pas d'un mètre — le bord gauche/avant s'aligne sur le carroyage au
sol, un élément de dimensions entières remplit donc des carreaux
entiers, et les champs x/y des zones expriment ces bords (valeurs
entières après accrochage) — dans les limites du plan. Au moins un
couloir et une zone d'expédition/réception doivent rester ; parkings
et tampons sont optionnels — placez les parkings en bordure, hors des
flux, et les tampons près des ateliers. Les couloirs sont des objets à
part entière : position, longueur, largeur et orientation
(horizontal/vertical) modifiables, connexion automatique aux
croisements — de quoi dessiner de vrais chemins de circulation.
« Enregistrer » valide et persiste la définition (modification en
place : tous les projets qui référencent l'entrepôt la voient),
« Quitter sans enregistrer » restaure l'état d'entrée. Limites
assumées : pas de redimensionnement à la souris, racks dérivés des
allées (deux racks gauche/droite).

## Couleurs d'état et rendu des agents

Couleurs d'état : bleu = déplacement, ambre = prélèvement,
vert = dépose, rouge = attente en circulation (congestion),
violet = recharge (engins automatisés), gris = inactif. Les piétons
portent la couleur sur leur capsule, les engins (carrosserie orange
constante) sur leur anneau au sol.

Les agents s'évitent aussi visuellement : deux capsules ou engins trop
proches à l'écran sont légèrement écartés (décalage amorti, borné à
0,9 m) — un engin garé ou en recharge repousse sans quitter sa place.
C'est un artifice de rendu uniquement : les trajets simulés, les temps
et les KPI ne changent pas.

## Congestion

Un engin dont le gabarit dépasse la moitié de la largeur du couloir
d'allée ne peut pas y être croisé — il verrouille l'allée qu'il
traverse et les autres agents (piétons compris) attendent en file à
ses extrémités. Les piétons ne verrouillent jamais. L'attente cumulée
alimente le KPI `waitingTimeSec` des runs. Le paramètre de scénario
`corridorExclusion` (case « Croisements exclusifs dans les couloirs
étroits » de l'onglet Piloter) étend ce mécanisme à chaque tronçon de
couloir : les croisements impossibles physiquement (voie plus étroite
que deux gabarits) deviennent des attentes mesurables au lieu de
chevauchements ignorés.
