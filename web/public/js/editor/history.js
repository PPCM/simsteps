// Historique d'édition (annuler/rétablir) : piles d'états immuables.
// Les opérations du modèle étant pures (chaque changement produit une
// nouvelle définition, jamais mutée), l'historique stocke les
// références telles quelles. Module pur, sans DOM : testable sous Node.

/**
 * Crée un historique borné. `push` enregistre l'état quitté et vide le
 * futur ; `undo`/`redo` reçoivent l'état courant (empilé de l'autre
 * côté) et rendent l'état à appliquer, ou null s'il n'y a rien.
 * @param {number} [limit] profondeur maximale (les plus anciens tombent)
 */
export function createHistory(limit = 100) {
  let past = [];
  let future = [];
  return {
    push(state) {
      past.push(state);
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      if (past.length === 0) return null;
      future.push(current);
      return past.pop();
    },
    redo(current) {
      if (future.length === 0) return null;
      past.push(current);
      return future.pop();
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    reset() {
      past = [];
      future = [];
    },
  };
}
