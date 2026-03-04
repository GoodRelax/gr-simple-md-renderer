# GRSMD Gen2 Bugfix Test Specification (Bug 1 & Bug 2)

**Version:** 1.0
**Date:** 2026-03-05
**Target:** `docs/index.html` (Vite build output)
**Browser:** Chrome/Edge 86+ (desktop), Safari (iPad/iPhone via GitHub Pages)
**URL:** https://goodrelax.github.io/gr-simple-md-renderer/

---

## Prerequisites

| # | Item | Detail |
|---|------|--------|
| P-01 | Build is up-to-date | Run `npm run build` and confirm `docs/index.html` is generated |
| P-02 | Unit tests all pass | Run `npm test` and confirm all 134 tests pass |
| P-03 | Test files prepared | Prepare the following files locally: |
| | | - A small code file (e.g., `hello.c`, ~50 lines) |
| | | - A large code file (e.g., `dummy_small.c`, 27,000+ lines) |
| | | - A `.py` file with known `lastModified` timestamp |
| | | - `sample-data.md` (Markdown with code blocks) |
| P-04 | Browser | Chrome or Edge (latest), OS dark/light mode switchable |
| P-05 | Mobile device (optional) | iPad or iPhone with Safari for GitHub Pages testing |

---

## Bug 1: fileInfo Format (Code View)

### BF1-TC01: fileInfo Two-Line Format

| Item | Detail |
|------|--------|
| **Prerequisite** | P-01 ~ P-03 complete |
| **Steps** | 1. Open `docs/index.html` in browser |
| | 2. Drop a code file (e.g., `hello.c`, 50 lines, ~1.2 KB) onto the page |
| **Expected** | - `#fileInfo` displays TWO lines: |
| | Line 1: `hello.c  |  50 lines  |  1.17 KB` |
| | Line 2: `Updated: YYYY-MM-DD HH:MM:SS` |
| | - The timestamp corresponds to the FILE's last modified date (not the current time) |
| | - No language field appears (e.g., no "c" or "plaintext") |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF1-TC02: fileInfo Comma Separator for Large Line Count

| Item | Detail |
|------|--------|
| **Prerequisite** | BF1-TC01 passed |
| **Steps** | 1. Drop a large code file (e.g., `dummy_small.c`, 27,243 lines) onto the page |
| **Expected** | - Line 1 shows comma-separated line count: `dummy_small.c  |  27,243 lines  |  538.88 KB` |
| | - Line 2 shows `Updated: YYYY-MM-DD HH:MM:SS` |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF1-TC03: fileInfo Timestamp Uses file.lastModified

| Item | Detail |
|------|--------|
| **Prerequisite** | P-03 complete |
| **Steps** | 1. Note the last modified date of the test file in the OS file manager |
| | 2. Open `docs/index.html` and drop the file |
| | 3. Compare the `Updated:` timestamp with the OS file manager date |
| **Expected** | - The `Updated:` timestamp matches the file's last modified date (not the drop/load time) |
| | - Format: `YYYY-MM-DD HH:MM:SS` |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF1-TC04: fileInfo Display on Narrow Browser

| Item | Detail |
|------|--------|
| **Prerequisite** | BF1-TC01 passed |
| **Steps** | 1. Resize browser window to narrow width (~400px) |
| | 2. Drop a code file onto the page |
| **Expected** | - `#fileInfo` displays two lines correctly (no overflow or truncation) |
| | - `white-space: pre-line` wraps naturally within the topbar |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF1-TC05: fileInfo After Reload (l/d Key)

| Item | Detail |
|------|--------|
| **Prerequisite** | BF1-TC01 passed, code view is active |
| **Steps** | 1. Press `l` to reload with light theme |
| | 2. Observe `#fileInfo` content |
| | 3. Press `d` to reload with dark theme |
| | 4. Observe `#fileInfo` content |
| **Expected** | - After each reload, `#fileInfo` retains two-line format |
| | - The `Updated:` timestamp reflects the file's `lastModified` (unchanged by reload) |
| | - Theme changes correctly |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

## Bug 2: Ctrl+C Modifier Guard

### BF2-TC01: Bare 'c' Key Triggers Clear

| Item | Detail |
|------|--------|
| **Prerequisite** | Code view or Markdown view is active (not initial state) |
| **Steps** | 1. Render a Markdown file or drop a code file |
| | 2. Click outside the editor textarea (ensure no INPUT/TEXTAREA focused) |
| | 3. Press bare `c` key |
| **Expected** | - View is cleared and returns to initial state |
| | - Affordance text "Get started:..." reappears |
| | - Editor textarea is emptied |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF2-TC02: Ctrl+C Does NOT Trigger Clear

| Item | Detail |
|------|--------|
| **Prerequisite** | Code view is active with text visible |
| **Steps** | 1. Select some text in the code view |
| | 2. Press Ctrl+C (Windows) or Cmd+C (macOS) |
| **Expected** | - Browser native copy is executed (text is copied to clipboard) |
| | - View is NOT cleared |
| | - Code view remains intact |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF2-TC03: Ctrl+C in Markdown View

| Item | Detail |
|------|--------|
| **Prerequisite** | Markdown preview is active |
| **Steps** | 1. Select rendered text in the Markdown preview |
| | 2. Press Ctrl+C |
| **Expected** | - Browser native copy is executed |
| | - Markdown preview is NOT cleared |
| | - Copied text can be pasted elsewhere |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF2-TC04: Alt+C Does NOT Trigger Clear

| Item | Detail |
|------|--------|
| **Prerequisite** | Any view active (markdown or code) |
| **Steps** | 1. Press Alt+C |
| **Expected** | - View is NOT cleared |
| | - No side effects occur |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF2-TC05: Ctrl+L / Ctrl+D Do NOT Trigger Render

| Item | Detail |
|------|--------|
| **Prerequisite** | Any view active |
| **Steps** | 1. Press Ctrl+L |
| | 2. Press Ctrl+D |
| **Expected** | - No render or theme change occurs |
| | - Browser default behavior for Ctrl+L (address bar) and Ctrl+D (bookmark) may occur, which is correct |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

## Mobile Testing (iPad/iPhone via GitHub Pages)

### BF-MOB-TC01: fileInfo Format on iPad Safari

| Item | Detail |
|------|--------|
| **Prerequisite** | `docs/index.html` deployed to GitHub Pages |
| **Steps** | 1. Open https://goodrelax.github.io/gr-simple-md-renderer/ on iPad Safari |
| | 2. Drop or open a code file (use Files app if drag-and-drop unavailable) |
| **Expected** | - `#fileInfo` displays two-line format correctly |
| | - Timestamp uses `Updated:` label |
| | - Layout is not broken on touch device |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### BF-MOB-TC02: No Keyboard Shortcut Conflicts on iOS

| Item | Detail |
|------|--------|
| **Prerequisite** | BF-MOB-TC01 passed |
| **Steps** | 1. With code view active, use the iOS copy gesture (long press + Copy) |
| **Expected** | - Native copy works correctly |
| | - View is NOT cleared |
| | - No unexpected behavior |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

## Summary

| Bug | Test Cases | Total |
|-----|------------|-------|
| Bug 1: fileInfo format | BF1-TC01 ~ BF1-TC05 | 5 |
| Bug 2: Ctrl+C guard | BF2-TC01 ~ BF2-TC05 | 5 |
| Mobile | BF-MOB-TC01 ~ BF-MOB-TC02 | 2 |
| **Total** | | **12** |
