# GRSMD Gen2 Manual Test Specification

**Version:** 1.0
**Date:** 2026-03-04
**Target:** `docs/index.html` (Vite build output)
**Browser:** Chrome/Edge 86+ (for FileSystemFileHandle tests), Firefox (graceful degradation)

---

## Prerequisites

| # | Item | Detail |
|---|------|--------|
| P-01 | Build is up to date | Run `npm run build` and confirm `docs/index.html` is generated |
| P-02 | Automated tests pass | Run `npm test` and confirm all 107 tests pass |
| P-03 | Test files ready | Prepare the following files on your local machine: |
| | | - `sample-data.md` (Markdown with Mermaid + PlantUML + KaTeX) |
| | | - `sample-data.txt` (plain text) |
| | | - `sample-data-2.md` (another Markdown file) |
| | | - Any `.py` file (e.g., a short Python script) |
| | | - Any `.js` file |
| | | - A file named `Dockerfile` (no extension) |
| | | - A file with unsupported extension (e.g., `test.xyz`) |
| | | - A file larger than 5 MB (e.g., `big.bin`) |
| P-04 | Browser | Chrome or Edge (latest), OS dark/light mode toggle accessible |
| P-05 | Open `docs/index.html` | Open the file directly in the browser (no server needed) |

---

## Test Cases

### TC-01: Initial State (Affordance Text)

| Item | Detail |
|------|--------|
| **Precondition** | Fresh page load of `docs/index.html` |
| **Steps** | 1. Open `docs/index.html` in browser |
| **Expected** | - Preview area shows affordance text: "Get started:..." with 3 usage options |
| | - Editor textarea is empty |
| | - Theme matches OS color scheme (light body = no `.dark` class, dark body = `.dark` class) |
| | - No errors in browser console |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-02: Markdown Paste (Auto-Render)

| Item | Detail |
|------|--------|
| **Precondition** | TC-01 passed (initial state) |
| **Steps** | 1. Copy any Markdown text to clipboard (e.g., `# Hello World`) |
| | 2. Press Ctrl+V on the page (focus NOT on textarea) |
| **Expected** | - Markdown is auto-rendered in the preview area |
| | - Affordance text disappears |
| | - Theme matches OS setting |
| | - Editor textarea contains the pasted text |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-03: Markdown Paste (Already Rendered - No Auto-Render)

| Item | Detail |
|------|--------|
| **Precondition** | TC-02 passed (markdown already rendered) |
| **Steps** | 1. Copy different text to clipboard |
| | 2. Press Ctrl+V on the page |
| **Expected** | - Browser default paste behavior occurs |
| | - Auto-render does NOT trigger |
| | - Preview content stays the same |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-04: Drop .md File -> Markdown Preview

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Drag and drop `sample-data.md` onto the page |
| **Expected** | - Markdown is rendered in preview area |
| | - Mermaid diagrams are rendered (if present) |
| | - KaTeX math formulas are rendered (if present) |
| | - Code blocks have syntax highlighting |
| | - `_viewState` is "markdown" (verify via no code view header) |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-05: PlantUML Consent Dialog

| Item | Detail |
|------|--------|
| **Precondition** | Markdown with PlantUML code block is available |
| **Steps** | 1. Paste or drop Markdown containing a PlantUML block |
| | 2. Observe the confirm dialog |
| | 3a. Click OK -> verify PlantUML diagram renders |
| | 3b. Click Cancel -> verify "Rendering Canceled" is shown |
| **Expected (OK)** | - Confirm dialog appears before PlantUML server request |
| | - PlantUML diagram renders as SVG image |
| **Expected (Cancel)** | - No data sent to PlantUML server |
| | - "Rendering Canceled" shown in place of PlantUML block |
| | - Other Markdown/Mermaid content remains intact |

| Result (OK) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

