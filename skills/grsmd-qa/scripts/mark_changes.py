"""Mark what changed in a GQA (a Q&A sheet) since the user saved it.

The session writes the GQA without thinking about marks; this script
strips every change mark from both versions, diffs them line by line, and
marks each changed line (each changed cell in a table) as SKILL.md says:

  prose, heading, list item:  MARK *text*
  table row:                  MARK *cell* in every changed cell (leading
                              spaces, U+3000 included, stay before MARK)
  text block (a tree):        MARK at the start of each changed line and
                              three spaces on the other lines of that block
  other code block:           one note line right before the opening fence
                              (MARK *the changed line numbers*, with the
                              fence's indent); the script never edits the
                              block itself, so the user can copy it
  Mermaid block:              MARK before each changed label

Blank lines, fences, table separator rows and empty answer fields are
never marked. Deleted lines cannot be marked. Each line keeps its own line
ending (CRLF, LF and CR may be mixed) and a BOM stays. The note lines are
the only lines the script adds; the next run removes them first.

  python <skill>/scripts/mark_changes.py <user_saved.md> <gqa.md>
      re-mark gqa.md against user_saved.md (the backup taken after the
      user said they saved) and write gqa.md
  python <skill>/scripts/mark_changes.py --check <user_saved.md> <gqa.md>
      report stale marks, unmarked changes and stale or missing note
      lines; exit 1 if there are any
  python <skill>/scripts/mark_changes.py --strip <gqa.md>
      remove every mark and note line (the first version has none)
  python <skill>/scripts/mark_changes.py --check --strip <gqa.md>
      report any mark or note line in gqa.md (for the first version);
      exit 1 if any
"""
import difflib
import re
import sys

MARK = '\U0001F504'
OPEN = MARK + ' *'
EOL = re.compile(r'(\r\n|\r|\n)')
FENCE = re.compile(r'^\s*(`{3,}|~{3,})\s*([\w-]*)')
PREFIX = re.compile(r'^(\s*(?:>\s?)*\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?)')
ANSWER = re.compile(r'^\s*(?:\u56de\u7b54|Answer)\s*[:\uff1a]\s*$')
JAPANESE = re.compile(r'^\s*\u56de\u7b54\s*[:\uff1a]')  # a Japanese answer field anywhere
NOTE_JA = '\u4e0b\u306e\u30b3\u30fc\u30c9\u30d6\u30ed\u30c3\u30af\u306e %s \u884c\u76ee\u304c\u5909\u308f\u3063\u305f\u3002'
NOTE_EN = 'Changed in the code block below: %s.'
NOTE_LINE = re.compile('^' + re.escape(OPEN) + r'(?:\u4e0b\u306e\u30b3\u30fc\u30c9\u30d6\u30ed\u30c3\u30af\u306e [\d\u30fb]+ '
                       r'\u884c\u76ee\u304c\u5909\u308f\u3063\u305f\u3002|Changed in the code block below: lines? [\d, ]+\.)\*$')
SEPARATOR_CELL = re.compile(r'^:?-+:?$')
CELL_SPLIT = re.compile(r'(?<!\\)\|')
SIMILAR = 0.5  # a changed line is compared cell by cell (or label by label) with an old line this alike
MERMAID_LABEL = re.compile(r'\(\(([^)]*)\)\)|\[\[([^\]]*)\]\]|\{\{([^}]*)\}\}|\(\[([^\]]*)\]\)|\[\(([^)]*)\)\]|\["([^"]*)"\]|\("([^"]*)"\)|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}|\|([^|]*)\|')


def read_sheet(path):
    """Lines, the line ending after each line (CRLF, LF and CR may be mixed), and the BOM."""
    with open(path, 'rb') as f:
        data = f.read()
    bom = data.startswith(b'\xef\xbb\xbf')
    parts = EOL.split(data.decode('utf-8-sig'))
    return parts[0::2], parts[1::2], bom


def write_sheet(path, lines, ends, bom):
    # Each line gets its own ending back; a note line carries its fence's ending.
    data = ''.join(line + end for line, end in zip(lines, ends + [''])).encode('utf-8')
    with open(path, 'wb') as f:
        f.write((b'\xef\xbb\xbf' if bom else b'') + data)


def is_note(lines, i):
    return bool(NOTE_LINE.match(lines[i].strip())) and i + 1 < len(lines) and bool(FENCE.match(lines[i + 1]))


