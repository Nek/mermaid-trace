"""Reproduce the bundled sbix fallback from the pinned Noto font (FontTools 4.60.1)."""
import hashlib
from pathlib import Path
import sys

import fontTools
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.sbixStrike import Strike
from fontTools.ttLib.tables.sbixGlyph import Glyph

source, destination = map(Path, sys.argv[1:])
assert fontTools.__version__ == '4.60.1', 'Use the pinned FontTools version'
assert hashlib.sha256(source.read_bytes()).hexdigest() == '2c7ede2f5438f9c1da098778bd681535933a345334008bb03fc51119f6b1cd72', 'Unexpected upstream font'
font = TTFont(source, recalcTimestamp=False)
unchanged = {tag: font.getTableData(tag) for tag in ['GSUB', 'hmtx', 'cmap']}
sbix = newTable('sbix')
for size, bitmaps in zip(font['CBLC'].strikes, font['CBDT'].strikeData, strict=True):
    metrics = size.bitmapSizeTable
    assert metrics.ppemX == metrics.ppemY
    strike = Strike(ppem=metrics.ppemY, resolution=72)
    for name, bitmap in bitmaps.items():
        assert bitmap.imageData.startswith(b'\x89PNG\r\n\x1a\n')
        m = vars(bitmap.metrics)
        strike.glyphs[name] = Glyph(glyphName=name,
            originOffsetX=m.get('BearingX', m.get('horiBearingX')),
            originOffsetY=m.get('BearingY', m.get('horiBearingY')) - m['height'],
            graphicType='png ', imageData=bitmap.imageData)
    sbix.strikes[strike.ppem] = strike
font['sbix'] = sbix
del font['CBDT'], font['CBLC']
font.save(destination)
reopened = TTFont(destination)
for tag, data in unchanged.items():
    assert reopened.getTableData(tag) == data, f'{tag} changed during bitmap conversion'
for ppem, strike in sbix.strikes.items():
    for name, glyph in strike.glyphs.items():
        actual = reopened['sbix'].strikes[ppem].glyphs[name]
        assert actual.imageData == glyph.imageData
        assert (actual.originOffsetX, actual.originOffsetY) == (glyph.originOffsetX, glyph.originOffsetY)
assert hashlib.sha256(destination.read_bytes()).hexdigest() == '100363ed01d0926f912545d123ea3cb3d55a750748f8db0ce476bb1e242c34a9', 'Output is not reproducible'
