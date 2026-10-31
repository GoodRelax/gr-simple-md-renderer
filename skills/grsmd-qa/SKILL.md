---
name: grsmd-qa
description: Drive a discussion with the user toward agreement through a GQA, a Markdown Q&A sheet with answer fields that the user reads and answers in place in GRSMD (GR Simple Markdown); the session rewrites the GQA round by round until every question has a decision. Use this skill when the user types /grsmd-qa; when the user asks for a GQA or for questions in a .md with answer fields (GQA で, 回答欄付きの .md で); when a task has too many rulings to ask in chat (a term audit, the open points of a change request, the open items of a review); or when the user says they updated a GQA (更新した, 確認しろ).
---

# GQA: Q&A sheet in GRSMD

**Purpose:** the session drives a discussion of any topic or agenda toward
agreement with the user, efficiently.

A GQA (GRSMD Q&A) is a Markdown file with answer fields. The user answers in
a GQA instead of chat. The user opens the GQA in GRSMD, writes answers,
counter-questions and notes into it, saves it, and tells the session. The
session reads the file, records the decisions, rewrites the GQA so that it
converges, and marks what changed since the previous round. Each round, the
GQA gets shorter and the decisions table gets longer.

For many related questions, a GQA serves both sides better than chat: the
user answers everything in one place, pushes back next to the question, and
sees only what changed. GRSMD edits blocks in place, saves back to the same
file, and finds the change marks with its search.

## Where the skill lives

`<skill>` below means this skill's own folder: the base directory that the
skill loader prints when the skill starts (`~/.claude/skills/grsmd-qa` for
every project, or `.claude/skills/grsmd-qa` in one repository). The session
runs the scripts from the project's folder, so that `old/` and the git check
refer to that project.

The skill owns no ruling ledger. The session uses the project's own ledger (a
decision log, an ADR folder, a rulings table) and the project's rules for
asking. If the project has no ledger, the session asks the user where to
record decisions before the first round.

## The rules in short

| Rule | Detail |
|---|---|
| Change mark | The emoji U+1F504 (written MARK below). The script also puts changed prose and table cells in *italics* |
| First version | The session creates the GQA without any MARK |
| From the second round | When the user has updated the GQA and the session rewrites it, the script marks every change since the version the user saved |
| Old marks | The script removes the MARK from every part that stayed the same since the previous version |
| Marking by script | Never by hand. The session writes the GQA without regard to marks; `scripts/mark_changes.py` strips every MARK, diffs against the user's saved version and marks each change. Its `--check` must report 0 findings before the GQA goes back to the user |
| User's emphasis | The user may put ★ on anything they want to stress |
| Backups | Before the session creates or edits the GQA, and after the user has updated it (before the session reads it), the session copies the GQA to `old/` beside it. When the project uses git, `.gitignore` covers `old/`. The session finds the changes by diffing against `old/` |

The GQA itself starts with a short digest for the user (see "GQA layout").
The digest serves a beginner: answer here, save, tell the session; MARK and
italics show the changes; ★ adds free emphasis. The session keeps the `old/`
rules out of the GQA and explains them in chat only when the user asks.

## What GRSMD can and cannot show

GRSMD is a one-file, in-browser Markdown viewer and editor with no backend.

| Works | Does not work |
|---|---|
| GFM tables, code blocks, Mermaid (MARK in labels works), KaTeX | HTML comments (GRSMD hides them) |
| In-place edit of a block (double-click; Ctrl+B / Ctrl+I) | Live reload (the user presses Re-load) |
| Save overwrites the dropped file (Chrome / Edge; other browsers download) | A diff view |
| Search (key `f`, plain or regex; finds MARK) and Index (key `i`, headings) | Arbitrary inline styles (DOMPurify strips them) |

- GRSMD's next release brings Search and Index; until then, the user opens
  the beta at `https://goodrelax.github.io/gr-simple-md-renderer/grsmd-beta.html`.
- `$...$` starts math. The session writes `\$` for a literal dollar sign.
- The session marks changes with MARK and italics only and uses no coloured
  text, although GRSMD keeps its own palette colours: coloured text over a
  whole GQA tires the eyes.
- GRSMD loads external images only after a click, and PlantUML only after
  consent. The session prefers Mermaid and ASCII trees.

## GQA layout

