// Arborescence des éléments d'une définition d'entrepôt (panneau
// « Structure » du mode édition, façon calques) : groupes par type
// avec un résumé par élément. Module pur, sans DOM : testable sous Node.

const asList = (value) => (Array.isArray(value) ? value : [value]);

// Un mètre affiché sans traîne binaire (18.000000000000004 → « 18 »)
const m = (v) => String(Math.round(v * 100) / 100);

/**
 * Construit les groupes de l'arborescence. Les groupes obligatoires
 * (allées, couloirs, ateliers, expéditions, réceptions) sont toujours
 * présents ; les optionnels (parkings, tampons, obstacles, convoyeurs)
 * n'apparaissent que s'ils ont des éléments.
 * @param {object} def définition d'entrepôt (normalisée ou non)
 * @returns {Array<{type: string, label: string, items: Array<{id: string, summary: string}>}>}
 */
export function buildTree(def) {
  const rackOf = (aisleId) => def.racks.find((r) => r.aisle === aisleId);
  const zone = (z) => `${m(z.width ?? 4.8)} × ${m(z.depth ?? 3)} m`;
  const groups = [
    {
      type: 'aisle',
      label: 'Allées',
      items: def.aisles.map((a) => ({
        id: a.id,
        summary: `${a.bays} baies · ${rackOf(a.id)?.levels ?? 1} niv.`,
      })),
    },
    {
      type: 'corridor',
      label: 'Couloirs',
      items: asList(def.corridors).map((c) => ({
        id: c.id ?? '—',
        summary: c.length !== undefined
          ? `${c.orientation === 'vertical' ? 'vertical' : 'horizontal'} · ${m(c.length)} m`
          : 'transversal',
      })),
    },
    { type: 'workshop', label: 'Ateliers', items: def.workshops.map((w) => ({ id: w.id, summary: zone(w) })) },
    { type: 'shipping', label: 'Expéditions', items: asList(def.shipping).map((z) => ({ id: z.id, summary: zone(z) })) },
    { type: 'receiving', label: 'Réceptions', items: asList(def.receiving).map((z) => ({ id: z.id, summary: zone(z) })) },
  ];
  const optional = [
    ['parking', 'Parkings', def.parkings ?? [], zone],
    ['buffer', 'Tampons', def.buffers ?? [], zone],
    ['obstacle', 'Obstacles', def.obstacles ?? [], zone],
    ['conveyor', 'Convoyeurs', def.conveyors ?? [],
      (c) => `${m(c.length)} m · ${c.throughputPerMin ?? 6}/min`],
  ];
  for (const [type, label, list, summary] of optional) {
    if (list.length > 0) {
      groups.push({ type, label, items: list.map((e) => ({ id: e.id, summary: summary(e) })) });
    }
  }
  return groups;
}
