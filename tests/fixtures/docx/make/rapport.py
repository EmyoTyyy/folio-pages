"""Rapport de test écrit avec python-docx (MIT), dont le gabarit vient d'un
vrai traitement de texte : styles, thème et numérotation « comme en vrai ».

    python rapport.py ../rapport.docx
"""
import struct
import sys
import zlib

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_COLOR_INDEX
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor


def png(width, height, rgb):
    """Petite image PNG unie, sans dépendance."""
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def field(paragraph, instr):
    """Champ complexe (début, instruction, séparateur, résultat, fin), comme un traitement de texte l'écrit."""
    for kind, text in (("begin", None), (None, instr), ("separate", None), ("result", "1"), ("end", None)):
        run = paragraph.add_run()
        if kind in ("begin", "separate", "end"):
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
            run._r.append(el)
        elif kind == "result":
            run.text = text
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
            run._r.append(el)


def hyperlink(paragraph, url, text):
    rid = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    style = OxmlElement("w:rStyle")
    style.set(qn("w:val"), "Hyperlink")
    rpr.append(style)
    run.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


def main(out):
    import io

    doc = Document()
    props = doc.core_properties
    props.title = "Rapport d'activité 2025"
    props.author = "Camille Besnard"
    props.subject = "Bilan annuel"
    props.keywords = "bilan, activité; atelier"

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(25)
    sec.top_margin = sec.bottom_margin = Mm(20)
    head = sec.header.paragraphs[0]
    head.text = "Atelier des Tilleuls"
    head.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    foot = sec.footer.paragraphs[0]
    foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    foot.add_run("Page ")
    field(foot, " PAGE ")
    foot.add_run(" sur ")
    field(foot, " NUMPAGES ")

    doc.add_paragraph("Rapport d'activité 2025", style="Title")
    doc.add_paragraph("Atelier des Tilleuls — bilan annuel", style="Subtitle")
    doc.add_heading("Résumé", level=1)
    p = doc.add_paragraph("L'année a été ")
    p.add_run("très bonne").bold = True
    p.add_run(" pour l'atelier : ")
    p.add_run("312 stagiaires").italic = True
    p.add_run(" accueillis, soit ")
    r = p.add_run("+18 %")
    r.font.color.rgb = RGBColor(0x1E, 0x6B, 0x55)
    r.bold = True
    p.add_run(" par rapport à 2024. Le détail est sur ")
    hyperlink(p, "https://exemple.org/bilan?annee=2025&vue=detail", "le site de l'atelier")
    p.add_run(".")
    q = doc.add_paragraph("Texte ")
    q.add_run("souligné").underline = True
    q.add_run(", ")
    q.add_run("barré").font.strike = True
    q.add_run(", ")
    q.add_run("surligné").font.highlight_color = WD_COLOR_INDEX.YELLOW
    q.add_run(", H")
    q.add_run("2").font.subscript = True
    q.add_run("O, m")
    q.add_run("2").font.superscript = True
    q.add_run(", ")
    big = q.add_run("grand")
    big.font.size = Pt(16)
    big.font.name = "Georgia"
    q.add_run(" et ")
    q.add_run("petites capitales").font.small_caps = True
    q.add_run(".")
    centered = doc.add_paragraph("Un paragraphe centré, avec un retour\nà la ligne.")
    centered.alignment = WD_ALIGN_PARAGRAPH.CENTER
    centered.paragraph_format.space_before = Pt(12)
    centered.paragraph_format.left_indent = Pt(36)

    doc.add_heading("Activités", level=1)
    doc.add_heading("Stages", level=2)
    for item in ("Menuiserie", "Reliure", "Céramique"):
        doc.add_paragraph(item, style="List Bullet")
    doc.add_paragraph("Tournage", style="List Bullet 2")
    doc.add_paragraph("Émaillage", style="List Bullet 2")
    doc.add_heading("Calendrier", level=2)
    for item in ("Inscriptions en janvier", "Stages de février à juin", "Exposition en septembre"):
        doc.add_paragraph(item, style="List Number")
    doc.add_paragraph("Citation : « on apprend en faisant ».", style="Quote")

    doc.add_heading("Chiffres", level=1)
    table = doc.add_table(rows=4, cols=3)
    table.style = "Light Grid Accent 1"
    for i, label in enumerate(("Stage", "Inscrits", "Recettes")):
        table.rows[0].cells[i].text = label
    data = (("Menuiserie", "120", "14 400 €"), ("Reliure", "92", "8 280 €"))
    for r_i, row in enumerate(data, start=1):
        for c_i, value in enumerate(row):
            table.rows[r_i].cells[c_i].text = value
    total = table.rows[3].cells[0].merge(table.rows[3].cells[1])
    total.text = "Total"
    table.rows[3].cells[2].text = "22 680 €"
    doc.add_paragraph()
    plain = doc.add_table(rows=2, cols=2)
    plain.style = "Table Grid"
    plain.rows[0].cells[0].text = "Haut gauche"
    plain.rows[0].cells[1].text = "Haut droite"
    tall = plain.rows[0].cells[0].merge(plain.rows[1].cells[0])
    tall.text = "Fusion verticale"
    plain.rows[1].cells[1].text = "Bas droite"

    doc.add_heading("Atelier en image", level=1)
    doc.add_picture(io.BytesIO(png(120, 80, (30, 107, 85))), width=Mm(60))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph("Figure 1 — La salle de reliure", style="Caption")
    note = doc.add_paragraph("Un passage commenté par la direction.")
    doc.add_comment(note.runs[0], text="À confirmer avec la comptabilité.", author="Noé Laurent", initials="NL")
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    land = doc.add_section(WD_SECTION.NEW_PAGE)
    land.orientation = WD_ORIENT.LANDSCAPE
    land.page_width, land.page_height = Mm(297), Mm(210)
    doc.add_heading("Annexe", level=1)
    doc.add_paragraph("Cette annexe est en paysage.")
    doc.save(out)


if __name__ == "__main__":
    main(sys.argv[1])
