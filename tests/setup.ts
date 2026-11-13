// Node 18 n'expose pas encore `crypto` en global ; les navigateurs, si.
import { webcrypto } from 'node:crypto'

if (!(globalThis as { crypto?: unknown }).crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// Le moteur d'équations, prêté au module .docx comme le fait l'application.
import { useMath } from '../src/docx/omml'
import { mathKit } from '../src/math/kit'
useMath(mathKit)
