// Construction du DOM de l'interface. Le texte passe toujours par textContent :
// aucune donnée du document n'est jamais interprétée comme du HTML.

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

/** Icône SVG de l'application (chaînes constantes du code, jamais des données). */
export function icon(svg: string): SVGElement {
  const tpl = document.createElement('template')
  tpl.innerHTML = svg.trim()
  const el = tpl.content.firstElementChild as SVGElement
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('focusable', 'false')
  return el
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** « Ctrl+S » ou « ⌘S » selon le système. */
export const shortcut = (key: string) => (isMac() ? '⌘' + key : 'Ctrl+' + key)
