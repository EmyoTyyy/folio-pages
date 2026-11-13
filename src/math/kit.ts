// Le moteur d'équations prêté au module .docx (compilé à part) : il s'en sert
// sans en embarquer une seconde copie.

import type { MathKit } from '../docx/omml'
import { labelOf, parseTex } from './index'
import { byGlyph, FUNCTIONS, LIMIT_FUNCTIONS } from './symbols'

export const mathKit: MathKit = {
  parse: (tex, display, ctx) => parseTex(tex, display, ctx),
  labelOf,
  glyph: (ch) => byGlyph.get(ch)?.tex,
  functions: new Set([...FUNCTIONS, ...LIMIT_FUNCTIONS]),
}