**One discussion, one file.** The session keeps the decisions and the open
questions in the same file. A deeper level of the topic goes into the same
file as new open questions. The session starts a new file only when the user
starts a new discussion.

The file holds only what the discussion has decided and what remains open.
The session deletes everything that the discussion made useless
(explanations, figures, dead options, superseded drafts); `old/` keeps the
way back.

The GQA keeps a fixed order: the digest first, then the decisions, then the
open questions, then the free notes.

```text
# <subject>

<the digest: 3-4 lines, in the user's language; example below>
<one line: when made, when last rewritten>

## Decided            <- the decisions table: question | decision | ruling id,
                         then the settled design as tables or figures
                         (for example the only copy of the tree)

## Question 1. <title>
<scene: where the user meets this, the current words with counts and where they occur>
| Option | Content |    <- options a, b, c ...: 2-4 of them, the recommendation is a, bold, marked recommended
<answer field>

### Question 1-2. <follow-up>   <- a follow-up goes right under its question

## Free notes          <- an answer field for anything the GQA missed
```

The digest, in Japanese (the session writes it in the user's language):

```text
> **GQA の使い方**
> - 「回答:」の後ろに、選択肢の文字（a, b …）か自由な文を書き、保存してから、チャットで「更新した」と伝えてください。
> - 🔄 と*斜体*は、前回から変わった所です（`f` で 🔄 を検索すると順に飛べます）。初版には付きません。
> - 強調したい所には ★ を付けてかまいません。
```

The session writes the headings, the answer field and the decisions table in
the user's language (for Japanese: `## 決まったこと`, `## 問 N.`,
`### 問 N-2.`, `回答:`, `## 自由欄`).

Every question follows the project's rules for asking and holds at least: the
on-screen or in-file names, the scene, the current words with measured
counts, 2 to 4 options with the recommendation first, and what each option
changes. A count in a question is a claim: the session states how it counted,
or counts again.

**Option labels are always lower-case letters:** `a`, `b`, `c` ..., with the
recommendation as `a`. The session never numbers options (`1`, `2`, `3`);
numbers belong to questions. From the second round, a follow-up may refine an
earlier option with a suffix (`a-1`, `a-2`, `b-1` ...). The same input form
every time keeps the user's thinking free of noise.

**Tables align left:** the session writes each column of the separator row
as `:---` (`|:---|:---|`). GRSMD then aligns every header and cell to the
left; a plain `---` centres the headers.

