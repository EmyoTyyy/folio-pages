#!/usr/bin/env python3
# Allège les polices embarquées (src/fonts/*.woff2), sur place.
#
# - graisses 400 à 700 seulement : le document ne connaît que normal et gras, l'interface
#   n'utilise rien d'autre ; l'axe variable est réduit à cet intervalle ;
# - fonctions OpenType utiles au texte courant seulement (crénage, ligatures standard,
#   diacritiques, variantes locales) : ni fractions, ni chiffres tabulaires, ni les
#   ligatures de code de JetBrains Mono (« != » resterait « != » dans un document) ;
# - pas de noms de glyphes ni d'instructions de rendu ; noms de la police et licence gardés.
#
# Les caractères couverts ne changent pas. Relancer le script sur des polices déjà
# allégées ne change rien. Demande fontTools (et brotli pour le WOFF2).

import glob
import io
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEIGHTS = (400, 700)
FEATURES = ['kern', 'liga', 'clig', 'locl', 'ccmp', 'rvrn', 'mark', 'mkmk']
# Copyright, famille, style, identifiant, nom complet, version, nom PostScript, licence et son adresse.
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 13, 14]


def slim(path: str) -> tuple[int, int]:
    before = os.path.getsize(path)
    font = TTFont(path)
    options = subset.Options()
    options.glyph_names = False
    options.hinting = False
    options.name_IDs = NAME_IDS
    options.layout_features = FEATURES
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(unicodes=list(font.getBestCmap().keys()))
    sub.subset(font)
    # Rechargée avant de réduire l'axe (fontTools lit gvar à la demande).
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    buf.seek(0)
    font = TTFont(buf)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': WEIGHTS}, updateFontNames=False)
    font.flavor = 'woff2'
    font.save(path)
    return before, os.path.getsize(path)


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'src', 'fonts')
    total = [0, 0]
    for p in sorted(glob.glob(os.path.join(root, '*.woff2'))):
        a, b = slim(p)
        total[0] += a
        total[1] += b
        print(f'{os.path.basename(p):45s} {a / 1024:6.1f} Ko -> {b / 1024:6.1f} Ko')
    print(f'total {total[0] / 1024:.1f} Ko -> {total[1] / 1024:.1f} Ko')
