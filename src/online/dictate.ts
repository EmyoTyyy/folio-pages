// Dicter : la reconnaissance vocale du navigateur écrit au curseur.
//
// L'API Web Speech (SpeechRecognition) existe dans Chrome, Edge et Safari ;
// pas dans Firefox. Dans Chrome, le son est envoyé au service de reconnaissance
// de Google : c'est une fonction réseau, bloquée en mode hors ligne, et
// l'utilisateur en est averti au premier usage.

/** Commandes vocales de ponctuation (dites seules, entre deux mots). */
const COMMANDS: Record<'fr' | 'en', [RegExp, string][]> = {
  fr: [
    [/\s*\bnouveau paragraphe\b\s*/gi, '\n\n'],
    [/\s*\b(nouvelle ligne|à la ligne|retour à la ligne)\b\s*/gi, '\n'],
    [/\s*\bpoints? d'interrogation\b/gi, ' ?'],
    [/\s*\bpoints? d'exclamation\b/gi, ' !'],
    [/\s*\bpoints? de suspension\b/gi, '…'],
    [/\s*\bdeux[- ]points\b/gi, ' :'],
    [/\s*\bpoint[- ]virgule\b/gi, ' ;'],
    [/\s*\bvirgule\b/gi, ','],
    [/\s*\bpoint\b(?! d)/gi, '.'],
    [/\s*\bouvrez les guillemets\b\s*/gi, ' « '],
    [/\s*\bfermez les guillemets\b/gi, ' »'],
  ],
  en: [
    [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
    [/\s*\bnew line\b\s*/gi, '\n'],
    [/\s*\bquestion mark\b/gi, '?'],
    [/\s*\bexclamation (mark|point)\b/gi, '!'],
    [/\s*\bsemicolon\b/gi, ';'],
    [/\s*\bcolon\b/gi, ':'],
    [/\s*\bcomma\b/gi, ','],
    [/\s*\b(period|full stop)\b/gi, '.'],
    [/\s*\bopen quote\b\s*/gi, ' “'],
    [/\s*\b(close|end) quote\b/gi, '”'],
  ],
}

/** Texte reconnu → texte écrit : ponctuation dite, majuscule en début de phrase. */
export function spokenToText(text: string, lang: string, sentenceStart: boolean): string {
  const l = lang.startsWith('fr') ? 'fr' : 'en'
  let s = text.trim()
  for (const [re, rep] of COMMANDS[l]) s = s.replace(re, rep)
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n')
  // Majuscule après un point, au début d'une phrase ou d'un paragraphe.
  s = s.replace(/([.!?…]\s+|\n)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase())
  if (sentenceStart) s = s.replace(/^(\p{Ll})/u, (c) => c.toLocaleUpperCase())
  return s
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

const ctor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canDictate = (): boolean => typeof window !== 'undefined' && !!ctor()

export interface DictationHooks {
  /** Un morceau de phrase terminé, à écrire. */
  onFinal: (text: string) => void
  /** Ce qui est en train d'être reconnu (affiché, pas écrit). */
  onInterim: (text: string) => void
  /** Fin de la dictée (arrêt, silence prolongé, erreur). */
  onEnd: (error?: string) => void
}

/** Une dictée en cours : écoute en continu jusqu'à l'arrêt. */
export class Dictation {
  private rec: RecognitionLike
  private stopped = false

  constructor(
    lang: string,
    private hooks: DictationHooks,
  ) {
    const C = ctor()
    if (!C) throw new Error('unsupported')
    this.rec = new C()
    this.rec.lang = lang
    this.rec.continuous = true
    this.rec.interimResults = true
    this.rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) this.hooks.onFinal(text)
        else interim += text
      }
      this.hooks.onInterim(interim)
    }
    let error: string | undefined
    this.rec.onerror = (e) => {
      error = e.error
    }
    this.rec.onend = () => {
      // Chrome s'arrête après un silence : on reprend tant que l'utilisateur n'a pas arrêté.
      if (!this.stopped && !error) {
        try {
          this.rec.start()
          return
        } catch {
          /* déjà relancée */
        }
      }
      this.hooks.onEnd(error)
    }
  }

  start(): void {
    this.rec.start()
  }

  stop(): void {
    this.stopped = true
    this.rec.stop()
  }
}