def drop_notes(lines, ends):
    """Lines and endings without the note lines an earlier run put before a fence,
    the notes found ({index of its fence in the kept lines: note line}) and the
    original index of each kept line."""
    kept, kept_ends, found, origin = [], [], {}, []
    pending = None
    for i, line in enumerate(lines):
        if is_note(lines, i):
            pending = line
            continue
        if pending is not None:
            found[len(kept)] = pending
            pending = None
        kept.append(line)
        origin.append(i)
        if i < len(ends):
            kept_ends.append(ends[i])
    return kept, kept_ends, found, origin


def add_notes(lines, ends, notes):
    """Insert each note right before its fence; a note takes its fence's line ending."""
    out_lines, out_ends = [], []
    for i, line in enumerate(lines):
        if i in notes:
            out_lines.append(notes[i])
            out_ends.append(ends[i] if i < len(ends) else '\n')
        out_lines.append(line)
        if i < len(ends):
            out_ends.append(ends[i])
    return out_lines, out_ends


def note(numbers, japanese, indent):
    """The note line; it takes the fence's indent, so a block in a list stays in the list."""
    if japanese:
        return indent + OPEN + NOTE_JA % '\u30fb'.join(str(n) for n in numbers) + '*'
    word = 'line' if len(numbers) == 1 else 'lines'
    return indent + OPEN + NOTE_EN % (word + ' ' + ', '.join(str(n) for n in numbers)) + '*'


def classify(lines):
    """One kind per line: 'fence', 'code' (a text block), 'copy' (another code block),
    'mermaid' or 'text', and a block number for fenced lines."""
    kinds, blocks = [], []
    fence, lang, block = None, '', -1
    for line in lines:
        m = FENCE.match(line)
        if fence is None and m:
            fence, lang, block = m.group(1), m.group(2).lower(), block + 1
            kinds.append('fence')
            blocks.append(block)
        elif fence is not None and line.strip().startswith(fence[0] * len(fence)) \
                and line.strip().strip(fence[0]) == '':
            fence = None
            kinds.append('fence')
            blocks.append(block)
        elif fence is not None:
            kinds.append('mermaid' if lang == 'mermaid' else 'code' if lang == 'text' else 'copy')
            blocks.append(block)
        else:
            kinds.append('text')
            blocks.append(None)
    return kinds, blocks


def is_table_row(line):
    return line.lstrip().startswith('|')


def split_row(line):
    indent = line[:len(line) - len(line.lstrip())]
    body = line.strip()
    if body.startswith('|'):
        body = body[1:]
    if body.endswith('|') and not body.endswith('\\|'):
        body = body[:-1]
    # Only the ASCII padding around a cell goes; a leading U+3000 indents a tree.
    return indent, [cell.strip(' \t') for cell in CELL_SPLIT.split(body)]


def join_row(indent, cells):
    return indent + '| ' + ' | '.join(cells) + ' |'


def is_separator(cells):
    return any(cells) and all(SEPARATOR_CELL.match(cell) for cell in cells if cell)


def strip_segment(seg):
    i = seg.find(OPEN)
    if i < 0:
        return seg
    rest = seg[i + len(OPEN):]
    core = rest.rstrip()
    tail = rest[len(core):]
    j = core.rfind('*')
    if j >= 0:
        core = core[:j] + core[j + 1:]
    return seg[:i] + core + tail


def mark_segment(seg):
    body = seg.lstrip()
    lead = seg[:len(seg) - len(body)]  # leading spaces, U+3000 included, stay outside the mark
    core = body.rstrip()
    tail = body[len(core):]
    if core.endswith('\\'):  # a backslash line break stays last
        return lead + OPEN + core[:-1] + '*\\' + tail
    return lead + OPEN + core + '*' + tail


def strip_all(lines, kinds, blocks):
    # A copy block stays byte for byte as written, a leading MARK included:
    # the user copies it, and the script never marks inside it. In a text block
    # the script owns the marks: a leading MARK is a mark, and a block with one
    # also lost its three-space padding. A line the user added without the
    # padding keeps its text.
    marked = {blocks[i] for i, line in enumerate(lines)
              if kinds[i] == 'code' and line.startswith(MARK + ' ')}
    out = []
    for i, line in enumerate(lines):
        kind = kinds[i]
        if kind == 'code' and blocks[i] in marked:
            if line.startswith(MARK + ' '):
                line = line[2:]
            elif line.startswith('   '):
                line = line[3:]
        elif kind == 'mermaid':
            line = line.replace(MARK + ' ', '')
        elif kind == 'text' and OPEN in line:
            if is_table_row(line):
                indent, cells = split_row(line)
                line = join_row(indent, [strip_segment(cell) for cell in cells])
            else:
                line = strip_segment(line)
        out.append(line)
    return out


