// Fenêtres flottantes du panneau : glisser par la barre de titre,
// repli sur la barre (chevron), passage au premier plan au clic,
// position et état mémorisés dans localStorage. La géométrie pure vit
// dans panels.js ; ce module ne fait que le branchement DOM.

import { clampPosition, dragPosition, parsePanelState, serializePanelState } from './panels.js';

const MARGIN = 14;
let zTop = 2; // fenêtre cliquée = premier plan

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible : état non mémorisé */ }
}

/**
 * Rend une fenêtre déplaçable et rétractable.
 * La fenêtre doit contenir une barre `.win-title` avec un bouton
 * `.win-toggle` ; l'état (position, repli) est restauré au chargement.
 */
export function setupWindow(el, storageKey) {
  const title = el.querySelector('.win-title');
  const toggle = el.querySelector('.win-toggle');
  let state = parsePanelState(readStorage(storageKey));

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  const currentPos = () => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  };

  // Applique une position bornée (bascule d'un ancrage CSS vers left/top)
  function applyPosition(pos) {
    const clamped = clampPosition(
      pos, { width: el.offsetWidth, height: el.offsetHeight }, viewport(), MARGIN
    );
    el.style.left = `${clamped.x}px`;
    el.style.top = `${clamped.y}px`;
    el.style.right = 'auto';
    return clamped;
  }

  function persist(patch) {
    state = { ...state, ...patch };
    writeStorage(storageKey, serializePanelState(state));
  }

  function setCollapsed(value) {
    el.classList.toggle('collapsed', value);
    toggle.textContent = value ? '⌄' : '⌃';
    toggle.setAttribute('aria-expanded', String(!value));
    toggle.setAttribute('aria-label', value ? 'Déplier la fenêtre' : 'Replier la fenêtre');
  }

  // Restauration de l'état mémorisé
  setCollapsed(state.collapsed);
  if (state.x !== null) applyPosition({ x: state.x, y: state.y });

  toggle.addEventListener('click', () => {
    const collapsed = !el.classList.contains('collapsed');
    setCollapsed(collapsed);
    // Une fenêtre dépliée près d'un bord peut déborder : on la reborde
    if (el.style.left !== '') applyPosition(currentPos());
    persist({ collapsed });
  });

  // Glisser par la barre de titre (la capture du pointeur suit la
  // souris hors de la barre) ; les contrôles de la barre restent cliquables
  let drag = null;
  title.addEventListener('pointerdown', (event) => {
    el.style.zIndex = String(++zTop);
    if (event.button !== 0 || event.target.closest('button, select, input')) return;
    drag = { origin: currentPos(), start: { x: event.clientX, y: event.clientY } };
    title.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  title.addEventListener('pointermove', (event) => {
    if (!drag) return;
    applyPosition(dragPosition(drag.origin, drag.start, { x: event.clientX, y: event.clientY }));
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    const pos = currentPos();
    persist({ x: pos.x, y: pos.y });
  };
  title.addEventListener('pointerup', endDrag);
  title.addEventListener('pointercancel', endDrag);

  // Une fenêtre déplacée doit rester visible quand la page se redimensionne
  window.addEventListener('resize', () => {
    if (el.style.left !== '') applyPosition(currentPos());
  });
}

/**
 * Branche des onglets (boutons `data-pane` → panneaux par id) avec
 * mémorisation de l'onglet actif.
 */
export function setupTabs(buttons, panes, storageKey) {
  function select(paneId) {
    for (const button of buttons) {
      button.setAttribute('aria-selected', String(button.dataset.pane === paneId));
    }
    for (const pane of panes) pane.hidden = pane.id !== paneId;
    writeStorage(storageKey, paneId);
  }
  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.pane));
  }
  const saved = readStorage(storageKey);
  select(panes.some((p) => p.id === saved) ? saved : panes[0].id);
}
