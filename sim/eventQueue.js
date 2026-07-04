// File d'événements de la simulation à événements discrets.
// Tas binaire min ordonné par (temps, numéro de séquence) : deux événements
// au même instant sortent dans leur ordre d'insertion (stabilité).

export class EventQueue {
  #heap = [];
  #seq = 0;

  /**
   * Insère un événement.
   * @param {number} time instant simulé (secondes)
   * @param {string} type type d'événement
   * @param {object} [payload] données associées
   */
  push(time, type, payload = {}) {
    const event = { time, seq: this.#seq++, type, payload };
    const heap = this.#heap;
    heap.push(event);
    // Remontée dans le tas
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!isBefore(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
    return event;
  }

  /**
   * Extrait l'événement le plus proche dans le temps.
   * @returns {{time: number, type: string, payload: object} | null}
   */
  pop() {
    const heap = this.#heap;
    if (heap.length === 0) return null;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      // Descente dans le tas
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && isBefore(heap[left], heap[smallest])) smallest = left;
        if (right < heap.length && isBefore(heap[right], heap[smallest])) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  /** Instant du prochain événement, ou null si la file est vide. */
  peekTime() {
    return this.#heap.length > 0 ? this.#heap[0].time : null;
  }

  get size() {
    return this.#heap.length;
  }

  isEmpty() {
    return this.#heap.length === 0;
  }
}

// Ordre strict : temps croissant, puis ordre d'insertion
function isBefore(a, b) {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}
