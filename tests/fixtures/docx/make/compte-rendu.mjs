// Compte rendu de test écrit « à la main », dans le dialecte d'un traitement
// de texte de bureau : table des matières dans un bloc de contenu, champs
// complexes, réponses aux commentaires, suivi des modifications, zones de
// texte, équation, image non affichable, sections… Tout ce qu'un import doit
// savoir lire ou signaler.
//
//     node compte-rendu.mjs ../compte-rendu.docx

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { strToU8, zipSync } from 'fflate'

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:o="urn:schemas-microsoft-com:office:office"'
const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

function crc(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function png(w, h, rgb) {
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from(rgb))])))
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const p = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const fld = (instr, result) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`

const picture = (rid, cx, cy, extra = '') =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Image 1" descr="Schéma du réseau"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="schema.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${rid}"/>${extra}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`

const textbox =
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1800000" cy="600000"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="7" name="Zone de texte 7"/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr/><wps:txbx><w:txbxContent>${p(r('À retenir : la réunion suivante est le 14 mai.'))}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:shape style="width:141pt;height:47pt"><v:textbox><w:txbxContent>${p(r('À retenir : la réunion suivante est le 14 mai.'))}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`

const cell = (inner, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${inner}</w:tc>`
const lineBorders = '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:left w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'

const body =
  // Page de garde
  p(r('Compte rendu de réunion'), '<w:pStyle w:val="Titre"/>') +
  p(r('Comité de pilotage — ') + fld('DATE \\@ "d MMMM yyyy"', r('12 avril 2026')), '<w:pStyle w:val="Sous-titre"/>') +
  // Table des matières dans un bloc de contenu, entrées en cache
  `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>` +
  p(r('Sommaire'), '<w:pStyle w:val="En-ttedetabledesmatires"/>') +
  p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` + `<w:hyperlink w:anchor="_Toc1">${r('1 Décisions')}<w:r><w:tab/></w:r>${r('2')}</w:hyperlink>`, '<w:pStyle w:val="TM1"/>') +
  p(`<w:hyperlink w:anchor="_Toc2">${r('2 Budget')}<w:r><w:tab/></w:r>${r('3')}</w:hyperlink>`, '<w:pStyle w:val="TM1"/>') +
  p('<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
  `</w:sdtContent></w:sdt>` +
  // Titres numérotés
  p('<w:bookmarkStart w:id="1" w:name="_Toc1"/>' + r('Décisions') + '<w:bookmarkEnd w:id="1"/>', '<w:pStyle w:val="Titre1"/>') +
  p(
    r('Le comité valide le ') +
      `<w:ins w:id="10" w:author="Inès Faure" w:date="2026-04-12T15:02:00Z">${r('nouveau ')}</w:ins>` +
      r('calendrier') +
      `<w:del w:id="11" w:author="Inès Faure" w:date="2026-04-12T15:03:00Z"><w:r><w:delText xml:space="preserve"> provisoire</w:delText></w:r></w:del>` +
      r('.') +
      '<w:r><w:rPr><w:rStyle w:val="Appelnotedebasdep"/></w:rPr><w:footnoteReference w:id="2"/></w:r>' +
      r(' Voir aussi l’annexe') +
      '<w:r><w:rPr><w:rStyle w:val="Appeldenotedefin"/></w:rPr><w:endnoteReference w:id="2"/></w:r>' +
      r('.'),
  ) +
  p(
    '<w:commentRangeStart w:id="0"/>' + r('Le prestataire sera choisi en juin') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' +
      '<w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>' +
      r(', après ') + r('trois', '<w:b/><w:color w:val="C0504D" w:themeColor="accent2"/>') + r(' auditions ; commande ') + r('npm run build', '<w:rStyle w:val="CodeHTML"/>') + r('.'),
  ) +
  p(r('Un commentaire sans étendue') + '<w:r><w:commentReference w:id="2"/></w:r>' + r(' et du texte ') + r('masqué', '<w:vanish/>') + r('visible.')) +
  // Liste numérotée sur deux niveaux, coupée par un paragraphe, puis reprise
  p(r('Lancer la consultation'), '<w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
  p(r('Rédiger le cahier des charges'), '<w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>') +
  p(r('Publier l’annonce'), '<w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>') +
  p(r('Auditionner les candidats'), '<w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
  p(r('(Les auditions durent une heure.)'), '<w:ind w:left="720"/>') +
  p(r('Choisir'), '<w:pStyle w:val="Paragraphedeliste"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
  p(r('Une autre liste, qui recommence à 1'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>') +
  p(r('Point libre'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
  p(r('Fl') + '<w:r><w:sym w:font="Wingdings" w:char="F0E0"/></w:r>' + r('èche, demi') + '<w:r><w:noBreakHyphen/></w:r>' + r('journée, ') + '<w:r><w:sym w:font="Symbol" w:char="00B1"/></w:r>' + r('2 jours.')) +
  p(r('Note importante pour le comité.'), '<w:pStyle w:val="Encadr"/>') +
  // Équation, zone de texte, lien dangereux, champ inconnu
  p(r('Coût par usager : ') + '<m:oMath><m:f><m:num><m:r><m:t>C</m:t></m:r></m:num><m:den><m:r><m:t>n</m:t></m:r></m:den></m:f><m:r><m:t>=42</m:t></m:r></m:oMath>' + r(' euros.')) +
  p(r('Un encadré flotte ici.') + textbox) +
  p(`<w:hyperlink r:id="rIdEvil">${r('lien douteux')}</w:hyperlink>` + r(' ; ') + fld('HYPERLINK "https://exemple.org/pilotage"', r('lien par champ', '<w:rStyle w:val="Lienhypertexte"/>')) + r(' ; fusion : ') + fld('MERGEFIELD Prenom', r('«Prenom»')) + r(' ; ') + `<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>Inès Faure</w:t></w:r></w:fldSimple>`) +
  p(r('Avant le saut.') + '<w:r><w:br w:type="page"/></w:r>' + r('Après le saut.')) +
  // Section à deux colonnes
  p('', '<w:sectPr><w:headerReference w:type="first" r:id="rIdH1"/><w:headerReference w:type="default" r:id="rIdH2"/><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:pgNumType w:fmt="lowerRoman" w:start="3"/><w:titlePg/></w:sectPr>') +
  p('<w:bookmarkStart w:id="2" w:name="_Toc2"/>' + r('Budget') + '<w:bookmarkEnd w:id="2"/>', '<w:pStyle w:val="Titre1"/>') +
  p(r('Texte sur deux colonnes, première partie.')) +
  p('<w:r><w:br w:type="column"/></w:r>' + r('Deuxième colonne.')) +
  p('', '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:num="2" w:space="567" w:sep="1"/></w:sectPr>') +
  // Tableau : bordures portées par les cellules (traits horizontaux), fusion verticale, ligne d'en-tête répétée
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(p(r('Poste', '<w:b/>')), lineBorders)}${cell(p(r('2025', '<w:b/>')), lineBorders)}${cell(p(r('2026', '<w:b/>')), lineBorders)}</w:tr>` +
  `<w:tr>${cell(p(r('Matériel')), '<w:vMerge w:val="restart"/><w:vAlign w:val="center"/>' + lineBorders)}${cell(p(r('1 200')), lineBorders)}${cell(p(r('1 450')), '<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>' + lineBorders)}</w:tr>` +
  `<w:tr>${cell(p(''), '<w:vMerge/>' + lineBorders)}${cell(p(r('dont location : 300')), '<w:gridSpan w:val="2"/>' + lineBorders)}</w:tr>` +
  `</w:tbl>` +
  p(picture('rIdImg', 1905000, 952500, '<a:srcRect l="10000" r="10000"/>'), '<w:jc w:val="center"/>') +
  p(r('Figure 1 : schéma du réseau'), '<w:pStyle w:val="Lgende"/>') +
  p(picture('rIdEmf', 952500, 952500)) +
  p('<w:r><w:pict><v:shape style="width:60pt;height:40pt"><v:imagedata r:id="rIdImg" o:title="Logo"/></v:shape></w:pict></w:r>') +
  p('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>') +
  p(r('print("bonjour")'), '<w:pStyle w:val="Codesource"/>') +
  p(r('  return 1'), '<w:pStyle w:val="Codesource"/>') +
  p(r('Fin du compte rendu.'), '<w:jc w:val="both"/><w:spacing w:before="240" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="284"/>') +
  '<w:sectPr><w:type w:val="oddPage"/><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:pgNumType w:start="1"/></w:sectPr>'

const style = (id, name, extra, type = 'paragraph', attrs = '') => `<w:style w:type="${type}" w:styleId="${id}"${attrs}><w:name w:val="${name}"/>${extra}</w:style>`
const styles =
  `${head}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  style('Normal', 'Normal', '<w:qFormat/>', 'paragraph', ' w:default="1"') +
  style('Titre1', 'heading 1', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:numPr><w:numId w:val="4"/></w:numPr><w:spacing w:before="360" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="0F4761" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="40"/></w:rPr>') +
  style('Titre', 'Title', '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:spacing w:val="-10"/><w:sz w:val="56"/></w:rPr>') +
  style('Sous-titre', 'Subtitle', '<w:basedOn w:val="Normal"/><w:rPr><w:color w:val="595959"/><w:sz w:val="28"/></w:rPr>') +
  style('En-ttedetabledesmatires', 'TOC Heading', '<w:basedOn w:val="Titre1"/><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr><w:outlineLvl w:val="9"/></w:pPr>') +
  style('TM1', 'toc 1', '<w:basedOn w:val="Normal"/>') +
  style('Paragraphedeliste', 'List Paragraph', '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr>') +
  style('Lgende', 'caption', '<w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="0E2841" w:themeColor="text2"/><w:sz w:val="18"/></w:rPr>') +
  style('Codesource', 'Source Code', '<w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>') +
  style('Encadr', 'Encadré', '<w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="156082"/><w:left w:val="single" w:sz="4" w:color="156082"/><w:bottom w:val="single" w:sz="4" w:color="156082"/><w:right w:val="single" w:sz="4" w:color="156082"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="E8F1F5"/><w:ind w:left="284" w:right="284"/></w:pPr><w:rPr><w:b/></w:rPr>', 'paragraph', ' w:customStyle="1"') +
  style('Notedebasdepage', 'footnote text', '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>') +
  style('Policepardfaut', 'Default Paragraph Font', '', 'character', ' w:default="1"') +
  style('Appelnotedebasdep', 'footnote reference', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', 'character') +
  style('Appeldenotedefin', 'endnote reference', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', 'character') +
  style('Lienhypertexte', 'Hyperlink', '<w:rPr><w:color w:val="467886" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr>', 'character') +
  style('CodeHTML', 'HTML Code', '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr>', 'character') +
  `</w:styles>`

const lvl = (i, fmt, text, left) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`
const numbering =
  `${head}<w:numbering ${W}>` +
  `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'decimal', '%1.', 720)}${lvl(1, 'lowerLetter', '%2.', 1440)}${lvl(2, 'lowerRoman', '%3.', 2160)}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="–"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1', 432)}${lvl(1, 'decimal', '%1.%2', 576)}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
  `<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num><w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num></w:numbering>`

const sep = (tag, ref) =>
  `<w:${tag} w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>` +
  `<w:${tag} w:id="2"><w:p><w:pPr><w:pStyle w:val="Notedebasdepage"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Appelnotedebasdep"/></w:rPr><w:${ref}/></w:r>`
const footnotes = `${head}<w:footnotes ${W}>${sep('footnote', 'footnoteRef')}${r(' Adopté à l’unanimité, voir ')}<w:hyperlink r:id="rIdN"><w:r><w:t>le relevé</w:t></w:r></w:hyperlink>${r('.')}</w:p></w:footnote></w:footnotes>`
const endnotes = `${head}<w:endnotes ${W}>${sep('endnote', 'endnoteRef')}${r(' Annexe B, page 4.')}</w:p></w:endnote></w:endnotes>`

const comment = (id, author, date, para, text) => `<w:comment w:id="${id}" w:author="${author}" w:date="${date}" w:initials="X"><w:p w14:paraId="${para}"><w:r><w:annotationRef/></w:r>${r(text)}</w:p></w:comment>`
const comments =
  `${head}<w:comments ${W}>` +
  comment(0, 'Marc Aubry', '2026-04-13T08:00:00Z', '1A2B3C4D', 'Juin ou juillet ?') +
  comment(1, 'Inès Faure', '2026-04-13T09:30:00Z', '2B3C4D5E', 'Juin, c’est acté.') +
  `<w:comment w:id="2" w:author="Marc Aubry" w:date="2026-04-14T10:00:00Z" w:initials="MA"><w:p w14:paraId="3C4D5E6F">${r('Premier paragraphe.')}</w:p><w:p w14:paraId="4D5E6F70">${r('Second paragraphe.')}</w:p></w:comment>` +
  `</w:comments>`
const commentsExtended = `${head}<w15:commentsEx ${W}><w15:commentEx w15:paraId="1A2B3C4D" w15:done="1"/><w15:commentEx w15:paraId="2B3C4D5E" w15:paraIdParent="1A2B3C4D" w15:done="1"/><w15:commentEx w15:paraId="4D5E6F70" w15:done="0"/></w15:commentsEx>`

const theme =
  `${head}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Thème Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4><a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"/></a:themeElements></a:theme>`

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rel = (id, type, target, ext = false) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`
const rels = (inner) => `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`

const files = {
  '[Content_Types].xml':
    `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/>` +
    ['document.main', 'styles', 'numbering', 'footnotes', 'endnotes', 'comments', 'settings']
      .map((n) => `<Override PartName="/word/${n === 'document.main' ? 'document' : n}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n}+xml"/>`)
      .join('') +
    `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
    `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  '_rels/.rels': rels(rel('rId1', 'officeDocument', 'word/document.xml') + rel('rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml') + rel('rId3', 'extended-properties', 'docProps/app.xml')),
  'docProps/core.xml': `${head}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Compte rendu &amp; décisions</dc:title><dc:creator>Inès Faure</dc:creator><cp:keywords>pilotage; budget</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">2026-04-12T14:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-04-14T10:05:00Z</dcterms:modified></cp:coreProperties>`,
  'docProps/app.xml': `${head}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Traitement de texte</Application><Company>Syndicat des eaux</Company></Properties>`,
  'word/document.xml': `${head}<w:document ${W} mc:Ignorable="w14 w15"><w:body>${body}</w:body></w:document>`,
  'word/_rels/document.xml.rels': rels(
    rel('rId1', 'styles', 'styles.xml') + rel('rId2', 'numbering', 'numbering.xml') + rel('rId3', 'footnotes', 'footnotes.xml') + rel('rId4', 'endnotes', 'endnotes.xml') + rel('rId5', 'comments', 'comments.xml') +
      rel('rId6', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', 'commentsExtended.xml') + rel('rId7', 'theme', 'theme/theme1.xml') + rel('rId8', 'settings', 'settings.xml') +
      rel('rIdH1', 'header', 'header1.xml') + rel('rIdH2', 'header', 'header2.xml') + rel('rIdF1', 'footer', 'footer1.xml') + rel('rIdImg', 'image', 'media/image1.png') + rel('rIdEmf', 'image', 'media/image2.emf') +
      rel('rIdEvil', 'hyperlink', 'javascript:alert(document.domain)', true),
  ),
  'word/_rels/footnotes.xml.rels': rels(rel('rIdN', 'hyperlink', 'https://exemple.org/releve', true)),
  'word/styles.xml': styles,
  'word/numbering.xml': numbering,
  'word/footnotes.xml': footnotes,
  'word/endnotes.xml': endnotes,
  'word/comments.xml': comments,
  'word/commentsExtended.xml': commentsExtended,
  'word/settings.xml': `${head}<w:settings ${W}><w:trackRevisions/><w:evenAndOddHeaders w:val="0"/><w:footnotePr><w:numFmt w:val="chicago"/><w:numRestart w:val="eachPage"/></w:footnotePr><w:endnotePr><w:numFmt w:val="decimal"/></w:endnotePr><w:themeFontLang w:val="fr-FR"/></w:settings>`,
  'word/theme/theme1.xml': theme,
  'word/header1.xml': `${head}<w:hdr ${W}>${p('')}</w:hdr>`,
  'word/header2.xml': `${head}<w:hdr ${W}>${p(r('Comité de pilotage') + '<w:r><w:tab/></w:r>' + fld('PAGE', r('3')), '<w:tabs><w:tab w:val="right" w:pos="9072"/></w:tabs>')}</w:hdr>`,
  'word/footer1.xml': `${head}<w:ftr ${W}>${p(r('Syndicat des eaux — ') + fld('NUMPAGES', r('5')) + r(' pages'), '<w:jc w:val="center"/>')}</w:ftr>`,
}
const zipped = {}
for (const [k, v] of Object.entries(files)) zipped[k] = strToU8(v)
zipped['word/media/image1.png'] = new Uint8Array(png(200, 100, [21, 96, 130]))
// Un métafichier (EMF) : une image que les navigateurs n'affichent pas.
zipped['word/media/image2.emf'] = new Uint8Array([1, 0, 0, 0, 108, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 99, 0, 0, 0, 99, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 69, 77, 70])
writeFileSync(process.argv[2], zipSync(zipped, { level: 6, mtime: new Date('2026-04-14T10:05:00Z') }))
