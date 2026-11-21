#!/usr/bin/env node
// Génère src/ui/iconset.ts : les icônes de Tabler Icons (MIT, © 2020-2026 Paweł Kuna)
// proposées par Insertion → Icônes, sans le cadre du fichier SVG, avec un libellé
// français et anglais (pour la recherche et le texte de remplacement).
//   node scripts/gen-icons.mjs
// La liste est ici ; le reste du jeu (plus de 5 000 icônes) se cherche en ligne.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'node_modules/@tabler/icons/icons/outline')

/** [catégorie, nom Tabler, français, anglais] */
const LIST = [
  ['people', 'user', 'personne', 'person'],
  ['people', 'users', 'groupe', 'people'],
  ['people', 'man', 'homme', 'man'],
  ['people', 'woman', 'femme', 'woman'],
  ['people', 'mood-smile', 'sourire', 'smile'],
  ['people', 'thumb-up', 'pouce levé', 'thumbs up'],
  ['people', 'heart', 'cœur', 'heart'],
  ['people', 'walk', 'marche', 'walk'],
  ['communication', 'mail', 'courriel', 'email'],
  ['communication', 'phone', 'téléphone', 'phone'],
  ['communication', 'message', 'message', 'message'],
  ['communication', 'bell', 'cloche', 'bell'],
  ['communication', 'send', 'envoyer', 'send'],
  ['communication', 'at', 'arobase', 'at sign'],
  ['communication', 'wifi', 'wi-fi', 'wifi'],
  ['communication', 'world', 'monde', 'world'],
  ['work', 'briefcase', 'mallette', 'briefcase'],
  ['work', 'school', 'école', 'school'],
  ['work', 'book', 'livre', 'book'],
  ['work', 'pencil', 'crayon', 'pencil'],
  ['work', 'clipboard-check', 'liste vérifiée', 'checklist'],
  ['work', 'presentation', 'présentation', 'presentation'],
  ['work', 'chart-bar', 'graphique en barres', 'bar chart'],
  ['work', 'chart-pie', 'graphique en secteurs', 'pie chart'],
  ['work', 'calculator', 'calculatrice', 'calculator'],
  ['work', 'calendar', 'calendrier', 'calendar'],
  ['work', 'clock', 'horloge', 'clock'],
  ['work', 'target', 'cible', 'target'],
  ['work', 'trophy', 'trophée', 'trophy'],
  ['work', 'bulb', 'idée', 'idea'],
  ['work', 'puzzle', 'puzzle', 'puzzle'],
  ['work', 'flag', 'drapeau', 'flag'],
  ['work', 'rocket', 'fusée', 'rocket'],
  ['places', 'home', 'maison', 'home'],
  ['places', 'building', 'immeuble', 'building'],
  ['places', 'map-pin', 'lieu', 'location'],
  ['places', 'compass', 'boussole', 'compass'],
  ['places', 'plane', 'avion', 'plane'],
  ['places', 'car', 'voiture', 'car'],
  ['places', 'bus', 'bus', 'bus'],
  ['places', 'bike', 'vélo', 'bike'],
  ['nature', 'sun', 'soleil', 'sun'],
  ['nature', 'moon', 'lune', 'moon'],
  ['nature', 'cloud', 'nuage', 'cloud'],
  ['nature', 'cloud-rain', 'pluie', 'rain'],
  ['nature', 'snowflake', 'flocon', 'snowflake'],
  ['nature', 'leaf', 'feuille', 'leaf'],
  ['nature', 'tree', 'arbre', 'tree'],
  ['nature', 'flower', 'fleur', 'flower'],
  ['nature', 'droplet', 'goutte', 'drop'],
  ['nature', 'flame', 'flamme', 'flame'],
  ['nature', 'recycle', 'recyclage', 'recycle'],
  ['nature', 'paw', 'patte', 'paw'],
  ['objects', 'device-laptop', 'ordinateur portable', 'laptop'],
  ['objects', 'device-mobile', 'téléphone portable', 'mobile phone'],
  ['objects', 'camera', 'appareil photo', 'camera'],
  ['objects', 'music', 'musique', 'music'],
  ['objects', 'movie', 'film', 'film'],
  ['objects', 'gift', 'cadeau', 'gift'],
  ['objects', 'shopping-cart', 'panier', 'shopping cart'],
  ['objects', 'coin', 'pièce', 'coin'],
  ['objects', 'key', 'clé', 'key'],
  ['objects', 'lock', 'cadenas', 'lock'],
  ['objects', 'shield-check', 'sécurité', 'security'],
  ['objects', 'tool', 'outil', 'tool'],
  ['objects', 'settings', 'réglages', 'settings'],
  ['objects', 'search', 'loupe', 'search'],
  ['objects', 'printer', 'imprimante', 'printer'],
  ['symbols', 'check', 'coche', 'check'],
  ['symbols', 'x', 'croix', 'cross'],
  ['symbols', 'alert-triangle', 'attention', 'warning'],
  ['symbols', 'info-circle', 'information', 'information'],
  ['symbols', 'help-circle', 'question', 'question'],
  ['symbols', 'star', 'étoile', 'star'],
  ['symbols', 'plus', 'plus', 'plus'],
  ['symbols', 'minus', 'moins', 'minus'],
  ['symbols', 'arrow-right', 'flèche droite', 'arrow right'],
  ['symbols', 'arrow-up', 'flèche haut', 'arrow up'],
  ['symbols', 'refresh', 'actualiser', 'refresh'],
  ['science', 'stethoscope', 'stéthoscope', 'stethoscope'],
  ['science', 'pill', 'médicament', 'pill'],
  ['science', 'first-aid-kit', 'trousse de secours', 'first aid kit'],
  ['science', 'atom', 'atome', 'atom'],
  ['science', 'flask', 'fiole', 'flask'],
  ['science', 'dna', 'ADN', 'DNA'],
  ['science', 'microscope', 'microscope', 'microscope'],
  ['science', 'brain', 'cerveau', 'brain'],
  ['food', 'coffee', 'café', 'coffee'],
  ['food', 'apple', 'pomme', 'apple'],
  ['food', 'tools-kitchen-2', 'couverts', 'cutlery'],
]

const out = LIST.map(([cat, id, fr, en]) => {
  const svg = readFileSync(join(dir, `${id}.svg`), 'utf8')
  // Le contenu seul, sans le carré invisible de mise en page ni les espaces.
  const body = [...svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>/g)]
    .map((m) => m[0])
    .filter((el) => !/stroke="none"/.test(el))
    .map((el) => el.replace(/\s+/g, ' ').replace(/ \/>$/, '/>'))
    .join('')
  if (!body) throw new Error(`icône vide : ${id}`)
  return `  [${JSON.stringify(cat)}, ${JSON.stringify(id)}, ${JSON.stringify(fr)}, ${JSON.stringify(en)}, ${JSON.stringify(body)}],`
})

writeFileSync(
  join(root, 'src/ui/iconset.ts'),
  `// Fichier généré par scripts/gen-icons.mjs : ne pas modifier à la main.
// Icônes de Tabler Icons (https://tabler.io/icons), licence MIT, © 2020-2026 Paweł Kuna.

/** [catégorie, nom, libellé français, libellé anglais, contenu SVG (24 × 24, trait)] */
export const ICON_SET: readonly [string, string, string, string, string][] = [
${out.join('\n')}
]
`,
)
console.log(`src/ui/iconset.ts : ${LIST.length} icônes`)
