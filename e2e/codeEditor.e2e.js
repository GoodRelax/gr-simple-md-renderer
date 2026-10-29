import { test, expect } from "./fixtures.js";

// The code editor (SC-27): edit mode with its keys and Undo (INV-85 to
// INV-88), the JSON fold in the view and in the editor, the command palette
// (INV-92), the Index of a JSON file (INV-91), Search and Replace in the
// editor (INV-80), and Save as to a .md name (NE-19, NE-30).

const JSON_TEXT = '{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}\n';
const JSON_FOLDED = '{\n  "a": { "b": 1 },\n  "c": 2\n}\n';
const ASCII = (s) => [...s].map((c) => c.charCodeAt(0));
// "# " + three hiragana (Shift_JIS 82A0 82A2 82A4), CRLF, "text", CRLF
const SJIS_BYTES = [...ASCII("# "), 0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x0d, 0x0a, ...ASCII("text"), 0x0d, 0x0a];
const KANA = "\u3042\u3044\u3046"; // hiragana a, i, u

/**
 * Drop a file built from bytes (or a text) in the page.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {number[]|string} content
 */
async function drop(page, name, content, { waitForView = true } = {}) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      const data = typeof content === "string" ? content : new Uint8Array(content);
      dt.items.add(new File([data], name, { lastModified: Date.now() }));
      return dt;
    },
    { name, content },
  );
  await page.dispatchEvent("#preview", "dragover", { dataTransfer });
  await page.dispatchEvent("#preview", "drop", { dataTransfer });
  if (waitForView) await expect(page.locator("body")).toHaveClass(/\bview-(code|markdown)\b/);
}

/** Apple platforms (INV-14): Cmd is the primary modifier, Option the fold modifier. */
async function isApple(page) {
  return page.evaluate(() => {
    const platform = navigator.userAgentData?.platform;
    return platform ? platform === "macOS" : /Mac|iPhone|iPad/.test(navigator.platform);
  });
}

async function keys(page) {
  const apple = await isApple(page);
  return {
    primary: apple ? "Meta" : "Control",
    fold: apple ? "Alt" : "Control", // outside the editor: + ArrowLeft / ArrowRight
    foldInEditor: apple ? "Meta+Alt" : "Control+Shift", // + BracketLeft / BracketRight
  };
}

const editor = (page) => page.locator("#codeEditBody textarea.code-edit-input");

test("INV-85, INV-87 (1)(5), INV-88: edit a .json: e, type, Tab indents, primary+Z undoes it, Ctrl+Shift+[ folds in the editor", async ({ page }) => {
  await page.goto("/");
  await drop(page, "data.json", JSON_TEXT);
  const k = await keys(page);
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue(JSON_TEXT);
  await expect(page.locator("#paletteSave")).toBeVisible();
  await expect(page.locator("#paletteBold")).toBeHidden();
  // type a space after "c":
  const afterColon = JSON_TEXT.indexOf('"c":') + 4;
  await editor(page).evaluate((ta, at) => ta.setSelectionRange(at, at), afterColon);
  await page.keyboard.type(" ");
  const spaced = (text) => text.replace('"c": 2', '"c":  2');
  const typed = spaced(JSON_TEXT);
  await expect(editor(page)).toHaveValue(typed);
  await expect(page).toHaveTitle(/^\* /);
  // Tab on the "c" line: one unit (2 spaces) deeper
  const atC = typed.indexOf('  "c"');
  await editor(page).evaluate((ta, at) => ta.setSelectionRange(at, at), atC);
  await page.keyboard.press("Tab");
  await expect(editor(page)).toHaveValue(typed.replace('  "c"', '    "c"'));
  await page.keyboard.press(`${k.primary}+z`);
  await expect(editor(page)).toHaveValue(typed);
  await page.keyboard.press(`${k.foldInEditor}+BracketLeft`);
  await expect(editor(page)).toHaveValue(spaced(JSON_FOLDED));
  await page.keyboard.press(`${k.primary}+z`);
  await expect(editor(page)).toHaveValue(typed);
  // the palette's Redo (NE-2) redoes the fold; the focus stays in the editor
  await page.locator("#paletteRedo").click();
  await expect(editor(page)).toHaveValue(spaced(JSON_FOLDED));
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press(`${k.primary}+z`);
  await expect(editor(page)).toHaveValue(typed);
  // back to the view: the edited text is shown
  await page.keyboard.press("Escape");
  await page.keyboard.press("e");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("#codeViewBody .code-line").nth(4)).toHaveText('  "c":  2');
});

test("INV-92 (2)(4): view mode: Ctrl+Left folds the display without the unsaved mark; Ctrl+Right unfolds it", async ({ page }) => {
  await page.goto("/");
  await drop(page, "data.json", JSON_TEXT);
  const k = await keys(page);
  const lines = page.locator("#codeViewBody .code-line");
  await expect(lines).toHaveCount(7);
  await page.keyboard.press(`${k.fold}+ArrowLeft`);
  await expect(lines).toHaveCount(5);
  await expect(lines.nth(1)).toHaveText('  "a": { "b": 1 },');
  await expect(page).not.toHaveTitle(/^\* /);
  await page.keyboard.press(`${k.fold}+ArrowRight`);
  await expect(lines).toHaveCount(7);
});

