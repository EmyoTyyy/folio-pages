// Défilement machine à écrire et paragraphes estompés (Affichage → Focus).
//
// Machine à écrire : après une frappe, Entrée, Retour arrière ou une flèche, la
// page défile pour que la ligne du curseur revienne à 40 % de la hauteur de la
// zone de texte. Jamais après un clic, la molette ou une sélection à la souris :
// on lisait ailleurs, on n'y est pas ramené. Une marge d'une demi-hauteur sous
// la dernière page permet d'y amener aussi la dernière ligne.

import type { FolioApp } from '../app'
import { PAGINATED } from '../layout/pages'
import { settings } from '../settings'

/** Hauteur visée pour la ligne du curseur, en fraction de la zone visible. */
export const TYPEWRITER_LINE = 0.4

const KEYS = new Set(['Enter', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'])

/** Classes de la racine qui suivent les réglages (marge du bas, estompage). */
export function applyFocusClasses(): void {
  const s = settings()
  document.documentElement.classList.toggle('fp-typewriter', s.typewriter)
  document.documentElement.classList.toggle('fp-dim-others', s.dimOthers)
}

export function installTypewriter(app: FolioApp, canvas: HTMLElement): void {
  let armed = false
  /** Depuis la dernière frappe (et jusqu'au prochain clic ou tour de molette) : la ligne reste à sa hauteur. */
  let following = false
  const dom = app.view.dom
  dom.addEventListener(
    'keydown',
    (e) => {
      if (!settings().typewriter || e.isComposing) return
      if ((e.key.length === 1 && !e.ctrlKey && !e.metaKey) || KEYS.has(e.key) || ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'z' || e.key === 'y'))) armed = true
    },
    true,
  )
  // Saisie par un clavier virtuel, une dictée, une méthode de saisie.
  dom.addEventListener('input', () => {
    if (settings().typewriter) armed = true
  })
  const disarm = () => {
    armed = false
    following = false
  }
  for (const ev of ['mousedown', 'wheel', 'touchstart'] as const) canvas.addEventListener(ev, disarm, { passive: true })
  const recentre = () => {
    let caret: { top: number; bottom: number }
    try {
      caret = app.view.coordsAtPos(app.state.selection.head)
    } catch {
      return
    }
    const box = canvas.getBoundingClientRect()
    const delta = (caret.top + caret.bottom) / 2 - (box.top + box.height * TYPEWRITER_LINE)
    if (Math.abs(delta) < 2) return
    // Tout de suite, comme le chariot d'une machine : un défilement animé serait interrompu
    // par la mise en page qui suit chaque frappe (et gênerait avec « réduire les animations »).
    canvas.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior })
  }
  app.onChange(() => {
    if (!armed || !settings().typewriter) return
    armed = false
    following = true
    // Après la mise en page (pagination, hauteur des lignes) de cette modification.
    requestAnimationFrame(recentre)
  })
  // La pagination arrive parfois après (saut de page ajouté) : le texte bouge sans frappe, la ligne revient.
  const afterLayout = () => {
    if (following && settings().typewriter) recentre()
  }
  canvas.addEventListener(PAGINATED, afterLayout)
  new ResizeObserver(afterLayout).observe(dom)
  applyFocusClasses()
}
