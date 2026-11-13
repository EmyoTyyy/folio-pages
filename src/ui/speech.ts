// Lecture à voix haute (Révision → Voix, menu contextuel) : avec les voix
// installées sur l'appareil seulement, jamais une voix en ligne, pour que le
// texte ne quitte pas l'ordinateur.

import type { FolioApp } from '../app'

const langOf = (app: FolioApp) => (app.state.doc.attrs.lang as string) || document.documentElement.lang || 'fr'

export function localVoice(langCode: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices().filter((v) => v.localService)
  const base = langCode.slice(0, 2).toLowerCase()
  return voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
}

export const canReadAloud = (app: FolioApp): boolean => !!localVoice(langOf(app))
export const isSpeaking = (): boolean => typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking

export function stopReading(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

/** Lit la sélection, ou le paragraphe du curseur. Renvoie false s'il n'y a pas de voix. */
export function readAloud(app: FolioApp): boolean {
  const s = app.state
  const { from, to, empty, $from } = s.selection
  const text = empty ? $from.parent.textContent : s.doc.textBetween(from, to, '\n', ' ')
  const voice = localVoice(langOf(app))
  if (!voice) return false
  if (!text.trim()) return true
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.slice(0, 20_000))
  u.voice = voice
  u.lang = voice.lang
  u.onend = () => app.notifyUi()
  speechSynthesis.speak(u)
  app.notifyUi()
  return true
}