def first_cell(line, kind):
    if kind != 'text' or not is_table_row(line):
        return None
    cells = split_row(line)[1]
    return cells[0] if cells and not is_separator(cells) else None


def key(line, kind):
    if kind == 'text' and is_table_row(line):
        return 'T\x00' + '\x00'.join(split_row(line)[1])
    return line.rstrip()


def labels(line):
    """(start, text) of each Mermaid label: ((...)), [[...]], {{...}}, ([...]), [(...)],
    ["..."], ("..."), [...], (...), {...}, |...|."""
    return [(m.start(m.lastindex), m.group(m.lastindex)) for m in MERMAID_LABEL.finditer(line)]


def mark_mermaid(line, old_line):
    """MARK before each label that differs from old_line's label at the same place."""
    new = labels(line)
    if not new:
        return None
    old = labels(old_line) if old_line is not None else None
    if old is None or len(old) != len(new):
        changed = [start for start, _ in new]
    else:
        changed = [start for (start, text), (_, before) in zip(new, old) if text != before]
    for start in reversed(changed):
        line = line[:start] + MARK + ' ' + line[start:]
    return line if changed else None


def remark(base_lines, new_lines):
    """New lines with every change since base marked, plus counts and warnings."""
    base_kinds, base_blocks = classify(base_lines)
    base = strip_all(base_lines, base_kinds, base_blocks)
    kinds, blocks = classify(new_lines)
    new = strip_all(new_lines, kinds, blocks)
    base_kinds, _ = classify(base)
    kinds, blocks = classify(new)
    pair = {}  # new index -> base index of the line it most likely replaced, or None
    base_keys = [key(l, k) for l, k in zip(base, base_kinds)]
    new_keys = [key(l, k) for l, k in zip(new, kinds)]
    matcher = difflib.SequenceMatcher(None, base_keys, new_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ('replace', 'insert'):
            for j in range(j1, j2):
                pair[j] = None
                if tag == 'replace':
                    # A table row pairs first with the old row of the same first cell
                    # (an option label, a question number); else with the most alike line.
                    first = first_cell(new[j], kinds[j])
                    same = [i for i in range(i1, i2) if first and first_cell(base[i], base_kinds[i]) == first]
                    if same:
                        pair[j] = same[0]
                        continue
                    ratios = [(difflib.SequenceMatcher(None, base_keys[i], new_keys[j]).ratio(), i)
                              for i in range(i1, i2)]
                    best, i = max(ratios)
                    if best >= SIMILAR:
                        pair[j] = i
    out = list(new)
    counts = {'lines': 0, 'cells': 0}
    warnings = []
    changed_code_blocks = {blocks[j] for j in pair if kinds[j] == 'code' and new[j].strip()}
    opening = {}  # block number -> index of its opening fence
    for j, kind in enumerate(kinds):
        if kind == 'fence' and blocks[j] not in opening:
            opening[blocks[j]] = j
    changed_copy_lines = {}  # opening fence index -> changed line numbers inside the block
    for j, line in enumerate(new):
        kind = kinds[j]
        if kind == 'code' and blocks[j] in changed_code_blocks:
            if j in pair and line.strip():
                out[j] = MARK + ' ' + line
                counts['lines'] += 1
            elif line:
                out[j] = '   ' + line
            continue
        if kind == 'copy':
            if j in pair and line.strip():
                start = opening[blocks[j]]
                changed_copy_lines.setdefault(start, []).append(j - start)
            continue
        if j not in pair or kind in ('fence', 'code') or not line.strip():
            continue
        if kind == 'mermaid':
            i = pair[j]
            old_line = base[i] if i is not None and base_kinds[i] == 'mermaid' else None
            marked = mark_mermaid(line, old_line)
            if marked is None:
                warnings.append('line %d: changed Mermaid line with no changed label, left unmarked' % (j + 1))
            else:
                out[j] = marked
                counts['lines'] += 1
            continue
        if ANSWER.match(line):
            continue
        if is_table_row(line):
            indent, cells = split_row(line)
            if is_separator(cells):
                continue
            old = None
            i = pair[j]
            if i is not None and base_kinds[i] == 'text' and is_table_row(base[i]):
                old = split_row(base[i])[1]
            if old is not None and len(old) != len(cells):
                old = None
            changed = [cell and (old is None or cell != old[n]) for n, cell in enumerate(cells)]
            if any(changed):
                out[j] = join_row(indent, [mark_segment(c) if changed[n] else c
                                           for n, c in enumerate(cells)])
                counts['cells'] += sum(1 for c in changed if c)
                counts['lines'] += 1
            continue
        prefix = PREFIX.match(line).group(1)
        body = line[len(prefix):]
        if body.strip():
            out[j] = prefix + mark_segment(body)
            counts['lines'] += 1
    japanese = any(JAPANESE.match(line) for line in new)
    notes = {}
    for start, numbers in changed_copy_lines.items():
        fence = new[start]
        notes[start] = note(numbers, japanese, fence[:len(fence) - len(fence.lstrip())])
    return out, notes, counts, warnings


def check(expected, actual, origin):
    """Compare line by line; origin maps an index in actual to its line in the file."""
    findings = []
    for n in range(max(len(expected), len(actual))):
        want = expected[n] if n < len(expected) else ''
        have = actual[n] if n < len(actual) else ''
        if want == have:
            continue
        if MARK in have and MARK not in want:
            what = 'stale mark (the line did not change)'
        elif MARK in want and MARK not in have:
            what = 'unmarked change'
        else:
            what = 'marks differ from the diff'
        number = origin[n] + 1 if n < len(origin) else len(origin) + 1
        findings.append('line %d: %s: %s' % (number, what, have.strip()[:60]))
    return findings


def check_notes(expected, found, origin):
    """Compare the note lines before each fence: missing, stale or wrong ones."""
    findings = []
    for start in sorted(set(expected) | set(found)):
        want, have = expected.get(start), found.get(start)
        if want == have:
            continue
        if have is None:
            what = 'missing note line'
        elif want is None:
            what = 'stale note line (the block did not change)'
        else:
            what = 'note line differs from the diff'
        findings.append('line %d: %s: %s' % (origin[start], what, (have or want).strip()[:60]))
    return findings


def main(argv):
    if hasattr(sys.stdout, 'reconfigure'):
        # A console code page without the emoji (cp932) must not stop the report.
        sys.stdout.reconfigure(errors='backslashreplace')
    args = argv[1:]
    do_check = '--check' in args
    do_strip = '--strip' in args
    paths = [a for a in args if not a.startswith('--')]
    if (do_strip and len(paths) != 1) or (not do_strip and len(paths) != 2):
        print(__doc__.strip())
        return 2
    sheet = paths[-1]
    raw_lines, raw_ends, bom = read_sheet(sheet)
    lines, ends, found, origin = drop_notes(raw_lines, raw_ends)
    if do_strip:
        kinds, blocks = classify(lines)
        stripped = strip_all(lines, kinds, blocks)
        if do_check:
            findings = check_notes({}, found, origin) + check(stripped, lines, origin)
            for f in findings:
                print('FINDING ' + f)
            print('%s check: %d findings' % ('NG' if findings else 'OK', len(findings)))
            return 1 if findings else 0
        write_sheet(sheet, stripped, ends, bom)
        print('OK stripped every mark: %s' % sheet)
        return 0
    base_lines, base_ends, _ = read_sheet(paths[0])
    base = drop_notes(base_lines, base_ends)[0]
    marked, notes, counts, warnings = remark(base, lines)
    for w in warnings:
        print('WARN ' + w)
    if do_check:
        # Notes and lines are compared apart, so one stale note cannot shift every later line.
        findings = check_notes(notes, found, origin) + check(marked, lines, origin)
        for f in findings:
            print('FINDING ' + f)
        print('%s check: %d findings' % ('NG' if findings else 'OK', len(findings)))
        return 1 if findings else 0
    expected, expected_ends = add_notes(marked, ends, notes)
    write_sheet(sheet, expected, expected_ends, bom)
    print('OK marked %d lines (%d table cells, %d code block notes): %s'
          % (counts['lines'], counts['cells'], len(notes), sheet))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