| Result (Cancel) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-06: Drop .py File -> Code View

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Drag and drop a `.py` file onto the page |
| **Expected** | - Code view displays with syntax highlighting (Python) |
| | - Line numbers are visible |
| | - Sticky header shows: `[CODE VIEW] filename.py | timestamp | size` |
| | - Fixed status bar shows: `filename.py | N lines | X.XX KB | Loaded: HH:MM:SS` |
| | - Theme is forced to dark mode (body has `.dark` class) |
| | - Keyboard hint overlay appears at bottom |
| | - Hint fades out after ~3 seconds |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-07: Drop .txt File -> Code View (Not Markdown)

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Drag and drop `sample-data.txt` onto the page |
| **Expected** | - File is shown in code view (NOT as Markdown preview) |
| | - Content displayed as plain text with line numbers |
| | - No Markdown rendering applied |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-08: Drop Dockerfile (Extensionless File)

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Drag and drop a file named `Dockerfile` (no extension) |
| **Expected** | - File renders in code view |
| | - Dockerfile syntax highlighting is applied |
| | - No alert or error |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-09: Drop Unsupported Extension (.xyz) -> Alert

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Drag and drop a file with extension `.xyz` |
| **Expected** | - Alert message: "Unsupported file type. Only text-based files with recognized extensions are accepted." |
| | - File is NOT processed |
| | - Page state does NOT change |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-10: Drop File > 5 MB -> Alert

| Item | Detail |
|------|--------|
| **Precondition** | Have a file larger than 5 MB |
| **Steps** | 1. Drag and drop the large file onto the page |
| **Expected** | - Alert message: "Dropped file is too large. Maximum file size is 5 MB." |
| | - File is NOT processed |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-11: Theme Switch - Light (l key)

| Item | Detail |
|------|--------|
| **Precondition** | Markdown is rendered (dark theme) OR code view is active |
| **Steps** | 1. Press `l` key (focus NOT on textarea/input) |
| **Expected (Markdown)** | - Markdown re-renders with light theme |
| | - body does NOT have `.dark` class |
| | - Scroll position is preserved |
| **Expected (Code View)** | - Code view reloads with light theme (if fileHandle available) |
| | - OR toast "Reload not available..." (if no fileHandle) |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-12: Theme Switch - Dark (d key)

| Item | Detail |
|------|--------|
| **Precondition** | Markdown is rendered (light theme) OR code view is active |
| **Steps** | 1. Press `d` key (focus NOT on textarea/input) |
| **Expected (Markdown)** | - Markdown re-renders with dark theme |
| | - body has `.dark` class |
| | - Scroll position is preserved |
| **Expected (Code View)** | - Code view reloads with dark theme (if fileHandle available) |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-13: Render Light / Render Dark Buttons

| Item | Detail |
|------|--------|
| **Precondition** | Markdown text is in the editor textarea |
| **Steps** | 1. Type or paste Markdown into the editor textarea |
| | 2. Click "Render Light" button |
| | 3. Verify light theme rendering |
| | 4. Click "Render Dark" button |
| | 5. Verify dark theme rendering |
| **Expected** | - Light button: renders without `.dark` class |
| | - Dark button: renders with `.dark` class |
| | - Both buttons work from pre-render state |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-14: Clear (c key and Clear button)

| Item | Detail |
|------|--------|
| **Precondition** | Content is rendered (markdown or code view) |
| **Steps** | 1. Press `c` key OR click the Clear button |
| **Expected** | - Editor textarea is cleared |
| | - Preview returns to affordance text ("Get started:...") |
| | - Theme reverts to OS color scheme |
| | - Page is back to initial state |

| Result (c key) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

| Result (Clear btn) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-15: New Tab (n key and New Tab button)

| Item | Detail |
|------|--------|
| **Precondition** | Page is in any state |
| **Steps** | 1. Press `n` key OR click the New Tab button |
| **Expected** | - A new browser tab opens with the same URL |
| | - Original tab state is unchanged |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-16: Smooth Scroll (Arrow Keys)

