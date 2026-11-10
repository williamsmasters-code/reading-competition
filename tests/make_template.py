"""Make site/assets/score-sheet-template.xlsx from Judge1 Readers.xlsx.
Edits ONLY the cell values inside the xlsx XML (byte-level), so every style,
merge, column width, dropdown and formula of the original stays exactly as is.
Blanked: item, student name, date, school, round, district, judge (sheet 1),
every score in column H and the cached results of formulas. Real names are
also wiped from the shared-strings table so none remain in the file."""
import re, sys, zipfile, shutil
SRC = 'Judge1 Readers.xlsx'; DST = 'site/assets/score-sheet-template.xlsx'
zin = zipfile.ZipFile(SRC)
import openpyxl
wb = openpyxl.load_workbook(SRC)
names = set()
for ws in wb.worksheets:
    names.add(ws['C4'].value.strip())
names.add(wb.worksheets[0]['J7'].value.strip())
print('names to remove:', sorted(names))

def blank_cell(xml, ref):
    # <c r="C4" s="20" t="s"><v>12</v></c>  ->  <c r="C4" s="20"/>
    pat = re.compile(r'<c r="%s"((?: s="\d+")?)(?: t="\w+")?>(.*?)</c>' % ref, re.S)
    def rep(m):
        inner = m.group(2)
        f = re.search(r'<f>.*?</f>|<f[^>]*/>', inner, re.S)
        if f:   # keep the formula, drop the cached value
            return '<c r="%s"%s>%s</c>' % (ref, m.group(1), f.group(0))
        return '<c r="%s"%s/>' % (ref, m.group(1))
    return pat.sub(rep, xml, count=1)

out = zipfile.ZipFile(DST + '.tmp', 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if re.match(r'xl/worksheets/sheet\d+\.xml$', item.filename):
        xml = data.decode('utf-8')
        idx = int(re.search(r'sheet(\d+)', item.filename).group(1))
        ws = wb.worksheets[idx - 1]
        refs = ['C3', 'C4', 'C5', 'C6', 'J5']
        if idx == 1: refs += ['J3', 'J7']
        else: refs += ['J3', 'J7']          # formulas: cached value dropped, formula kept
        for row in ws.iter_rows():
            a = row[0]
            if isinstance(a.value, (int, float)) and 1 <= a.value <= 10: refs.append('H%d' % a.row)
            if row[1].value == 'Total Score': refs.append('H%d' % a.row)
        for r in refs: xml = blank_cell(xml, r)
        data = xml.encode('utf-8')
    elif item.filename == 'xl/sharedStrings.xml':
        xml = data.decode('utf-8')
        for n in names:
            esc = n.replace('&', '&amp;').replace("'", '&apos;')
            for cand in {n, esc, n.replace("'", '&#39;')}:
                xml = xml.replace('<t>%s</t>' % cand, '<t></t>').replace('<t xml:space="preserve">%s</t>' % cand, '<t></t>')
        data = xml.encode('utf-8')
    out.writestr(item, data)
out.close()
shutil.move(DST + '.tmp', DST)
# checks
z = zipfile.ZipFile(DST); blob = b''.join(z.read(n) for n in z.namelist())
left = [n for n in names if n.encode() in blob or n.replace("'", '&apos;').encode() in blob]
print('names left in template:', left)
t = openpyxl.load_workbook(DST)
for ws in t.worksheets:
    vals = [ws[c].value for c in ('C3', 'C4', 'C5', 'C6', 'J3', 'J5', 'J7')]
    hs = [ws.cell(r, 8).value for r in range(9, 21)]
    print(ws.title, vals, [h for h in hs if h is not None])
sys.exit(1 if left else 0)