**Commands the user copies:** the session may put them in a code block with a
language (`bash`, `powershell`) or with none. The script keeps such a block
free of marks and writes one note line before it instead (see "Change
marks"), so the user can copy the block as it stands.

## Where the GQA lives

The session puts the GQA, and its `old/` folder beside it, in a folder that
the user can open and save over from the browser (GRSMD's Save writes back to
the file that the user dropped). The session never uses its scratchpad or a
system temp folder: the user cannot save over a GQA there. A session that
runs in a git worktree puts the GQA inside its own worktree (it may lack the
right to write elsewhere). If the session is unsure which folder the user can
use, it asks before the first round. Git may track the folder. When the
project uses git, the session adds `old/` to `.gitignore`; the backups are
working copies, and nobody commits them.

The session names a new GQA `<topic>-gqa.md` (for example
`github-edit-gqa.md`) and keeps the names of existing GQAs: the user may have
them open in GRSMD.

## One GQA, one path

- Every round, the session tells the user the exact path of the GQA
  (including the worktree, if any). The session never keeps two working
  copies of the same GQA.
- When the user says they saved, the session checks that the file it is about
  to read is the one the user saved: it looks for other copies with the same
  repository-relative path (for example under `.claude/worktrees/`) and
  compares their modification times. If another copy is newer, the session
  asks before reading.

## BOSS and SUB sessions

Some users run sessions in a hierarchy. A BOSS session manages SUB sessions,
a BOSSBOSS manages the BOSSes of several projects, and a PMO is the SUB that
keeps a BOSS's plan. The session writes these role names in capitals only.

When a SUB needs the user's rulings:

- The SUB writes the GQA in its own worktree (see "Where the GQA lives").
- Every round, the SUB sends the GQA's full path to its BOSS. The BOSS gives
  the user the link in its own reply.
- The BOSS tells the SUB when the user has updated the GQA.
- When text for the user names a session, the writer adds a link to it:
  `[name](#local_<id>)`.

## The first round

1. The session writes the GQA in a folder the user can save to (see "Where
   the GQA lives"): digest, questions, answer fields, options a, b, c, and no
   MARK anywhere. This command must report 0 findings:
   `python <skill>/scripts/mark_changes.py --check --strip <gqa.md>`
2. The session backs it up: `python <skill>/scripts/backup_sheet.py <gqa.md>`.
3. The session tells the user the full path in a few lines (a SUB sends it to
   its BOSS). The session leaves the questions out of the chat.

## Every later round

When the user says they updated the GQA, the session runs exactly these steps
and nothing else. A round stays quick: no project-wide checks, no commits and
no long reports per round. The session runs the project's checks and commits
once, when the GQA closes or when the user asks (see "Closing a GQA").

0. **Reload this skill only if it changed.** The session prints its hash:
   `python -c "import hashlib,sys;print(hashlib.sha1(open(sys.argv[1],'rb').read()).hexdigest()[:12])" <skill>/SKILL.md`
   and compares it with the hash it noted when it last loaded the skill. If
   the hash differs (or the session has no note), the session loads the
   skill again with the Skill tool and follows the text it loads now, not
   what it remembers.
1. **Back up the user's version first,** before reading or editing:
   `python <skill>/scripts/backup_sheet.py <gqa.md>`. The script copies the
   GQA to `old/<stem>_yyyymmdd_hhmm.md` beside it and warns when `.gitignore`
   lacks `old/`; on that warning, the session adds the folder to
   `.gitignore`. This backup holds the user's saved version: the base for the
   marks in step 5.
2. **Read the whole GQA** and diff it against the previous backup (the
   session's last version) to find every answer, counter-question, ★, note in
   a tree, and edit the user made to the wording.
3. **Record each settled answer at once.** The session writes one ruling row
   per decision, with the user's words verbatim and an id, into the project's
   ledger file (and commits it later). The session never holds a decision
   only in the GQA: a session can end or compact at any time.
   If a question needs a fresh measurement or count, the session says so in
   chat before it starts, so the user knows this round takes longer.
4. **Rewrite the GQA so it converges.**
   - The session moves each settled question to the decisions table (the
     decision in one line, the ruling id) and deletes its explanation and its
     dead options.
   - The session answers a counter-question with a follow-up (`Question N-2`)
     right under the question, with options again when a choice remains.
   - When the user proposed a name, the session takes the user's own words
     into the tree or the table and says so.
   - The session deletes everything that a decision made useless:
     explanations, figures, options, drafts. `old/` keeps them; the GQA keeps
     nothing "for the record".
   - The session leaves every MARK to the script: it writes the text as it
     should read; old marks may stay or go, because step 5 strips them all.
   - Just before writing, the session runs the backup script once more. If
     the script makes a new backup, the user saved during the session's work:
     the session reads that version, takes its new answers, and uses that
     backup as the base in step 5.
5. **Mark with the script:**
   `python <skill>/scripts/mark_changes.py <base backup> <gqa.md>`. The
   script strips every MARK and every note line from both versions, diffs
   them, and marks each changed line, each changed table cell, each changed
   Mermaid label and each changed code block (see "Change marks"). A part
   that stayed the same carries no MARK, whatever its earlier marks were. The
   script warns about a changed Mermaid line with no changed label (a node id
   only) and leaves that line unmarked.
6. **Check.**
   `python <skill>/scripts/mark_changes.py --check <base backup> <gqa.md>`
   must print 0 findings (a stale mark, an unmarked change, or a stale or
   missing note line counts as a finding). Then the session reads the
   decisions table against the new ruling rows and confirms three things:
   every settled question has lost its answer field, the digest stands at the
   top, and the GQA says nothing about `old/`.
7. **Back up the session's version:** the session runs the backup script
   again, so the next round can diff against exactly what the user received.
8. **Tell the user in a few lines** in chat (a SUB tells its BOSS): the full
   path, which answers the session took, which ruling ids, how many new
   follow-ups, and a last line with the base backup, the number of marked
   lines and the check result. The session leaves the questions out of the
   chat.

## Change marks

| Where | How the script marks a change |
|:---|:---|
| Prose | `MARK *changed text*` (mark, then italics) |
| A table cell | the same, in every changed cell of the row |
| A heading | `### MARK *Question 5-2. ...*` |
| A `text` block (a tree) | MARK at the start of each changed line (no italics); three spaces on the unchanged lines keep the columns |
| Another code block (`bash`, `powershell`, no language ...) | one note line right before the opening fence: `MARK *下のコードブロックの 2・5 行目が変わった。*` (in an English GQA: `MARK *Changed in the code block below: lines 2, 5.*`); the note line takes the fence's indent, and the script never edits the block itself, a leading MARK included |
| Mermaid | MARK before the changed label text (no italics) |

`scripts/mark_changes.py` applies this table. The script compares a table
row cell by cell with the old row of the same first cell (else with the most
alike old row). In a changed `text` block, it pads the unchanged lines with
three spaces and strips them again in the next round. It picks the language
of a note line from the answer fields (`回答:` means Japanese) and removes the
note lines first in the next round. The script leaves blank lines, fences,
table separator rows and empty answer fields unmarked; it cannot mark deleted
text.

## Trees

- One tree, in one place. Several partial trees confuse the user.
- The tree shows English and the user's language side by side, in columns:
  `tree + English name | Japanese name | note`. The English side holds no
  Japanese.
- The session draws the branches with ASCII `+-` and `|`. Box-drawing
  characters break the alignment in Japanese fonts.
- The session aligns the columns by display width (East Asian wide characters
  count as 2): `python <skill>/scripts/tree_align.py <rows.tsv>` prints an
  aligned tree from rows of `tree_and_english<TAB>japanese<TAB>note<TAB>changed`.
- Names that the glossary lacks are the session's provisional translations:
  the session says so once in the header lines.

## Closing a GQA

When every question has a decision:

- The session marks the GQA closed in its header, keeps the decisions table
  and the final tree, and deletes the answer fields.
- The session opens the next part (the next level of the topic) in the same
  file, as new open questions under the decisions. The session uses a new
  file only when the user starts a new discussion.
- The session hands the decisions to whoever applies them, with the ruling
  ids and the counts of what must change.
- Now, once, the session runs the project's checks and commits the ledger and
  the closed GQA as the project's rules require (with the user's OK where
  needed).

## Traps seen so far

- Marks left over from an earlier round hid from the user what changed. The
  script removes every MARK before marking and marks against the user's
  saved version only.
- Marks on the first version (147 of them, on almost all new text) made
  noise. The first version carries no marks.
- Marks placed by hand, from memory of what the session meant to change,
  missed two shortened table rows and kept one on an unchanged header. The
  backups turn the diff into one command: the session marks with
  `mark_changes.py`, checks with `--check`, and never marks by hand.
- A session kept following the copy of this skill that it had loaded in an
  earlier round after the skill had changed. The session checks the skill's
  hash every round.
- The user saved while the session was rewriting the GQA; only a tool warning
  showed it. The session backs up once more just before writing.
- Two worktrees held a copy of the same GQA; the user saved an old GRSMD tab
  into the other copy, and that copy lost 329 lines. The session keeps one
  path and checks the copies before reading.
- The user could not save over a GQA in the session scratchpad from GRSMD.
  The session keeps GQAs in a folder the user can save to.
- Numbered options (1, 2, 3) next to numbered questions made answers
  ambiguous. Options use letters.
- Each round once ran the whole project check, a privacy count, a commit and
  a long report; the user found the rounds too slow. Rounds edit and mark
  only; checks and commits wait for the GQA to close.
- Throwaway edit scripts broke on headings decorated with MARK and italics.
  The session matches text after stripping marks (mark_changes.py strips them
  anyway), or edits with a plain text replacement that ignores the
  decoration.
- Box-drawing characters misaligned every tree in a Japanese font. The
  session uses ASCII.
- A wrong old name slipped into a tree (a property renamed earlier). The
  session checks every name in a tree against the latest decision before
  writing it.
- A shortened explanation stated something false. A one-line summary of a
  technical rule still needs its source.
- A GQA kept settled questions "for the record". The decisions table holds
  the record; the GQA shrinks.
- The script once marked changed command lines inside a code block; the user
  copied the mark with the command, and the command broke. The script now
  writes a note line before such a block and leaves the block as written.
