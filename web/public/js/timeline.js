// Enregistrement et relecture des trajectoires d'opérateurs.
// Module pur (sans DOM ni Three.js) : l'enregistreur se branche sur les
// hooks du moteur pendant la simulation, puis positionAt/stateAt
// reconstituent la position et l'état de chaque opérateur à n'importe
// quel instant simulé — c'est l'interpolation entre les ticks.

/**
 * Crée un enregistreur de timeline à brancher sur runSimulation().
 * @param {{nodes: Map<string, {x: number, y: number}>}} graph graphe de l'entrepôt
 * @returns {{
 *   hooks: {onTravel: Function, onState: Function},
 *   finish: (startNodeId: string) => Map<string, object>
 * }}
 */
export function createRecorder(graph) {
  const tracks = new Map();

  function track(opId) {
    if (!tracks.has(opId)) {
      tracks.set(opId, { segments: [], states: [{ t: 0, state: 'idle' }], start: null });
    }
    return tracks.get(opId);
  }

  return {
    hooks: {
      // Départ d'un déplacement : le chemin est converti en points (x, y)
      // avec distance cumulée, pour interpoler pendant la relecture
      onTravel(opId, path, t0, distance, duration) {
        const pts = [];
        let cum = 0;
        for (let i = 0; i < path.length; i++) {
          const node = graph.nodes.get(path[i]);
          if (i > 0) {
            const prev = pts[i - 1];
            cum += Math.hypot(node.x - prev[0], node.y - prev[1]);
          }
          pts.push([node.x, node.y, cum]);
        }
        track(opId).segments.push({ t0, t1: t0 + duration, dist: distance, pts });
      },
      onState(opId, state, t) {
        track(opId).states.push({ t, state });
      },
    },

    /**
     * Clôture l'enregistrement : fixe la position initiale des opérateurs.
     * @param {string} startNodeId nœud de départ (expédition)
     */
    finish(startNodeId) {
      const start = graph.nodes.get(startNodeId);
      for (const t of tracks.values()) {
        t.start = [start.x, start.y];
      }
      return tracks;
    },
  };
}

// Recherche dichotomique : index du dernier élément dont key(el) <= t
function lastIndexAtOrBefore(items, t, key) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Position (coordonnées du plan) d'un opérateur à l'instant t.
 * Entre deux déplacements l'opérateur est immobile à sa dernière position.
 * @param {object} track piste renvoyée par finish()
 * @param {number} t temps simulé (secondes)
 * @returns {{x: number, y: number}}
 */
export function positionAt(track, t) {
  const i = lastIndexAtOrBefore(track.segments, t, (s) => s.t0);
  if (i === -1) return { x: track.start[0], y: track.start[1] };
  const seg = track.segments[i];
  const last = seg.pts[seg.pts.length - 1];
  if (t >= seg.t1 || seg.t1 === seg.t0) return { x: last[0], y: last[1] };

  // Interpolation linéaire le long du chemin, à vitesse constante
  const d = ((t - seg.t0) / (seg.t1 - seg.t0)) * seg.dist;
  let j = 1;
  while (j < seg.pts.length - 1 && seg.pts[j][2] < d) j++;
  const [x1, y1, c1] = seg.pts[j - 1];
  const [x2, y2, c2] = seg.pts[j];
  const f = c2 === c1 ? 0 : (d - c1) / (c2 - c1);
  return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f };
}

/**
 * État d'un opérateur à l'instant t (idle | moving | picking | dropping).
 */
export function stateAt(track, t) {
  const i = lastIndexAtOrBefore(track.states, t, (s) => s.t);
  return i === -1 ? 'idle' : track.states[i].state;
}
