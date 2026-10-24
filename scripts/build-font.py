"""Builds Rustnuts Stencil: Stardos Stencil Bold (SIL OFL 1.1) made heavier and renamed.

The OFL reserves the names "Stardos" and "Stardos Stencil", so a modified version must carry
a new name. Run: python3 scripts/build-font.py <StardosStencil-Bold.ttf> <out.ttf> [extra-weight] [gap]
Needs: pip install fonttools skia-pathops
"""
import sys

import pathops
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FAMILY = "Rustnuts Stencil"
POSTSCRIPT = "RustnutsStencil-Regular"


def _op(a: pathops.Path, b: pathops.Path, how: pathops.PathOp) -> pathops.Path:
    """A path operation that retries on cleaned-up outlines, since Skia sometimes gives up on tiny slivers."""
    try:
        return pathops.op(a, b, how)
    except pathops.PathOpsError:
        return pathops.op(pathops.simplify(a), pathops.simplify(b), how)


def _grow(shape: pathops.Path, by: float) -> pathops.Path:
    """The shape with its edges pushed out by `by` units (counters shrink by the same)."""
    edge = pathops.Path()
    shape.draw(edge.getPen())
    edge.stroke(by * 2, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 4)
    return _op(shape, edge, pathops.PathOp.UNION)


def _pieces(shape: pathops.Path) -> list[pathops.Path]:
    """Splits a glyph into its stencil pieces: each outer contour with the counters inside it."""
    contours = list(shape.contours)
    if not contours:
        return []
    outer_turn = max(contours, key=lambda c: abs(c.area)).clockwise
    outers = [c for c in contours if c.clockwise == outer_turn]
    pieces = []
    for outer in outers:
        piece = pathops.Path()
        outer.draw(piece.getPen())
        pieces.append((outer, piece))
    for hole in (c for c in contours if c.clockwise != outer_turn):
        x, y = hole.firstPoints[0]
        homes = [(abs(o.area), p) for o, p in pieces if o.contains((x, y))] or [(0, pieces[0][1])]
        hole.draw(min(homes, key=lambda h: h[0])[1].getPen())
    return [p for _, p in pieces]


def heavier(shape: pathops.Path, grow: float, gap: float, steps: int = 10) -> pathops.Path:
    """Grows each stencil piece by `grow` but keeps at least `gap` between pieces, so the cuts stay open.

    The pieces grow together in small steps, each step stopping `gap` short of its neighbours, so
    two pieces meet halfway across a cut instead of one eating the other's side.
    """
    pieces = _pieces(pathops.simplify(shape))
    step = grow / steps
    for _ in range(steps):
        grown = []
        for i, piece in enumerate(pieces):
            try:
                bold = _grow(piece, step)
                for j, other in enumerate(pieces):
                    if i != j:
                        bold = _op(bold, _grow(other, gap), pathops.PathOp.DIFFERENCE)
                grown.append(_op(bold, piece, pathops.PathOp.UNION))
            except pathops.PathOpsError:
                grown.append(piece)  # this piece sits this step out rather than break the glyph
        pieces = grown
    result = pathops.Path()
    for piece in pieces:
        result = _op(result, piece, pathops.PathOp.UNION)
    return result


def embolden(font: TTFont, extra: int, gap: int) -> None:
    """Grows every outline by extra/2 units on each side and widens the glyph to match."""
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    glyph_set = font.getGlyphSet()
    half = extra / 2
    new_glyphs, new_metrics = {}, {}
    for name in font.getGlyphOrder():
        width, lsb = hmtx[name]
        if glyf[name].numberOfContours == 0:
            new_metrics[name] = (width, lsb)  # spaces keep their width, so words don't drift apart
            continue
        shape = pathops.Path()
        glyph_set[name].draw(shape.getPen(glyphSet=glyph_set))  # composites are flattened here
        bold = heavier(shape, half, gap)
        pen = TTGlyphPen(None)
        bold.draw(TransformPen(Cu2QuPen(pen, 1.0, reverse_direction=True), (1, 0, 0, 1, half, 0)))
        new_glyphs[name] = pen.glyph()
        new_metrics[name] = (width + extra, 0)
    # Swap in only after every glyph is drawn, so composites decompose from the originals.
    for name, glyph in new_glyphs.items():
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
    for name, (width, lsb) in new_metrics.items():
        hmtx[name] = (width, new_glyphs[name].xMin if name in new_glyphs else lsb)


def rename(font: TTFont) -> None:
    names = {
        1: FAMILY,
        2: "Regular",
        3: f"{POSTSCRIPT};Rustnuts SMC",
        4: FAMILY,
        6: POSTSCRIPT,
        16: FAMILY,
        17: "Regular",
    }
    table = font["name"]
    table.names = [r for r in table.names if r.nameID not in names and r.nameID not in (21, 22)]
    for name_id, value in names.items():
        table.setName(value, name_id, 3, 1, 0x409)
        table.setName(value, name_id, 1, 0, 0)
    table.setName(
        "Rustnuts Stencil is a modified version of Stardos Stencil by Vernon Adams, "
        "made heavier for Rustnuts SMC. Licensed under the SIL Open Font License 1.1.",
        10, 3, 1, 0x409,
    )
    name_version = table.getDebugName(5) or "Version 1.001"
    table.setName(f"{name_version}; Rustnuts heavier build", 5, 3, 1, 0x409)
    os2 = font["OS/2"]
    os2.usWeightClass = 400
    os2.fsSelection = (os2.fsSelection & ~0b100001) | 0b1000000  # not bold, regular
    font["head"].macStyle = 0


def fit_vertical_metrics(font: TTFont) -> None:
    """Grown accents reach past the old clipping box, so Windows would cut their tops off."""
    glyf = font["glyf"]
    top = max(getattr(glyf[n], "yMax", 0) for n in font.getGlyphOrder())
    bottom = min(getattr(glyf[n], "yMin", 0) for n in font.getGlyphOrder())
    os2 = font["OS/2"]
    os2.usWinAscent = max(os2.usWinAscent, top)
    os2.usWinDescent = max(os2.usWinDescent, -bottom)
    widths = [w for w, _ in font["hmtx"].metrics.values() if w]
    os2.xAvgCharWidth = round(sum(widths) / len(widths))


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    extra = int(sys.argv[3]) if len(sys.argv) > 3 else 160
    gap = int(sys.argv[4]) if len(sys.argv) > 4 else 70
    font = TTFont(src)
    for table in ("hdmx", "LTSH", "VDMX", "fpgm", "prep", "cvt ", "gasp"):
        if table in font:
            del font[table]
    embolden(font, extra, gap)
    rename(font)
    font["maxp"].recalc(font)
    fit_vertical_metrics(font)
    font.recalcTimestamp = False  # same input, same file
    font.save(out)


if __name__ == "__main__":
    main()
