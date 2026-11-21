// Info-bulles : celles du navigateur (attribut title) ne se mettent pas en forme.
// Au survol d'un élément qui a un title, on montre notre bulle à la place : le title
// est mis de côté le temps du survol (sinon le navigateur montrerait la sienne aussi),
// puis remis. Au clavier (focus visible), la bulle s'affiche sans toucher au title.
//
// Le texte du document (ProseMirror) garde les bulles du navigateur : y retirer un
// attribut serait vu comme une modification du texte.

const DELAY = 450
/** Une bulle vient de se fermer : la suivante s'ouvre presque tout de suite (on parcourt le ruban). */
const QUICK = 60
const QUICK_WINDOW = 600
const GAP = 6
const EDGE = 6

let tip: HTMLElement | null = null
let current: HTMLElement | null = null
let byKeyboard = false
let timer: ReturnType<typeof setTimeout> | null = null
/** La bulle attendue vient du clavier (le focus qui part l'annule). */
let pendingKeyboard = false
let lastHide = 0
let watch = 0

function tipElement(): HTMLElement {
  if (tip) return tip
  tip = document.createElement('div')
  tip.className = 'fp-tooltip'
  tip.id = 'fp-tooltip'
  tip.setAttribute('role', 'tooltip')
  // Dans la couche du dessus (au-dessus d'une fenêtre ouverte) quand le navigateur le permet.
  if ('showPopover' in tip) tip.setAttribute('popover', 'manual')
  document.body.append(tip)
  return tip
}

/** Bouton fait d'une icône seule : son nom (aria-label) sert de bulle. */
const ICON_ONLY = 'button[aria-label]:not([title])'

/** L'élément à bulle sous le pointeur ou qui a le focus, hors du texte du document. */
function owner(target: EventTarget | null): HTMLElement | null {
  const start = target as Element | null
  let el = start?.closest?.('[title], [data-fp-tip]') ?? null
  const icon = start?.closest?.(ICON_ONLY) ?? null
  // Le plus proche des deux (une icône dans un groupe qui a un title, par exemple).
  if (icon && (!el || el.contains(icon)) && !(icon.textContent ?? '').trim()) el = icon
  if (!(el instanceof HTMLElement) || el.closest('.ProseMirror')) return null
  return el
}

function textOf(el: HTMLElement): string {
  return (el.getAttribute('title') ?? el.dataset.fpTip ?? el.getAttribute('aria-label') ?? '').trim()
}

function place(el: HTMLElement, t: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const w = t.offsetWidth
  const h = t.offsetHeight
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), vw - w - EDGE)
  const below = r.bottom + GAP
  const above = r.top - GAP - h
  const top = below + h <= vh - EDGE || above < EDGE ? below : above
  t.style.left = `${Math.round(left)}px`
  t.style.top = `${Math.round(top)}px`
  t.dataset.side = top === below ? 'below' : 'above'
}

function show(el: HTMLElement, keyboard: boolean): void {
  const text = textOf(el)
  if (!text) return
  if (current && current !== el) hide()
  current = el
  byKeyboard = keyboard
  if (!keyboard) {
    // Le title est mis de côté (bulle du navigateur) ; le nom accessible reste le même.
    el.dataset.fpTip = text
    if (el.hasAttribute('title')) {
      if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', text)
      el.removeAttribute('title')
    }
  }
  if (!el.getAttribute('aria-describedby')) {
    el.setAttribute('aria-describedby', 'fp-tooltip')
    el.dataset.fpTipDescribed = ''
  }
  const t = tipElement()
  t.classList.remove('is-open')
  t.textContent = text
  const pop = t as HTMLElement & { showPopover?: () => void; hidePopover?: () => void }
  if (pop.showPopover) {
    // Remontée à chaque fois : au-dessus d'une fenêtre ouverte après elle.
    if (t.matches(':popover-open')) pop.hidePopover!()
    pop.showPopover()
  }
  place(el, t)
  // Une image plus tard : le fondu se joue.
  requestAnimationFrame(() => {
    if (current === el) t.classList.add('is-open')
  })
  // L'élément peut disparaître (menu fermé) : la bulle part avec lui.
  cancelAnimationFrame(watch)
  const check = () => {
    if (!current) return
    if (!current.isConnected) hide()
    else watch = requestAnimationFrame(check)
  }
  watch = requestAnimationFrame(check)
}

export function hide(): void {
  if (timer) clearTimeout(timer)
  timer = null
  cancelAnimationFrame(watch)
  const el = current
  current = null
  if (el) {
    if (el.dataset.fpTip !== undefined) {
      if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.fpTip)
      delete el.dataset.fpTip
    }
    if (el.dataset.fpTipDescribed !== undefined) {
      el.removeAttribute('aria-describedby')
      delete el.dataset.fpTipDescribed
    }
    lastHide = performance.now()
  }
  if (tip) {
    tip.classList.remove('is-open')
    const pop = tip as HTMLElement & { hidePopover?: () => void }
    if (pop.hidePopover && tip.matches(':popover-open')) pop.hidePopover()
  }
}

function later(el: HTMLElement, keyboard: boolean): void {
  if (timer) clearTimeout(timer)
  const wait = performance.now() - lastHide < QUICK_WINDOW ? QUICK : DELAY
  pendingKeyboard = keyboard
  timer = setTimeout(() => {
    timer = null
    show(el, keyboard)
  }, wait)
}

/** Une bulle tout de suite (bouton « ? » : clic ou Entrée), ou sa fermeture si elle est déjà là. */
export function toggleTip(el: HTMLElement): void {
  if (current === el) hide()
  else show(el, false)
}

export function installTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = owner(e.target)
    if (!el || el === current) return
    if (current && !byKeyboard) hide()
    later(el, false)
  })
  document.addEventListener('pointerout', (e) => {
    const el = owner(e.target)
    if (!el) return
    const to = e.relatedTarget as Node | null
    if (to && el.contains(to)) return
    if (timer) clearTimeout(timer)
    timer = null
    if (current === el && !byKeyboard) hide()
  })
  document.addEventListener(
    'pointerdown',
    (e) => {
      // Un clic ferme la bulle, sauf sur un bouton à bulle cliquable (il la bascule lui-même).
      if (current && (e.target as Element | null)?.closest?.('[data-tip-click]') === current) return
      hide()
    },
    true,
  )
  document.addEventListener('focusin', (e) => {
    const el = owner(e.target)
    if (!el || !(e.target as Element).matches(':focus-visible')) return
    later(el, true)
  })
  document.addEventListener('focusout', (e) => {
    // Une bulle attendue au clavier n'a plus lieu d'être : le focus est parti.
    if (timer && pendingKeyboard) {
      clearTimeout(timer)
      timer = null
    }
    if (current && byKeyboard && owner(e.target) === current) hide()
  })
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && current) hide()
    },
    true,
  )
  window.addEventListener('scroll', () => current && hide(), true)
  window.addEventListener('blur', () => hide())
}
