---
name: grsmd-qa
description: Discuss any topic with the user and reach agreement efficiently through a Markdown Q&A sheet that the user reads and answers in place in GRSMD (GR Simple Markdown), converging round by round. Use when the user types /grsmd-qa, asks for questions "in a .md with answer fields" (回答欄付きの .md で), when a batch of rulings (a term audit, a change request's open points, a review's open items) is too many to ask in chat, or when the user says they updated a question sheet (更新した、確認しろ).
---

# Q&A sheet in GRSMD

**Purpose:** discuss any topic or agenda with the user and reach agreement
efficiently.

The user answers in a Markdown file instead of chat. They open the file in
GRSMD, write answers, counter-questions and notes into it, save, and tell the
session. The session reads the file, records the decisions, rewrites the
sheet so it converges, and marks what changed since the previous round. Each
round the sheet gets shorter, and the decisions table gets longer.

For many related questions this is easier for both sides than chat: the user
answers everything in one place, pushes back next to the question, and sees
only what changed. GRSMD edits blocks in place, saves back to the same file,
and finds the change marks with its search.

## Where the skill lives

`<skill>` below is this skill's own folder: the base directory the skill
loader prints when the skill starts (`~/.claude/skills/grsmd-qa` for every
project, or `.claude/skills/grsmd-qa` in one repository). Run the scripts
from the project's folder, so `old/` and the git check refer to that project.

The skill does not own a ruling ledger. Use the project's own ledger (a
decision log, an ADR folder, a rulings table) and the project's rules for
asking. If the project has none, ask the user where to record decisions
before the first round.

## The rules in short

| Rule | Detail |
|---|---|
| Change mark | The emoji U+1F504 (written MARK below). Changed prose and table cells are also in *italics* |
| First version | No marks. The session creates the sheet without any MARK |
| From the second round | When the user has updated the sheet and the session rewrites it, every change since the version the user saved gets a MARK |
| Old marks | A part that did not change since the previous version loses its MARK |
| Marking by script | Never by hand. The session writes the sheet without caring about marks; `scripts/mark_changes.py` strips every MARK, diffs against the user's saved version and marks each change. Its `--check` must report 0 findings before the sheet goes back |
| User's emphasis | The user may put ★ on anything they want to stress |
| Backups | Before the session creates or edits the sheet, and after the user has updated it (before the session reads it), the sheet is copied to `old/` beside it. `old/` is gitignored when git is used. The session finds the changes by diffing against `old/` |

