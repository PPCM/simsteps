// Évitement visuel entre agents : décalages de séparation purement
// cosmétiques appliqués à la relecture pour que capsules et engins ne
// s'interpénètrent pas à l'écran. La simulation (trajets, KPI, runs)
// n'est jamais modifiée. Module pur, sans DOM : testable sous Node.

// Décalage maximal (mètres) : borne la poussée pour ne pas projeter
// visuellement un agent dans les racks voisins
export const MAX_SEPARATION_OFFSET = 0.9;

/**
 * Décalages cibles de séparation pour un ensemble d'agents au sol.
 * Deux agents plus proches que la somme de leurs rayons sont écartés
 * le long de leur axe : symétriquement si les deux sont mobiles, en
 * poussant tout l'écart sur le seul mobile sinon (un agent immobile —
 * garé sur sa place — repousse sans bouger). Agents confondus : axe de
 * repli déterministe dérivé des indices de la paire.
 * @param {Array<{id: string, x: number, z: number, r: number, movable: boolean}>} agents
 *        positions brutes dans le plan (x, z) et rayon d'encombrement
 * @returns {Map<string, {dx: number, dz: number}>} décalage par id
 *          (les agents sans voisin proche n'y figurent pas)
 */
export function separationOffsets(agents) {
  const offsets = new Map();
  const push = (agent, dx, dz) => {
    const current = offsets.get(agent.id) ?? { dx: 0, dz: 0 };
    offsets.set(agent.id, { dx: current.dx + dx, dz: current.dz + dz });
  };
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];
      if (!a.movable && !b.movable) continue;
      const minSep = a.r + b.r;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist >= minSep) continue;
      // Axe de séparation unitaire, de b vers a
      let nx;
      let nz;
      if (dist > 1e-6) {
        nx = (a.x - b.x) / dist;
        nz = (a.z - b.z) / dist;
      } else {
        const angle = (i + j) * 2.3999632297286533; // angle d'or : répartit les paires confondues
        nx = Math.cos(angle);
        nz = Math.sin(angle);
      }
      const overlap = minSep - dist;
      if (a.movable && b.movable) {
        push(a, nx * overlap / 2, nz * overlap / 2);
        push(b, -nx * overlap / 2, -nz * overlap / 2);
      } else if (a.movable) {
        push(a, nx * overlap, nz * overlap);
      } else {
        push(b, -nx * overlap, -nz * overlap);
      }
    }
  }
  // Borne la poussée cumulée (plusieurs voisins peuvent s'additionner)
  for (const offset of offsets.values()) {
    const magnitude = Math.hypot(offset.dx, offset.dz);
    if (magnitude > MAX_SEPARATION_OFFSET) {
      offset.dx *= MAX_SEPARATION_OFFSET / magnitude;
      offset.dz *= MAX_SEPARATION_OFFSET / magnitude;
    }
  }
  return offsets;
}
