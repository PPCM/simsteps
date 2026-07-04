// Graphe de circulation de l'entrepôt : nœuds positionnés (mètres)
// et arêtes orientées ou bidirectionnelles. Pathfinding A*.

export class Graph {
  /** @type {Map<string, {id: string, x: number, y: number}>} */
  nodes = new Map();
  /** @type {Map<string, Array<{to: string, dist: number}>>} */
  #adjacency = new Map();

  addNode(id, x, y) {
    if (this.nodes.has(id)) throw new Error(`Nœud dupliqué : ${id}`);
    this.nodes.set(id, { id, x, y });
    this.#adjacency.set(id, []);
  }

  /**
   * Ajoute une arête entre deux nœuds existants. La distance est la
   * distance euclidienne entre les nœuds.
   * @param {string} from
   * @param {string} to
   * @param {{oneWay?: boolean}} [options] oneWay : sens unique from → to
   */
  addEdge(from, to, { oneWay = false } = {}) {
    const dist = this.distance(from, to);
    this.#adjacency.get(from).push({ to, dist });
    if (!oneWay) this.#adjacency.get(to).push({ to: from, dist });
  }

  neighbors(id) {
    return this.#adjacency.get(id) ?? [];
  }

  /** Distance euclidienne entre deux nœuds. */
  distance(a, b) {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) throw new Error(`Nœud inconnu : ${!na ? a : b}`);
    return Math.hypot(nb.x - na.x, nb.y - na.y);
  }

  /**
   * Plus court chemin par A* (heuristique euclidienne, admissible).
   * @param {string} from
   * @param {string} to
   * @returns {{path: string[], distance: number} | null} null si inatteignable
   */
  shortestPath(from, to) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      throw new Error(`Nœud inconnu : ${!this.nodes.has(from) ? from : to}`);
    }
    if (from === to) return { path: [from], distance: 0 };

    const gScore = new Map([[from, 0]]);
    const cameFrom = new Map();
    // File de priorité simple : liste triée paresseusement (graphes de
    // quelques centaines de nœuds, largement suffisant)
    const open = [{ id: from, f: this.distance(from, to) }];
    const closed = new Set();

    while (open.length > 0) {
      // Extraction du nœud au f minimal
      let best = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[best].f) best = i;
      }
      const { id: current } = open.splice(best, 1)[0];
      if (current === to) {
        // Reconstruction du chemin
        const path = [to];
        let node = to;
        while (cameFrom.has(node)) {
          node = cameFrom.get(node);
          path.unshift(node);
        }
        return { path, distance: gScore.get(to) };
      }
      if (closed.has(current)) continue;
      closed.add(current);

      for (const { to: next, dist } of this.neighbors(current)) {
        if (closed.has(next)) continue;
        const tentative = gScore.get(current) + dist;
        if (tentative < (gScore.get(next) ?? Infinity)) {
          gScore.set(next, tentative);
          cameFrom.set(next, current);
          open.push({ id: next, f: tentative + this.distance(next, to) });
        }
      }
    }
    return null;
  }
}