The sheet itself starts with a short digest for the user (see "Sheet
layout"). The digest is for a beginner: answer here, save, tell the session;
MARK and italics are the changes; ★ is free emphasis. Do not write the
`old/` rules into the sheet. Explain them in chat only when the user asks.

## What GRSMD can and cannot show

GRSMD is a one-file, in-browser Markdown viewer and editor with no backend.

| Works | Does not work |
|---|---|
| GFM tables, code blocks, Mermaid (MARK in labels is fine), KaTeX | HTML comments (not shown at all) |
| In-place edit of a block (double-click; Ctrl+B / Ctrl+I) | Live reload (the user presses Re-load) |
| Save overwrites the dropped file (Chrome / Edge; other browsers download) | A diff view |
| Search (key `f`, plain or regex; finds MARK) and Index (key `i`, headings) | Arbitrary inline styles (DOMPurify strips them) |

- Search and Index are in GRSMD's next release; until it is out, use the beta
  at `https://goodrelax.github.io/gr-simple-md-renderer/grsmd-beta.html`.
- `$...$` is math. Write `\$` for a literal dollar sign.
- Do not use coloured text, even though GRSMD keeps its own palette colours:
  mark changes with MARK and italics only. Coloured text over a whole sheet is
  hard on the eyes.
- External images load only after a click, and PlantUML only after consent.
  Prefer Mermaid and ASCII trees.

## Sheet layout

One sheet per level of the question tree. Start at the top level, go down
one level per sheet. When a sheet closes, the next part goes into the same
file under a new heading if the user asks for that; otherwise start a new
file with the next number.

```text
# <subject> -- sheet N (<what this level covers>)

<the digest: 3-4 lines, in the user's language; example below>
<one line: when made, when last rewritten>

## Decided            <- the decisions table: question | decision | ruling id

## Whole tree         <- the only copy of the tree (when the questions build one)

## Question 1. <title>
<scene: where the user meets this, the current words with counts and where they occur>
| Option | Content |    <- options a, b, c ...: 2-4 of them, the recommendation is a, bold, marked recommended
<answer field>

### Question 1-2. <follow-up>   <- a follow-up goes right under its question

## Free notes          <- an answer field for anything the sheet missed
```

The digest, in Japanese (write it in the user's language):

```text
> **/grsmd-qa の使い方**
> - 「回答:」の後ろに、選択肢の文字（a, b …）か自由な文を書き、保存してから、チャットで「更新した」と伝えてください。
> - 🔄 と*斜体*は、前回から変わった所です（`f` で 🔄 を検索すると順に飛べます）。初版には付きません。
> - 強調したい所には ★ を付けてかまいません。
```

Write the headings, the answer field and the decisions table in the user's
language (for Japanese: `## 決まったこと`, `## 問 N.`, `### 問 N-2.`,
`回答:`, `## 自由欄`).

Every question follows the project's rules for asking, and at least: the
on-screen or in-file names, the scene, the current words with measured
counts, 2 to 4 options with the recommendation first, and what each option
changes. A count in a question is a claim: say how it was counted, or count
again.

**Option labels are always lower-case letters:** `a`, `b`, `c` ..., with the
recommendation as `a`. Never number options (`1`, `2`, `3`); numbers are for
questions. From the second round, a follow-up may refine an earlier option
with a suffix (`a-1`, `a-2`, `b-1` ...). The same input form every time keeps
the user's thinking free of noise.

## Where the sheet lives

Put the sheet, and its `old/` folder beside it, in a folder the user can
open and save over from the browser (GRSMD's Save writes back to the file
the user dropped). Never use the session's scratchpad or a system temp
folder: the user cannot save over a sheet there. A session that runs in a
git worktree puts the sheet inside its own worktree (it may not be allowed to
write elsewhere). If you are not sure which
folder the user can use, ask before the first round. The folder may be one
that git tracks. When git is used, add `old/` to `.gitignore`; the backups
are working copies and must not be committed.

## One sheet, one path

- Tell the user the exact path of the sheet (including the worktree, if any)
  every round. Never keep two working copies of the same sheet.
- When the user says they saved, check that the file you are about to read
  is the one they saved: look for other copies with the same repository-
  relative path (for example under `.claude/worktrees/`) and compare their
  modification times. If another copy is newer, ask before reading.

## The first round

1. Write the sheet in a folder the user can save to (see "Where the sheet lives"):
   digest, questions, answer fields, options a, b, c. No MARK anywhere:
   `python <skill>/scripts/mark_changes.py --check --strip <sheet.md>` must
   report 0 findings.
2. Back it up: `python <skill>/scripts/backup_sheet.py <sheet.md>`.
3. Tell the user the full path in a few lines. Do not repeat the questions in
   chat.

## Every later round

When the user says they updated the sheet:

0. **Load this skill again** with the Skill tool, even when an earlier round
   loaded it. The skill may have changed since; follow the text you load now,
   not what you remember.
1. **Back up the user's version first,** before reading or editing:
   `python <skill>/scripts/backup_sheet.py <sheet.md>`. It copies the sheet
   to `old/<stem>_yyyymmdd_hhmm.md` beside it and warns when `old/` is not
   gitignored; add the folder to `.gitignore` if it warns. This backup is the
   user's saved version: the base for the marks in step 5.
2. **Read the whole sheet** and diff it against the previous backup (the
   session's last version) to find every answer, counter-question, ★, note in
   a tree, and edit the user made to the wording.
3. **Record each settled answer at once.** One ruling row per decision, with
   the user's words verbatim and an id, in the project's ledger. Never hold a
   decision only in the sheet: a session can end or compact at any time.
4. **Rewrite the sheet so it converges.**
   - Move each settled question to the decisions table (decision in one line,
     the ruling id) and delete its explanation and its dead options.
   - Answer a counter-question as a follow-up (`Question N-2`) right under
     the question, with options again when a choice remains.
   - Take the user's own words into the tree or the table when they proposed
     a name, and say so.
   - Delete earlier explanations that a decision made obsolete.
   - Do not place or remove any MARK yourself: write the text as it should
     read; old marks may stay or go, step 5 strips them all.
   - Just before writing, run the backup script once more. If it makes a new
     backup, the user saved while you worked: read that version, take its new
     answers, and use that backup as the base in step 5.
5. **Mark with the script:**
   `python <skill>/scripts/mark_changes.py <base backup> <sheet.md>`. It
   strips every MARK from both versions, diffs them, and marks each changed
   line, each changed table cell and each changed Mermaid label (see "Change
   marks"). A part that did not change carries no MARK, whatever its earlier
   marks were. It warns about a changed Mermaid line with no changed label (a
   node id only); that line stays unmarked.
6. **Check.**
   `python <skill>/scripts/mark_changes.py --check <base backup> <sheet.md>`
   must print 0 findings (a stale mark or an unmarked change is a finding).
   Then read the decisions table against the new ruling rows, make sure no
   settled question still has an answer field, the digest is at the top and
   the sheet says nothing about `old/`.
7. **Back up the session's version:** run the backup script again, so the
   next round can diff against exactly what the user was given.
8. **Tell the user in a few lines** in chat: the full path, which answers were
   taken, which ruling ids, how many new follow-ups, and a last line with the
   base backup, the number of marked lines and the check result. Do not
   repeat the questions in chat.

## Change marks

| Where | How to mark a change |
|---|---|
| Prose | `MARK *changed text*` (mark, then italics) |
| A table cell | the same, in every changed cell of the row |
| A heading | `### MARK *Question 5-2. ...*` |
| A code block or a tree | MARK at the start of each changed line (no italics); three spaces on unchanged lines keep the columns |
| Mermaid | MARK before the changed label text (no italics) |

`scripts/mark_changes.py` applies this table. A table row is compared cell by
cell with the old row of the same first cell (else the most alike old row).
In a code block, it pads the unchanged lines of a changed block with three
spaces and strips them again in the next round. Blank lines, fences, table
separator rows and empty answer fields are never marked; deleted text cannot
be marked.

## Trees

- One tree, in one place. Several partial trees confuse the user.
- English and the user's language side by side, in columns:
  `tree + English name | Japanese name | note`. No Japanese on the English
  side.
- Draw the branches with ASCII `+-` and `|`. Box-drawing characters break
  the alignment in Japanese fonts.
- Align the columns by display width (East Asian wide characters count as
  2): `python <skill>/scripts/tree_align.py <rows.tsv>` prints an aligned
  tree from rows of `tree_and_english<TAB>japanese<TAB>note<TAB>changed`.
- Names the glossary does not have yet are the session's provisional
  translations: say so once in the header lines.

## Closing a sheet

When every question is decided:

- Mark the sheet closed in its header, keep the decisions table and the final
  tree, and delete the answer fields.
- Open the next part (the next level of the tree) as the user asked: in the
  same file under a new heading, or in a new file.
- Hand the decisions to whoever applies them, with the ruling ids and the
  counts of what must change.

## Traps seen so far

- Marks left over from an earlier round made the user unable to see what
  changed. Remove every MARK before marking, and mark against the user's
  saved version only.
- Marks on the first version (147 of them, on almost all new text) were
  noise. The first version has no marks.
- Marks placed by hand, from memory of what the session meant to change,
  missed two shortened table rows and kept one on an unchanged header. The
  backups make the diff one command: mark with `mark_changes.py`, check with
  `--check`, never by hand.
- A session kept following the copy of this skill it had loaded in an earlier
  round after the skill had changed. Load the skill again every round.
- The user saved while the session was rewriting the sheet; only a tool
  warning showed it. Back up once more just before writing.
- Two worktrees held a copy of the same sheet; the user saved an old GRSMD
  tab into the other copy and 329 lines were lost there. Keep one path and
  check the copies before reading.
- A sheet written to the session scratchpad could not be saved over from
  GRSMD. Keep sheets in a folder the user can save to.
- Numbered options (1, 2, 3) next to numbered questions made answers
  ambiguous. Options are letters.
- Box-drawing characters misaligned every tree in a Japanese font. Use ASCII.
- A wrong old name slipped into a tree (a property renamed earlier). Check
  every name in a tree against the latest decision before writing it.
- A shortened explanation stated something false. A one-line summary of a
  technical rule still needs its source.
- A sheet kept settled questions "for the record". The decisions table is the
  record; the sheet shrinks.
