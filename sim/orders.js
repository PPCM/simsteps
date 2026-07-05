// Génération de commandes selon deux profils clients :
// - B2C : nombreuses commandes courtes (1 à 3 lignes, petites quantités)
// - B2B : commandes longues (10 à 50 lignes, grosses quantités), rattachées
//   à un client d'un portefeuille restreint (regroupement possible).

import { randInt } from './rng.js';

export const PROFILES = {
  B2C: { minLines: 1, maxLines: 3, minQty: 1, maxQty: 3 },
  B2B: { minLines: 10, maxLines: 50, minQty: 5, maxQty: 20 },
};

/**
 * Crée une commande d'un profil donné : lignes sur des emplacements
 * distincts, tirés uniformément dans le pool fourni ou par un tirage
 * injecté (`drawSlot`, pondéré par la rotation ABC — voir skus.js).
 * @param {() => number} rng générateur pseudo-aléatoire
 * @param {{id: number, profile: 'B2C'|'B2B', slotIds: string[],
 *          drawSlot?: () => string, b2bClients?: number}} params
 * @returns {{id: number, profile: string, clientId: string|null, lines: Array<{slotId: string, qty: number}>}}
 */
export function makeOrder(rng, { id, profile, slotIds, drawSlot, b2bClients = 8 }) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`Profil de commande inconnu : ${profile}`);
  const lineCount = randInt(rng, p.minLines, Math.min(p.maxLines, slotIds.length));

  // Tirage d'emplacements distincts (échantillonnage par rejet, le pool
  // est bien plus grand que le nombre de lignes). Le nombre de tirages
  // est borné : si le pool effectif est trop petit (stock épuisé), la
  // commande sort avec moins de lignes plutôt que de boucler.
  const draw = drawSlot ?? (() => slotIds[Math.floor(rng() * slotIds.length)]);
  const chosen = new Set();
  let attempts = 0;
  while (chosen.size < lineCount && attempts < lineCount * 30) {
    attempts++;
    const slotId = draw();
    if (slotId !== null && slotId !== undefined) chosen.add(slotId);
  }

  return {
    id,
    profile,
    clientId: profile === 'B2B' ? `client-${randInt(rng, 1, b2bClients)}` : null,
    lines: [...chosen].map((slotId) => ({ slotId, qty: randInt(rng, p.minQty, p.maxQty) })),
  };
}

/**
 * Tire le profil d'une commande selon la part B2C du scénario.
 * @param {() => number} rng
 * @param {number} b2cShare part de commandes B2C dans [0, 1]
 */
export function drawProfile(rng, b2cShare) {
  return rng() < b2cShare ? 'B2C' : 'B2B';
}
