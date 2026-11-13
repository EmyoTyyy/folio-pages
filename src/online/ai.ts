// Demander à une IA (Claude, ChatGPT) dans une fenêtre à côté du document.
//
// Ces sites refusent d'être affichés dans une autre page (X-Frame-Options,
// frame-ancestors) : Folio Pages ouvre donc leur site dans une fenêtre à part,
// avec la demande et le document copiés dans le presse-papiers (et dans
// l'adresse quand ils sont assez courts). La réponse revient par un collage :
// un document JSON remplace le document (annulable), du Markdown remplace la
// sélection. Rien ne part sans le geste de l'utilisateur ; aucune clé.

export const AI_SITES = {
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
} as const
export type AiSite = keyof typeof AI_SITES

/** Au-delà, l'adresse serait refusée ou tronquée : la demande passe seulement par le presse-papiers. */
export const MAX_URL_PROMPT = 6000

const GUIDE = 'https://emyotyyy.github.io/folio-pages/agents.md'

export interface PromptInput {
  request: string
  /** Le document en JSON compact (tout le document). */
  json?: string
  /** Le passage sélectionné, en texte (au lieu du document). */
  selection?: string
  lang: string
}

/** La demande envoyée à l'IA : la consigne, ce qu'on attend en retour, puis le contenu. */
export function buildPrompt(o: PromptInput): string {
  const fr = o.lang.startsWith('fr')
  const request = o.request.trim().slice(0, 4000)
  if (o.selection !== undefined) {
    return fr
      ? `${request}\n\nVoici le passage concerné, extrait d’un document Folio Pages. Réponds avec le passage réécrit en Markdown, dans un seul bloc \`\`\`markdown, sans commentaire autour.\n\n\`\`\`markdown\n${o.selection}\n\`\`\``
      : `${request}\n\nHere is the passage, from a Folio Pages document. Reply with the rewritten passage in Markdown, in a single \`\`\`markdown block, with no comment around it.\n\n\`\`\`markdown\n${o.selection}\n\`\`\``
  }
  return fr
    ? `${request}\n\nVoici le document, au format JSON de Folio Pages (format « folio/doc », version 1 ; guide : ${GUIDE}). Réponds avec le document complet mis à jour, dans le même format, dans un seul bloc \`\`\`json. Garde telles quelles les références « asset:… » des images. Utilise de vrais titres (type « heading »), des tableaux pour les données, des équations LaTeX.\n\n\`\`\`json\n${o.json ?? ''}\n\`\`\``
    : `${request}\n\nHere is the document, in Folio Pages JSON (format "folio/doc", version 1; guide: ${GUIDE}). Reply with the complete updated document, in the same format, in a single \`\`\`json block. Keep "asset:…" image references as they are. Use real headings (type "heading"), tables for data, LaTeX equations.\n\n\`\`\`json\n${o.json ?? ''}\n\`\`\``
}

/** Adresse du site, avec la demande quand elle est assez courte ; sinon le site seul (la demande est à coller). */
export function siteUrl(site: AiSite, prompt: string): { url: string; prefilled: boolean } {
  const base = AI_SITES[site].url
  const q = encodeURIComponent(prompt)
  if (q.length <= MAX_URL_PROMPT) return { url: `${base}?q=${q}`, prefilled: true }
  return { url: base, prefilled: false }
}

export type AiAnswer = { kind: 'json'; json: string } | { kind: 'markdown'; md: string }

/** La réponse collée : un document JSON (bloc ```json ou objet nu), sinon du Markdown (bloc ```markdown ou texte). */
export function extractAnswer(text: string): AiAnswer | null {
  const s = text.replace(/\r\n?/g, '\n').trim().slice(0, 50_000_000)
  if (!s) return null
  const fence = (lang: string) => new RegExp('```' + lang + '[^\\n]*\\n([\\s\\S]*?)\\n```').exec(s)?.[1]
  const json = fence('json') ?? fence('JSON')
  const asDoc = (candidate: string | undefined) => {
    if (!candidate) return null
    const c = candidate.trim()
    if (!c.startsWith('{')) return null
    try {
      const v = JSON.parse(c)
      return v && typeof v === 'object' && ('blocks' in v || 'markdown' in v || v.format === 'folio/doc') ? c : null
    } catch {
      // Un JSON un peu abîmé : le chargeur sait réparer et dira ce qui a été ignoré.
      return /"(blocks|format)"\s*:/.test(c) ? c : null
    }
  }
  const doc = asDoc(json) ?? asDoc(s) ?? asDoc(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1))
  if (doc) return { kind: 'json', json: doc }
  const md = fence('markdown') ?? fence('md') ?? fence('')
  return { kind: 'markdown', md: (md ?? s).trim() }
}
