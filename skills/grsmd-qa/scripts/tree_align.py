"""Print a tree as aligned columns: tree + English | Japanese | note.

Display width counts East Asian wide characters as 2, so the second and third
columns start at the same place on every line in a monospace font. A changed
line gets the change mark (U+1F504) at its start; other lines get three spaces.

Input: a UTF-8 TSV, one row per line:
  tree_and_english<TAB>japanese<TAB>note<TAB>changed
The first cell holds the ASCII branches and the English name, for example
"+- Schedule Canvas" or "|  +- Time Ruler". "changed" is 1 for a changed row,
empty or 0 otherwise. The note and changed cells may be left out.

  python <skill>/scripts/tree_align.py <rows.tsv> [out.txt]
"""
import io
import sys
import unicodedata

MARK = '\U0001F504 '


def width(text):
    return sum(2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1 for ch in text)


def pad(text, to):
    return text + ' ' * max(1, to - width(text))


def render(rows):
    """rows: list of (tree_and_english, japanese, note, changed)."""
    col1 = max(width(r[0]) for r in rows) + 2
    col2 = max(width(r[1]) for r in rows) + 2
    out = []
    for en, ja, note, changed in rows:
        line = pad(en, col1) + (pad(ja, col2) + note if note else ja)
        out.append((MARK if changed else '   ') + line.rstrip())
    return '\n'.join(out)


def read_rows(path):
    rows = []
    with io.open(path, encoding='utf-8') as f:
        for raw in f:
            raw = raw.rstrip('\r\n')
            if not raw.strip():
                continue
            cells = raw.split('\t') + ['', '', '']
            rows.append((cells[0], cells[1], cells[2], cells[3].strip() not in ('', '0')))
    return rows


def main(argv):
    if len(argv) not in (2, 3):
        print(__doc__.strip())
        return 2
    text = render(read_rows(argv[1])) + '\n'
    if len(argv) == 3:
        with io.open(argv[2], 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    else:
        sys.stdout.buffer.write(text.encode('utf-8'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
