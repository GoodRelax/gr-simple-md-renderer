# grsmd-qa -- a Claude Code skill for GQAs (Q&A sheets) in GRSMD

This skill lets Claude Code drive a discussion of any topic toward agreement
with you, efficiently. When a session has many related questions for you (a
glossary audit, the open points of a change, review items), one-by-one
questions in chat take long and tire you. With this skill, the session writes
the questions into a GQA (GRSMD Q&A): a Markdown file with answer fields. You
open the GQA in GRSMD (GR Simple Markdown), write your answers and
counter-questions in place, save, and tell the session. The session records
each decision, rewrites the GQA so that it shrinks to what remains open, and
marks what changed since your last save.

## How to read and answer a GQA

- Write your answer after each answer field (`回答:` / `Answer:`), save, and
  tell the session in chat that you updated the GQA.
- The emoji U+1F504 and *italics* mark what changed since the previous round.
  The first version of a GQA carries no marks. Press `f` in GRSMD and search
  for the emoji to jump between the changes.
- Above a changed code block, one note line names the changed lines; the
  block itself stays as written, so you can copy a command from it.
- Put ★ on anything you want to stress.
- Press Re-load in GRSMD after the session has rewritten the GQA.

## What you need

- Claude Code (CLI, desktop app or IDE extension)
- Python 3 (for the three helper scripts; standard library only)
- GRSMD in Chrome or Edge, so that Save writes the file back:
  https://goodrelax.github.io/gr-simple-md-renderer/ (the next release brings
  search and the index; until then, use
  https://goodrelax.github.io/gr-simple-md-renderer/grsmd-beta.html)
- git (optional; the backup script checks that git ignores the backup folder)

## Install

Download `grsmd-qa.zip` from this folder (on GitHub: open the file, then
"Download raw file") and unzip it into one of the skill folders; the zip
holds the folder `grsmd-qa`. Or copy this folder itself:

| For | Folder |
|---|---|
| every project of yours | `~/.claude/skills/grsmd-qa` |
| one repository (shared with everyone who clones it) | `<repository>/.claude/skills/grsmd-qa` |

Start a new session after copying; a running session reads the skill list
when it starts. To update, delete the old folder first, then copy again.

Then type `/grsmd-qa` with what to discuss, or ask for questions "in a .md
with answer fields". The session writes the GQA and tells you where it is.

## Files

| File | What it does |
|---|---|
| `SKILL.md` | The method the session follows: the rules, GQA layout, rounds, change marks, trees |
| `scripts/backup_sheet.py` | Copies a GQA to `old/<name>_yyyymmdd_hhmm.md` beside it (before and after each edit) |
| `scripts/mark_changes.py` | Marks what changed since your last save: strips every mark, diffs against that version, marks each changed line, table cell and Mermaid label, and writes a note line above each changed code block; `--check` reports stale marks and unmarked changes |
| `grsmd-qa.zip` | This folder as one file, for download (without the zip itself) |
| `scripts/tree_align.py` | Prints a two-language tree in columns aligned by display width |

The session keeps earlier versions in `old/` beside the GQA and finds the
changes by comparing with them; the change marks come from that comparison,
not from the session's memory. Keep that folder out of version control.

## License

Part of GRSMD. See the license of the GRSMD repository.
