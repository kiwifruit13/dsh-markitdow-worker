import re, sys, pathlib

root = pathlib.Path('D:/Git/github/markitdown-main')
diff_path = root / 'scripts/vendor-patches/001-ocr-fail-open.diff'
diff = diff_path.read_text(encoding='utf-8')

class Hunk:
    def __init__(self, file, old_start, lines):
        self.file = file
        self.old_start = old_start
        self.lines = lines

file = None
hunks = []
cur = None
for line in diff.splitlines():
    if line.startswith('--- a/'):
        continue
    if line.startswith('+++ b/'):
        file = line[4:]
        file = file.split('b/', 1)[1] if 'b/' in file else file[2:]
    elif line.startswith('@@'):
        m = re.match(r'@@ -(\d+)(?:,(\d+))? \+', line)
        start = int(m.group(1))
        cur = Hunk(file, start, [])
        hunks.append(cur)
    elif cur is not None:
        if line.startswith('+') or line.startswith('-') or line.startswith(' '):
            tag = line[0]
            content = line[1:]
            cur.lines.append((tag, content))

ok = True
for h in hunks:
    # file looks like "vendor/markitdown/markitdown_ocr/_pdf_converter_with_ocr.py"
    target = root / h.file
    if not target.exists():
        print(f'MISSING FILE: {h.file}')
        ok = False
        continue
    text = target.read_text(encoding='utf-8').splitlines()
    i = h.old_start - 1
    for tag, content in h.lines:
        if tag == ' ':
            if i >= len(text) or text[i] != content:
                print(f'MISMATCH {h.file}:{h.old_start+i} ctx exp={content!r} got={text[i] if i<len(text) else None!r}')
                ok = False
            i += 1
        elif tag == '-':
            if i >= len(text) or text[i] != content:
                print(f'MISMATCH {h.file}:{h.old_start+i} del exp={content!r} got={text[i] if i<len(text) else None!r}')
                ok = False
            i += 1
        elif tag == '+':
            if i < len(text) and text[i] == content:
                print(f'ALREADY PRESENT {h.file}:{h.old_start+i}: {content!r}')
                ok = False
if ok:
    print(f'T0-5: {len(hunks)} hunks verified against current vendor copy; clean replay OK')
    sys.exit(0)
sys.exit(1)