test("INV-92 (5): p opens the command palette; its buttons fold and unfold, it stays open; Esc closes it", async ({ page }) => {
  await page.goto("/");
  await drop(page, "data.json", JSON_TEXT);
  await expect(page.locator("#commandsBtn")).toBeEnabled();
  await page.keyboard.press("p");
  const box = page.locator("#codeCommandPalette");
  await expect(box).toBeVisible();
  const [fold, unfold] = [box.locator("button").nth(0), box.locator("button").nth(1)];
  await expect(fold).toBeFocused();
  const lines = page.locator("#codeViewBody .code-line");
  await fold.click();
  await expect(lines).toHaveCount(5);
  await unfold.click();
  await expect(lines).toHaveCount(7);
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

test("INV-91 (1)(3): the Index lists the JSON keys and a pick scrolls to its line", async ({ page }) => {
  const members = Array.from({ length: 150 }, (_, i) => `  "key${i}": ${i}`).join(",\n");
  await page.goto("/");
  await drop(page, "big.json", `{\n${members}\n}\n`);
  await page.keyboard.press("i");
  const entries = page.locator("#indexPanel .index-entry");
  await expect(entries).toHaveCount(150);
  await expect(entries.first()).toHaveText("key0");
  const last = page.locator("#codeViewBody .code-line").nth(150);
  await expect(last).not.toBeInViewport();
  await entries.last().click();
  await expect(last).toBeInViewport();
});

test("INV-80 (5), INV-88 (1)(4): Search in edit mode: Replace all changes the editor's text; primary+Z outside the editor undoes it", async ({ page }) => {
  await page.goto("/");
  await drop(page, "pets.txt", "cat dog cat\n");
  const k = await keys(page);
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  await page.locator("#paletteSearch").click(); // NE-2: as primary+F
  await expect(page.locator("#searchInput")).toBeFocused();
  await page.locator("#searchInput").press("Escape");
  await expect(page.locator("#searchPanel")).toBeHidden();
  await editor(page).focus();
  await page.keyboard.press(`${k.primary}+f`);
  await expect(page.locator("#searchInput")).toBeFocused();
  await page.keyboard.type("cat");
  await expect(page.locator("#searchCount")).toHaveText("1 / 2");
  await page.locator("#replaceInput").fill("cow");
  await page.locator("#replaceAllBtn").click();
  await expect(editor(page)).toHaveValue("cow dog cow\n");
  await page.locator("#searchInput").press("Escape");
  await expect(page.locator("#searchPanel")).toBeHidden();
  await page.keyboard.press(`${k.primary}+z`);
  await expect(editor(page)).toHaveValue("cat dog cat\n");
});

test("INV-90 (6)(8), NE-30: Save as a Shift_JIS file to x.md (fake save dialog): written in UTF-8 with a toast, reopened in the Markdown view", async ({ page }) => {
  await page.addInitScript(() => {
    window.__e2eSaves = [];
    window.showSaveFilePicker = async (options) => {
      const record = { suggestedName: options?.suggestedName, bytes: [] };
      window.__e2eSaves.push(record);
      let lastModified = Date.now();
      return {
        kind: "file",
        name: "x.md",
        async requestPermission() {
          return "granted";
        },
        async createWritable() {
          return {
            async write(data) {
              record.bytes.push(...(typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)));
            },
            async close() {
              lastModified = Date.now();
            },
            async abort() {},
          };
        },
        async getFile() {
          return new File([new Uint8Array(record.bytes)], "x.md", { lastModified });
        },
      };
    };
  });
  await page.goto("/");
  await drop(page, "notes.txt", SJIS_BYTES, { waitForView: false }); // the open dialog asks first
  await page.locator("#codeOpenBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  const k = await keys(page);
  await page.keyboard.press(`${k.primary}+Shift+S`);
  await page.locator("#codeSaveOriginalBtn").click();
  await expect(page.locator("#toastContainer")).toContainText("Saved in UTF-8: .md files are always UTF-8.");
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  await expect(page.locator("#preview h1")).toHaveText(KANA);
  const saves = await page.evaluate(() => window.__e2eSaves);
  expect(saves[0].suggestedName).toBe("notes.txt");
  expect(saves[0].bytes).toEqual([...new TextEncoder().encode(`# ${KANA}\r\ntext\r\n`)]);
});

test("INV-87 (1), INV-88 (N1): Tab, Shift+Tab, Undo and Redo in a 300 KB file write only the lines they change (no assignment of the whole value, no input event), one undo step each", async ({ page }) => {
  await page.goto("/");
  const line = "function f(a) {\n  return a + 1;\n}\n";
  const text = line.repeat(Math.ceil((300 * 1024) / line.length));
  await drop(page, "big.js", text);
  const k = await keys(page);
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  // count, not time (G12): whole-value writes, the parts written, and input events
  const at = await page.evaluate(() => {
    window.__valueWrites = 0;
    window.__parts = [];
    window.__inputs = 0;
    const proto = HTMLTextAreaElement.prototype;
    const value = Object.getOwnPropertyDescriptor(proto, "value");
    Object.defineProperty(proto, "value", {
      ...value,
      set(v) {
        window.__valueWrites++;
        value.set.call(this, v);
      },
    });
    const setRangeText = proto.setRangeText;
    proto.setRangeText = function (inserted, start, end, ...rest) {
      window.__parts.push([inserted.length, end - start]);
      return setRangeText.call(this, inserted, start, end, ...rest);
    };
    const ta = document.querySelector("#codeEditBody textarea");
    ta.addEventListener("input", () => window.__inputs++);
    const v = ta.value;
    const from = v.indexOf("\n", v.length >> 1) + 1;
    ta.setSelectionRange(from, v.indexOf("\n", v.indexOf("\n", from) + 1)); // two lines
    return from;
  });
  const lines = text.slice(at, text.indexOf("\n", text.indexOf("\n", at) + 1));
  const deeper = "  " + lines.replace("\n", "\n  ");
  const indented = text.slice(0, at) + deeper + text.slice(at + lines.length);
  await page.keyboard.press("Tab");
  await expect.poll(() => editor(page).evaluate((ta) => ta.value.length)).toBe(indented.length);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => editor(page).evaluate((ta) => ta.value.length)).toBe(text.length);
  await page.keyboard.press(`${k.primary}+z`); // the Shift+Tab
  await expect.poll(() => editor(page).evaluate((ta) => ta.value.length)).toBe(indented.length);
  await page.keyboard.press(`${k.primary}+z`); // the Tab
  await expect.poll(() => editor(page).evaluate((ta) => ta.value.length)).toBe(text.length);
  await page.keyboard.press(`${k.primary}+Shift+z`); // Redo the Tab
  await expect.poll(() => editor(page).evaluate((ta) => ta.value.length)).toBe(indented.length);
  const result = await page.evaluate(
    ({ indented }) => {
      const ta = document.querySelector("#codeEditBody textarea");
      return { same: ta.value === indented, valueWrites: window.__valueWrites, parts: window.__parts, inputs: window.__inputs };
    },
    { indented },
  );
  const [d, l] = [deeper.length, lines.length];
  expect(result).toEqual({ same: true, valueWrites: 0, parts: [[d, l], [l, d], [d, l], [l, d], [d, l]], inputs: 0 });
});

test("INV-86 (M1): typing in a 40 KB file (colored) writes neither the layer nor the gutter on a key; when typing stops both follow and the textarea is unscrolled and as large as its text", async ({ page }) => {
  await page.goto("/");
  const line = "const value = 1234567890; // a line of a big file\n";
  await drop(page, "big.js", line.repeat(Math.ceil((40 * 1024) / line.length)));
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  // count the DOM writes of the layer and the gutter; a write seen while the
  // typing class is still on came from a key (the pause writes and takes the
  // class off in one task), so a pause that fires between two keys of a
  // loaded machine does not count (no timing in the check)
  await page.evaluate(() => {
    window.__writes = 0;
    window.__keyWrites = 0;
    window.__inputs = [];
    const root = document.querySelector("#codeEditBody");
    const observer = new MutationObserver((records) => {
      window.__writes += records.length;
      if (root.classList.contains("code-edit-typing")) window.__keyWrites += records.length;
    });
    for (const el of document.querySelectorAll("#codeEditBody .code-edit-gutter, #codeEditBody .code-edit-layer")) {
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    window.__observer = observer;
    const ta = document.querySelector("#codeEditBody textarea");
    // after the app's own input handler: the typing look is on at each key
    ta.addEventListener("input", () => window.__inputs.push(root.classList.contains("code-edit-typing")));
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  // within one pause: every key comes before highlightPauseMs (0.2 s) after the last
  await page.keyboard.type("x = 1;", { delay: 0 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y = 2;", { delay: 0 });
  const during = await page.evaluate(() => ({ keyWrites: window.__keyWrites, inputs: window.__inputs }));
  expect(during).toEqual({ keyWrites: 0, inputs: Array(14).fill(true) });
  // after the pause: the gutter has the two new lines
  await expect(page.locator("#codeEditBody")).not.toHaveClass(/code-edit-typing/);
  const after = await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    const gutter = document.querySelector("#codeEditBody .code-edit-gutter").textContent;
    return {
      writes: window.__writes > 0,
      lastNumber: Number(gutter.slice(gutter.lastIndexOf("\n") + 1)),
      lines: ta.value.split("\n").length,
      unscrolled: ta.scrollTop === 0 && ta.scrollLeft === 0,
      fits: ta.scrollHeight <= ta.clientHeight + 1,
    };
  });
  expect(after).toEqual({ writes: true, lastNumber: after.lines, lines: after.lines, unscrolled: true, fits: true });
});
