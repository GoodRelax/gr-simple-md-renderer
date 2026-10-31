"""Tests for skills/grsmd-qa/scripts/mark_changes.py (standard library only).

  python -m unittest discover -s tools/grsmd-qa-tests -v

Set GRSMD_QA_MARK_SCRIPT to the path of another mark_changes.py to run the
same tests against it (for example an earlier version).
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.environ.get('GRSMD_QA_MARK_SCRIPT') or os.path.join(
    HERE, '..', '..', 'skills', 'grsmd-qa', 'scripts', 'mark_changes.py')
MARK = '\U0001F504'
JA_ANSWER = '\u56de\u7b54:'


def ja_note(numbers, indent=''):
    return (indent + MARK + ' *\u4e0b\u306e\u30b3\u30fc\u30c9\u30d6\u30ed\u30c3\u30af\u306e '
            + numbers + ' \u884c\u76ee\u304c\u5909\u308f\u3063\u305f\u3002*')


BASE = '''# t

Run this:

```bash
cd folder
python run.py --old
echo done
```

```text
root
+- a
+- b
```

''' + JA_ANSWER + '\n'

NEW = BASE.replace('--old', '--new').replace('echo done', 'echo finished').replace('+- b', '+- c')


class MarkChangesTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def run_script(self, *args):
        r = subprocess.run([sys.executable, SCRIPT] + list(args), capture_output=True)
        return r.returncode, r.stdout.decode('utf-8', 'replace')

    def write(self, name, text, eol='\n'):
        path = os.path.join(self.tmp.name, name)
        with open(path, 'wb') as f:
            f.write(text.replace('\n', eol).encode('utf-8'))
        return path

    def read(self, path):
        with open(path, 'rb') as f:
            return f.read().decode('utf-8')

    def mark(self, base_text, new_text, eol='\n'):
        base = self.write('base.md', base_text, eol)
        new = self.write('new.md', new_text, eol)
        code, out = self.run_script(base, new)
        self.assertEqual(code, 0, out)
        return base, new, self.read(new)

    # --- code blocks (GQ-7) ---------------------------------------------

    def test_copy_block_gets_note_and_stays_as_written(self):
        for eol in ('\n', '\r\n', '\r'):
            with self.subTest(eol=repr(eol)):
                base, new, text = self.mark(BASE, NEW, eol)
                lines = text.split(eol)
                self.assertEqual(lines[lines.index('```bash') - 1], ja_note('2\u30fb3'))
                for line in ('cd folder', 'python run.py --new', 'echo finished'):
                    self.assertIn(line, lines)
                self.assertNotRegex(text.replace(eol, ''), '[\r\n]')  # every line keeps its ending
                self.assertEqual(self.run_script('--check', base, new)[0], 0)

    def test_text_block_keeps_line_marks(self):
        _, _, text = self.mark(BASE, NEW)
        lines = text.split('\n')
        self.assertIn(MARK + ' +- c', lines)
        self.assertIn('   root', lines)
        self.assertIn('   +- a', lines)

    def test_rerun_changes_nothing(self):
        base, new, text = self.mark(BASE, NEW)
        code, out = self.run_script(base, new)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read(new), text)

    def test_next_round_removes_note_and_marks(self):
        for eol in ('\n', '\r\n', '\r'):
            with self.subTest(eol=repr(eol)):
                _, new, text = self.mark(BASE, NEW, eol)
                saved = self.write('saved.md', text.replace(eol, '\n'), eol)
                code, out = self.run_script(saved, new)
                self.assertEqual(code, 0, out)
                self.assertEqual(self.read(new), NEW.replace('\n', eol))
                self.assertEqual(self.run_script('--check', '--strip', new)[0], 0)

    def test_stale_note_goes_when_block_matches_base(self):
        stale = BASE.replace('```bash', ja_note('2') + '\n```bash')
        _, _, text = self.mark(BASE, stale)
        self.assertEqual(text, BASE)

    def test_english_note(self):
        en = BASE.replace(JA_ANSWER, 'Answer:')
        _, _, text = self.mark(en, en.replace('echo done', 'echo bye'))
        self.assertIn(MARK + ' *Changed in the code block below: line 3.*', text.split('\n'))

    def test_strip_check_reports_note_line(self):
        # Only a note line, and no mark inside the block: the check must name the note line.
        sheet = self.write('sheet.md', BASE.replace('```bash', ja_note('2') + '\n```bash'))
        code, out = self.run_script('--check', '--strip', sheet)
        self.assertEqual(code, 1, out)
        self.assertIn('note line', out)

    def test_copy_block_starting_with_mark_stays_as_written(self):
        # A markdown block that shows a mark (M1): marking and --strip keep it byte for byte.
        block = '```markdown\n' + MARK + ' *changed line*\n   indented\n```\n'
        base_text = '# t\n\nintro\n\n' + block + '\n' + JA_ANSWER + '\n'
        new_text = base_text.replace('intro', 'intro changed')
        _, new, text = self.mark(base_text, new_text)
        self.assertIn(block, text)
        code, out = self.run_script('--strip', new)
        self.assertEqual(code, 0, out)
        self.assertIn(block, self.read(new))

    def test_text_block_showing_a_mark_stays_as_written(self):
        # A text block whose own text starts with a mark, in no marked shape, keeps it.
        block = '```text\n' + MARK + ' legend\nroot\n```\n'
        base_text = '# t\n\nintro\n\n' + block + '\n' + JA_ANSWER + '\n'
        _, new, text = self.mark(base_text, base_text.replace('intro', 'intro changed'))
        self.assertIn(block, text)

    def test_note_takes_fence_indent_in_a_list(self):
        base_text = ('# t\n\n1. Step one:\n\n   ```bash\n   run --old\n   ```\n\n'
                     '2. Step two.\n\n' + JA_ANSWER + '\n')
        _, _, text = self.mark(base_text, base_text.replace('--old', '--new'))
        lines = text.split('\n')
        self.assertEqual(lines[lines.index('   ```bash') - 1], ja_note('1', '   '))

    def test_check_reports_one_finding_for_one_stale_note(self):
        stale = BASE.replace('```bash', ja_note('2') + '\n```bash')
        base = self.write('base.md', BASE)
        sheet = self.write('sheet.md', stale)
        code, out = self.run_script('--check', base, sheet)
        self.assertEqual(code, 1, out)
        findings = [line for line in out.splitlines() if line.startswith('FINDING')]
        self.assertEqual(len(findings), 1, out)
        self.assertIn('stale note line', findings[0])

    # --- rules from before GQ-7 -----------------------------------------

    def test_prose_heading_table_and_mermaid(self):
        base_text = ('# t\n\n## Question 1. old title\n\nplain text\n\n'
                     '| Option | Content |\n|:---|:---|\n| a | first |\n| b | second |\n\n'
                     '```mermaid\nflowchart TD\n  A[start] --> B[old label]\n```\n\n' + JA_ANSWER + '\n')
        new_text = (base_text.replace('old title', 'new title').replace('plain text', 'plain words')
                    .replace('| b | second |', '| b | changed |').replace('old label', 'new label'))
        base, new, text = self.mark(base_text, new_text)
        lines = text.split('\n')
        self.assertIn('## ' + MARK + ' *Question 1. new title*', lines)
        self.assertIn(MARK + ' *plain words*', lines)
        self.assertIn('| b | ' + MARK + ' *changed* |', lines)
        self.assertIn('| a | first |', lines)
        self.assertIn('|:---|:---|', lines)
        self.assertIn('  A[start] --> B[' + MARK + ' new label]', lines)
        self.assertIn(JA_ANSWER, lines)
        self.assertEqual(self.run_script('--check', base, new)[0], 0)

    def test_first_version_check(self):
        clean = self.write('clean.md', BASE)
        self.assertEqual(self.run_script('--check', '--strip', clean)[0], 0)
        marked = self.write('marked.md', BASE.replace('plain', 'x').replace('Run this:', MARK + ' *Run this:*'))
        self.assertEqual(self.run_script('--check', '--strip', marked)[0], 1)


if __name__ == '__main__':
    unittest.main()
