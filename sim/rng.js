// Générateur pseudo-aléatoire déterministe (mulberry32).
// Toute la simulation en dépend pour être reproductible à partir d'une graine.

/**
 * Crée un générateur pseudo-aléatoire déterministe.
 * @param {number} seed graine entière
 * @returns {() => number} fonction renvoyant un nombre dans [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Entier uniforme dans [min, max] inclus.
 */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Tirage exponentiel : temps d'inter-arrivée pour un processus de Poisson.
 * @param {() => number} rng
 * @param {number} ratePerSec taux d'arrivée (événements par seconde)
 * @returns {number} délai en secondes (> 0)
 */
export function randExponential(rng, ratePerSec) {
  // 1 - rng() évite log(0)
  return -Math.log(1 - rng()) / ratePerSec;
}

/**
 * Choisit un élément au hasard dans un tableau.
 */
export function randChoice(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