| Item | Detail |
|------|--------|
| **Precondition** | Content is rendered (long enough to scroll) |
| **Steps** | 1. Press and hold ArrowDown key |
| | 2. Observe scrolling acceleration |
| | 3. Release ArrowDown |
| | 4. Observe deceleration (friction) |
| | 5. Repeat with ArrowUp |
| **Expected** | - Scroll accelerates while key is held |
| | - Scroll decelerates smoothly after key release |
| | - No scroll in initial (pre-render) state |
| | - Arrow keys do NOT interfere when textarea/input is focused |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-17: Keyboard Shortcuts in Textarea

| Item | Detail |
|------|--------|
| **Precondition** | Page is loaded |
| **Steps** | 1. Click into the editor textarea to focus it |
| | 2. Type `l`, `d`, `n`, `c` |
| **Expected** | - Characters are typed into the textarea normally |
| | - NO shortcut actions triggered (no theme change, no clear, no new tab) |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-18: Code View Reload (FileSystemFileHandle)

| Item | Detail |
|------|--------|
| **Precondition** | Code view active, using Chrome/Edge 86+ |
| **Steps** | 1. Drop a `.py` file to open code view |
| | 2. Edit the `.py` file externally (add a line) |
| | 3. Press `l` or `d` to reload |
| **Expected** | - File content is re-read from disk (no re-drop needed) |
| | - Updated content is displayed |
| | - Scroll position is preserved |
| | - Header timestamp and status bar are updated |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-19: Code View Reload (No FileSystemFileHandle - Firefox)

| Item | Detail |
|------|--------|
| **Precondition** | Code view active, using Firefox (no FileSystemFileHandle) |
| **Steps** | 1. Drop a `.py` file to open code view |
| | 2. Press `l` or `d` to attempt reload |
| **Expected** | - Toast notification: "Reload not available (Chrome/Edge 86+ required)" |
| | - Toast disappears after ~3 seconds |
| | - Current view is unchanged |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-20: Help Modal ([?] button)

| Item | Detail |
|------|--------|
| **Precondition** | Page is loaded |
| **Steps** | 1. Click the [?] button (short click) |
| **Expected** | - Help modal opens |
| | - Content is bilingual (English + Japanese) |
| | - Close button works |
| | - Clicking outside the modal closes it |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-21: MCBSMD Prompt Modal ([?] long press)

| Item | Detail |
|------|--------|
| **Precondition** | Page is loaded |
| **Steps** | 1. Long press the [?] button (hold ~300ms+) |
| **Expected** | - Prompt modal opens (NOT the help modal) |
| | - Contains MCBSMD prompt template text |
| | - Copy button works (copies to clipboard) |
| | - "Copied!" feedback shown briefly |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-22: Diagram Zoom (Ctrl+Scroll, PC only)

| Item | Detail |
|------|--------|
| **Precondition** | Markdown with Mermaid diagram rendered, using mouse/trackpad |
| **Steps** | 1. Hover over a rendered Mermaid diagram |
| | 2. Hold Ctrl and scroll up (zoom in) |
| | 3. Hold Ctrl and scroll down (zoom out) |
| **Expected** | - Diagram zooms in/out (0.5x to 5.0x range) |
| | - Zoom only affects the diagram, not the page |
| | - No zoom on touch-only devices |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-23: Diagram Copy (SVG/PNG)

| Item | Detail |
|------|--------|
| **Precondition** | Markdown with Mermaid diagram rendered, PC with fine pointer |
| **Steps** | 1. Hover over a rendered Mermaid diagram |
| | 2. Click the SVG copy button |
| | 3. Paste in an image editor / text editor |
| | 4. Click the PNG copy button |
| | 5. Paste in an image editor |
| **Expected** | - SVG button copies SVG data to clipboard |
| | - PNG button copies PNG image to clipboard |
| | - Feedback toast/button text shown on copy |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-24: OS Theme Auto-Detection

| Item | Detail |
|------|--------|
| **Precondition** | Access to OS dark/light mode toggle |
| **Steps** | 1. Set OS to light mode, load page -> verify light theme |
| | 2. Set OS to dark mode, load page -> verify dark theme |
| **Expected** | - Initial load respects OS `prefers-color-scheme` |
| | - Light: no `.dark` class on body |
| | - Dark: `.dark` class on body |

