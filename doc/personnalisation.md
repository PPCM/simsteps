# Personnalisation

Décrire son propre entrepôt, régler les paramètres de scénario et
ajouter une stratégie de picking.

## Décrire son propre entrepôt (JSON)

Un entrepôt est un document JSON (voir `demo/warehouse-example.json`),
importable par le bouton « Importer » de la section Entrepôt (ou via
`POST /api/warehouses`) — et l'assistant « Importer depuis un WMS » sait
le générer depuis le référentiel d'emplacements d'un WMS (voir la
[procédure d'import Reflex](procedures/import-reflex.md)). La
circulation est reconstruite en
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
  // Chaque couloir accepte aussi : "width" (largeur praticable, 1.4 m),
  // "oneWay" ("positif" = vers +x/+y, "negatif" = vers −x/−y — la
  // connexité FORTE est vérifiée : des sens uniques qui interdisent le
  // retour sont rejetés) et "access" ("mixte" par défaut, "pietons" ou
  // "engins" pour réserver la voie à une classe d'agents)
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
  "receiving": [{ "id": "REC", "label": "Réception", "x": 36, "y": 40 }],
  // Obstacles (facultatif) : poteaux, bureaux… — blocs pleins hors du
  // réseau, qui ne doivent chevaucher aucun élément (hauteur : 3 m)
  "obstacles": [{ "id": "OB1", "label": "Poteau", "x": 1, "y": 21,
                  "width": 1, "depth": 1, "height": 4 }],
  // Zones tampon (facultatif) : dépose du picking B2C avant emballage
  // quand le scénario compte des emballeurs (paramètre packers)
  "buffers": [{ "id": "TP1", "label": "Tampon emballage", "x": 14, "y": 40 }],
  // Convoyeurs (facultatif) : transport automatique à débit fixe du
  // tampon le plus proche vers l'atelier le plus proche (0,5 m/s) —
  // l'emballeur ne marche plus, le débit devient un goulot mesurable
  // (KPI conveyed) ; exige au moins un tampon et un atelier
  "conveyors": [{ "id": "CV1", "label": "Convoyeur emballage", "x": 12.5, "y": 1,
                  "length": 1.5, "orientation": "horizontal", "throughputPerMin": 4 }],
  // Parkings d'agents (facultatif) : chaque agent démarre au parking
  // atteignable le plus proche pour son gabarit et y retourne à
  // l'inactivité ; sans parking, départ à l'expédition. `vehicles`
  // (facultatif) restreint les types admis (absent = tous)
  "parkings": [{ "id": "PK1", "label": "Parking engins", "x": 4, "y": 40,
                 "vehicles": ["retractable", "vna"] }]
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
`demo/scenario-example.json` :

| Paramètre | Rôle |
|---|---|
| `seed` (1) | Graine du générateur aléatoire — même graine, même run |
| `durationHours` (2) | Durée simulée |
| `operators` (5) | Nombre d'opérateurs à pied (rétro-compatibilité) |
| `fleet` (—) | Composition de flotte `{ type: nombre }` — types : `pieton`, `transpalette`, `gerbeur`, `frontal`, `retractable`, `vna`, `preparateur`, `agv`, `amr` (ces deux derniers sont **automatisés** : mission sans conducteur, mais batterie — voir `agvAutonomyHours`) ; prime sur `operators`. Les **piétons sont les opérateurs** (humains) ; les autres types sont du **matériel garé** : une mission faisable à pied part directement, une mission exigeant un engin mobilise un opérateur qui marche jusqu'à l'engin, le conduit (missions enchaînées sans redescendre), le ramène à son parking et rentre à pied. Chaque engin a ses vitesses à vide/en charge, sa hauteur de levée (borne les niveaux de rack accessibles) et son gabarit d'allée minimal — élargissez allées et couloirs en conséquence. Sans piéton, aucun engin ne bouge |
| `ordersPerHour` (30) | Cadence d'arrivée des commandes (processus de Poisson) |
| `b2cShare` (0.7) | Part de commandes B2C (0 à 1) |
| `strategy` (`orderByOrder`) | `orderByOrder` ou `zoneWave` |
| `slotting` (`aleatoire`) | Placement des classes de rotation ABC : `aleatoire` (rotations dispersées) ou `abc` (20 % de références « A » — 80 % des lignes — au plus près de l'expédition). À comparer via le KPI « Distance / ligne » |
| `waveSize` (20) | Taille max d'une vague (stratégie `zoneWave`) |
| `replenishment` (false) | Stock fini : le niveau 1 des racks devient le picking (débité par les commandes), les niveaux supérieurs la réserve (une palette par emplacement, même référence que sa colonne). Sous le seuil, une mission de réapprovisionnement prioritaire descend une palette — engin obligatoire. Commandes perdues faute de stock comptées en `stockouts` |
| `slotCapacityUnits` (60) | Contenu d'un emplacement picking / d'une palette |
| `replenishThresholdShare` (0.25) | Seuil de déclenchement du réappro (part de la capacité) |
| `inboundTrucksPerDay` (0) | Camions entrants (exige `replenishment`) : chaque camion livre des palettes à quai, rangées en réserve par des missions de putaway ; réserve saturée = palettes en attente (`palletsWaiting`) |
| `palletsPerTruck` (10) | Palettes par camion |
| `palletHandlingSec` (30) | Prise/dépose d'une palette |
| `packers` (0) | Emballeurs (exige des zones tampon) : les lignes B2C sont déposées au tampon, l'emballeur les ramène à l'atelier et emballe — le picking est découplé de l'emballage |
| `packTimePerOrderSec` (60) | Emballage d'une commande au poste |
| `agvAutonomyHours` (4) | Autonomie de batterie des engins automatisés (`agv`, `amr`) : décharge au temps de mission ; sous 20 %, retour à leur parking (station de charge) et recharge 3× plus rapide que la décharge (état violet « Charge », KPI `chargingTimeSec`) |
| `corridorExclusion` (false) | Étend l'exclusivité de croisement aux tronçons de couloir : un engin dont le gabarit dépasse la moitié de la largeur d'un tronçon le verrouille le temps de le traverser, les autres agents attendent en file à ses extrémités (état rouge « Attente », KPI `waitingTimeSec`). Les piétons ne verrouillent jamais |
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
