"""Compare an exported workbook with the ORIGINAL Judge1 Readers.xlsx: sheet names, merged cells,
column widths, row heights, every cell's style (font, fill, border, alignment, number format),
dropdown validations, formulas, page setup, and that scores/comments landed in H and I."""
import sys, openpyxl
ORIG = '../Judge1 Readers.xlsx'
def style(c):
    f, fl, b, a = c.font, c.fill, c.border, c.alignment
    side = lambda s: (s.style, s.color.rgb if s.color is not None else None) if (s is not None and s.style) else None
    return (f.name, f.sz, f.b, f.i, f.u, f.color.rgb if f.color is not None else None,
            fl.fill_type, fl.fgColor.rgb if fl.fgColor is not None else None,
            side(b.left), side(b.right), side(b.top), side(b.bottom),
            a.horizontal, a.vertical, a.wrap_text, c.number_format)
def dvs(ws):
    return sorted((d.type, (d.formula1 or '').replace(' ', ''), str(d.sqref), d.allow_blank) for d in ws.data_validations.dataValidation)
def compare(path, expect_n, mixed=False):
    o = openpyxl.load_workbook(ORIG); e = openpyxl.load_workbook(path)
    probs = []; checked = 0
    if len(e.worksheets) != expect_n: probs.append('sheet count %d != %d' % (len(e.worksheets), expect_n))
    for i, ws in enumerate(e.worksheets):
        src = o.worksheets[min(i, len(o.worksheets) - 1)]
        if i < len(o.worksheets) and ws.title != src.title: probs.append('name %s != %s' % (ws.title, src.title))
        m1 = sorted(str(m) for m in src.merged_cells.ranges); m2 = sorted(str(m) for m in ws.merged_cells.ranges)
        if m1 != m2: probs.append('%s merged differ: missing %s extra %s' % (ws.title, set(m1) - set(m2), set(m2) - set(m1)))
        for col, dim in src.column_dimensions.items():
            w2 = ws.column_dimensions[col].width
            if dim.width and abs((w2 or 0) - dim.width) > 0.01: probs.append('%s col %s width %s != %s' % (ws.title, col, w2, dim.width))
        for r, dim in src.row_dimensions.items():
            if dim.height and abs((ws.row_dimensions[r].height or 0) - dim.height) > 0.01: probs.append('%s row %d height %s != %s' % (ws.title, r, ws.row_dimensions[r].height, dim.height))
        for row in src.iter_rows(min_row=1, max_row=src.max_row, max_col=12):
            for c in row:
                c2 = ws[c.coordinate]; checked += 1
                merged_inner = any(c.coordinate in m and c.coordinate != m.start_cell.coordinate for m in src.merged_cells.ranges)
                s1, s2 = style(c), style(c2)
                if merged_inner and s1[8:12] == s2[8:12] and s1[6:8] == s2[6:8]: s1, s2 = s1[6:12], s2[6:12]   # hidden cell inside a merge: only fill + borders are visible
                if s1 != s2: probs.append('%s %s style %s != %s' % (ws.title, c.coordinate, s2, s1))
                if isinstance(c.value, str) and c.value.startswith('=') and c2.value != c.value and not (mixed and c.coordinate == 'J3' and isinstance(c2.value, str) and not c2.value.startswith('=')): probs.append('%s %s formula %r != %r' % (ws.title, c.coordinate, c2.value, c.value))
                if c.coordinate[0] in 'AB' and c.value is not None and c.coordinate not in ('B4',) and c2.value != c.value and not (isinstance(c.value, float) and c2.value == int(c.value)):
                    probs.append('%s %s label %r != %r' % (ws.title, c.coordinate, c2.value, c.value))
        d1, d2 = dvs(src), dvs(ws)
        if d1 != d2: probs.append('%s validations differ:\n   orig %s\n   new  %s' % (ws.title, d1, d2))
        ps1, ps2 = src.page_setup, ws.page_setup
        if (ps1.orientation, src.sheet_properties.pageSetUpPr.fitToPage if src.sheet_properties.pageSetUpPr else None) != (ps2.orientation, ws.sheet_properties.pageSetUpPr.fitToPage if ws.sheet_properties.pageSetUpPr else None):
            probs.append('%s page setup differs %s/%s' % (ws.title, ps2.orientation, ps1.orientation))
        # data landed in the right cells
        rows = [c.row for c in ws['A'] if isinstance(c.value, (int, float)) and 1 <= c.value <= 12]
        hv = [ws.cell(r, 8).value for r in rows]; iv = [ws.cell(r, 9).value for r in rows]
        if not all(isinstance(h, int) and 1 <= h <= 5 for h in hv[:10]): probs.append('%s scores in H wrong: %s' % (ws.title, hv))
        if not any(v for v in iv): probs.append('%s no comments in I' % ws.title)
        hdr = {k: ws[k].value for k in ('C3', 'C4', 'C5', 'C6', 'J3', 'J5', 'J7')}
        print('  %-14s criteria rows %s..%s  H=%s  header=%s' % (ws.title, rows[0], rows[-1], hv, {k: (v if not hasattr(v, 'year') else v.date().isoformat()) for k, v in hdr.items()}))
    print('%s: %d cells compared, %d problems' % (path, checked, len(probs)))
    for p in probs[:40]: print('   -', p)
    return len(probs)
n = 0
if len(sys.argv) > 2:
    sys.exit(1 if compare(sys.argv[1], int(sys.argv[2]), len(sys.argv) > 3 and sys.argv[3] == 'mixed') else 0)
n += compare('out/export_6_readers.xlsx', 6)
n += compare('out/export_8_readers.xlsx', 8)
n += compare('out/export_4_readers.xlsx', 4)
# a reader in a different (named) round gets the round name typed into J3 instead of the =Sheet1!J3 formula
n += compare('out/export_setup_mix.xlsx', 6, mixed=True)
sys.exit(1 if n else 0)
