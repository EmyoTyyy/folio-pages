// Point d'entrée du module .docx compilé à part : il se publie lui-même, pour
// être trouvé quel que soit le moyen par lequel son code a été exécuté.

import * as mod from './index'

;(globalThis as unknown as { FolioDocx?: typeof mod }).FolioDocx = mod
