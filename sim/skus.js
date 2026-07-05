// Références (SKU) et rangement (slotting). Une référence par
// emplacement, répartie en classes de rotation ABC : les A (20 % des
// emplacements) concentrent 80 % des lignes de commande, les B (30 %)
// 15 %, les C (50 %) 5 %. Le paramètre de scénario `slotting` choisit
// le placement des classes : « aleatoire » (les A sont dispersés — le
// réel subi) ou « abc » (les A au plus près de l'expédition — le
// rangement optimisé). Module pur, déterministe via le rng fourni.

// Classes de rotation : part des emplacements et part des lignes
export const ROTATION_CLASSES = [
  { key: 'A', slotShare: 0.2, pickShare: 0.8 },
  { key: 'B', slotShare: 0.3, pickShare: 0.15 },
  { key: 'C', slotShare: 0.5, pickShare: 0.05 },
];

export const SLOTTINGS = ['aleatoire', 'abc'];

/**
 * Construit le tirage d'emplacements pondéré par la rotation.
 * @param {object} warehouse entrepôt construit par buildWarehouse()
 * @param {'aleatoire'|'abc'} slotting stratégie de placement des classes
 * @param {() => number} rng générateur [0, 1) (mulberry32 du scénario)
 * @param {string[]} [pool] sous-ensemble d'emplacements porteurs de
 *        références (défaut : tous ; avec réapprovisionnement, seuls
 *        les emplacements picking — niveau 1 — portent les références)
 * @returns {{drawSlot: () => string, classBySlot: Map<string, string>}}
 */
export function buildSlotting(warehouse, slotting, rng, pool) {
  const slotIds = pool ?? [...warehouse.slots.keys()];

  // Classement des emplacements : proximité de l'expédition (abc) ou
  // ordre aléatoire (aleatoire) — mélange de Fisher-Yates déterministe
  let ranked;
  if (slotting === 'abc') {
    const distances = warehouse.graph.distancesFrom(warehouse.shippingNodeId);
    ranked = slotIds.slice().sort((a, b) => {
      const da = distances.get(warehouse.slots.get(a).nodeId) ?? Infinity;
      const db = distances.get(warehouse.slots.get(b).nodeId) ?? Infinity;
      return da - db || (a < b ? -1 : 1);
    });
  } else {
    ranked = slotIds.slice();
    for (let i = ranked.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ranked[i], ranked[j]] = [ranked[j], ranked[i]];
    }
  }

  // Découpage en classes selon les parts d'emplacements
  const classBySlot = new Map();
  const slotsByClass = new Map(ROTATION_CLASSES.map((c) => [c.key, []]));
  let offset = 0;
  for (const [index, rotation] of ROTATION_CLASSES.entries()) {
    const count = index === ROTATION_CLASSES.length - 1
      ? ranked.length - offset
      : Math.round(ranked.length * rotation.slotShare);
    for (const slotId of ranked.slice(offset, offset + count)) {
      classBySlot.set(slotId, rotation.key);
      slotsByClass.get(rotation.key).push(slotId);
    }
    offset += count;
  }

  // Tirage : classe selon sa part de lignes, puis emplacement uniforme
  // dans la classe (repli sur la classe suivante si elle est vide)
  function drawSlot() {
    const roll = rng();
    let cumulative = 0;
    for (const rotation of ROTATION_CLASSES) {
      cumulative += rotation.pickShare;
      const slots = slotsByClass.get(rotation.key);
      if (roll < cumulative && slots.length > 0) {
        return slots[Math.floor(rng() * slots.length)];
      }
    }
    return ranked[Math.floor(rng() * ranked.length)];
  }

  return { drawSlot, classBySlot };
}