| Result (Light OS) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

| Result (Dark OS) | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-25: State Transitions (Cross-View Navigation)

| Item | Detail |
|------|--------|
| **Precondition** | Page is in initial state |
| **Steps** | 1. Drop `.py` file -> verify code view |
| | 2. Drop `.md` file -> verify markdown preview (code view replaced) |
| | 3. Drop `.js` file -> verify code view (markdown replaced) |
| | 4. Press `c` -> verify initial state (affordance text) |
| **Expected** | - Each transition replaces the previous view cleanly |
| | - No leftover DOM elements from previous views |
| | - Affordance text reappears on clear |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-26: AI Output Preprocessing

| Item | Detail |
|------|--------|
| **Precondition** | Page is in initial state |
| **Steps** | 1. Paste text wrapped in ` ```markdown ... ``` ` fences |
| | (e.g., AI tool output that wraps markdown in a code fence) |
| **Expected** | - The outer ` ```markdown ` and closing ` ``` ` are stripped |
| | - Inner content renders as normal Markdown |
| | - Inner code blocks (triple backticks) are preserved |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-27: Scroll Position Preserved on Re-Render

| Item | Detail |
|------|--------|
| **Precondition** | Long Markdown is rendered |
| **Steps** | 1. Scroll down to middle of page |
| | 2. Press `d` (re-render dark) |
| | 3. Observe scroll position |
| | 4. Press `l` (re-render light) |
| | 5. Observe scroll position |
| **Expected** | - Scroll position is maintained after each re-render |
| | - Content at the same position is visible |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

### TC-28: Console Error Check

| Item | Detail |
|------|--------|
| **Precondition** | Browser DevTools open (Console tab) |
| **Steps** | 1. Perform TC-02 through TC-14 |
| | 2. Check browser console after each action |
| **Expected** | - No JavaScript errors in console |
| | - Warnings (if any) are expected (e.g., DOM stability timeout) |

| Result | Pass / Fail / N/A |
|--------|-------------------|
| Verdict | |
| Notes | |

---

## Test Summary

| Test Case | Description | Verdict |
|-----------|-------------|---------|
| TC-01 | Initial State (Affordance Text) | |
| TC-02 | Markdown Paste (Auto-Render) | |
| TC-03 | Markdown Paste (No Auto-Render when rendered) | |
| TC-04 | Drop .md File -> Markdown Preview | |
| TC-05a | PlantUML Consent - OK | |
| TC-05b | PlantUML Consent - Cancel | |
| TC-06 | Drop .py -> Code View | |
| TC-07 | Drop .txt -> Code View (Not Markdown) | |
| TC-08 | Drop Dockerfile (Extensionless) | |
| TC-09 | Drop .xyz -> Unsupported Alert | |
| TC-10 | Drop > 5MB -> Too Large Alert | |
| TC-11 | Theme Light (l key) | |
| TC-12 | Theme Dark (d key) | |
| TC-13 | Render Light / Dark Buttons | |
| TC-14 | Clear (c key + button) | |
| TC-15 | New Tab (n key + button) | |
| TC-16 | Smooth Scroll (Arrow Keys) | |
| TC-17 | Keyboard Shortcuts in Textarea | |
| TC-18 | Code View Reload (Chrome/Edge) | |
| TC-19 | Code View Reload (Firefox) | |
| TC-20 | Help Modal | |
| TC-21 | MCBSMD Prompt Modal (Long Press) | |
| TC-22 | Diagram Zoom | |
| TC-23 | Diagram Copy (SVG/PNG) | |
| TC-24 | OS Theme Auto-Detection | |
| TC-25 | State Transitions (Cross-View) | |
| TC-26 | AI Output Preprocessing | |
| TC-27 | Scroll Position Preserved | |
| TC-28 | Console Error Check | |

**Tester:** _______________
**Date:** _______________
**Overall Result:** Pass / Fail
**Signature:** _______________
