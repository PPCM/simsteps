// Logique pure des fenêtres flottantes du panneau : géométrie du
// glisser-déposer, bornage dans la fenêtre du navigateur, état
// sérialisable (position + repli) et texte-résumé des KPI affiché sur
// la barre de titre repliée. Aucun accès au DOM : testable sous Node.

const numFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Borne une position pour que la fenêtre reste entièrement visible,
 * avec une marge. Si la fenêtre est plus grande que la zone visible,
 * elle est calée sur la marge (le coin haut-gauche reste accessible).
 */
export function clampPosition(pos, size, viewport, margin = 14) {
  const maxX = viewport.width - size.width - margin;
  const maxY = viewport.height - size.height - margin;
  return {
    x: Math.min(Math.max(pos.x, margin), Math.max(maxX, margin)),
    y: Math.min(Math.max(pos.y, margin), Math.max(maxY, margin)),
  };
}

/** Position d'une fenêtre pendant un glisser : origine + delta du pointeur. */
export function dragPosition(origin, start, current) {
  return {
    x: origin.x + current.x - start.x,
    y: origin.y + current.y - start.y,
  };
}

/**
 * Relit un état de fenêtre depuis localStorage. Tolère l'absence, le
 * JSON invalide et les champs manquants : position nulle (= position
 * par défaut du CSS) et fenêtre dépliée dans ces cas.
 */
export function parsePanelState(raw) {
  const fallback = { x: null, y: null, collapsed: false };
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    const data = JSON.parse(raw);
    const hasPosition = Number.isFinite(data?.x) && Number.isFinite(data?.y);
    return {
      x: hasPosition ? data.x : null,
      y: hasPosition ? data.y : null,
      collapsed: data?.collapsed === true,
    };
  } catch {
    return fallback;
  }
}

/** Sérialise un état de fenêtre pour localStorage. */
export function serializePanelState(state) {
  return JSON.stringify({
    x: Number.isFinite(state?.x) ? state.x : null,
    y: Number.isFinite(state?.y) ? state.y : null,
    collapsed: state?.collapsed === true,
  });
}

/** Résumé des deux KPI clés pour la barre de titre repliée. */
export function kpiSummaryText(kpis) {
  if (!kpis) return '';
  return `${numFr.format(kpis.ordersPerHour)} cmd/h · ${numFr.format(kpis.occupancyRate * 100)} %`;
}
