# grsmd-qa -- a Claude Code skill for Q&A sheets in GRSMD

Discuss any topic with Claude Code and reach agreement efficiently. When a
session has many related questions for you (a glossary audit, the open points
of a change, review items), asking them one by one in chat is slow and hard to
answer. With this skill the session writes the questions into a Markdown
sheet. You open the sheet in GRSMD (GR Simple Markdown), write your answers
and counter-questions in place, save, and tell the session. The session
records each decision, rewrites the sheet so it shrinks to what is still open,
and marks what changed since your last save.

## How to read and answer a sheet

- Write your answer after each answer field (`回答:` / `Answer:`), save, and
  tell the session in chat that you updated the sheet.
- The emoji U+1F504 and *italics* mark what changed since the previous round.
  The first version of a sheet has no marks. Press `f` in GRSMD and search for
  the emoji to jump between the changes.
- Put ★ on anything you want to stress.
- Press Re-load in GRSMD after the session has rewritten the sheet.

## What you need

- Claude Code (CLI, desktop app or IDE extension)
- Python 3 (for the three helper scripts; standard library only)
- GRSMD in Chrome or Edge, so that Save writes the file back:
  https://goodrelax.github.io/gr-simple-md-renderer/ (search and the index are
  in the next release; until then use
  https://goodrelax.github.io/gr-simple-md-renderer/grsmd-beta.html)
- git (optional; the backup script checks that the backup folder is ignored)

## Install

Copy this folder, `grsmd-qa`, into one of the skill folders:

| For | Folder |
|---|---|
| every project of yours | `~/.claude/skills/grsmd-qa` |
| one repository (shared with everyone who clones it) | `<repository>/.claude/skills/grsmd-qa` |

Start a new session after copying; a running session reads the skill list
when it starts. To update, delete the old folder first, then copy again.

Then type `/grsmd-qa` with what to discuss, or ask for questions "in a .md
with answer fields". The session writes the sheet and tells you where it is.

## Files

| File | What it does |
|---|---|
| `SKILL.md` | The method the session follows: the rules, sheet layout, rounds, change marks, trees |
| `scripts/backup_sheet.py` | Copies a sheet to `old/<name>_yyyymmdd_hhmm.md` beside it (before and after each edit) |
| `scripts/mark_changes.py` | Marks what changed since your last save: strips every mark, diffs against that version, marks each changed line, table cell and Mermaid label; `--check` reports stale marks and unmarked changes |
| `scripts/tree_align.py` | Prints a two-language tree in columns aligned by display width |

The session keeps earlier versions in `old/` beside the sheet and finds the
changes by comparing with them; the change marks come from that comparison,
not from the session's memory. Keep that folder out of version control.

## License

Part of GRSMD. See the license of the GRSMD repository.
