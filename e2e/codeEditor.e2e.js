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

/**
 * Watch each input event of the editor: right after the app's handler, the
 * look of the editor (the layer shown, the textarea's text transparent,
 * the layer's text the textarea's) and the DOM writes that handler made on
 * the layer and the gutter. The capture phase drops the records of the
 * pause; the bubble phase takes the key's: those still queued and those
 * delivered in between (after a listener of a key's own input event the
 * microtasks run, so the observer's callback gets them first).
 * @param {import("@playwright/test").Page} page
 */
async function watchKeys(page) {
  await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    const layer = document.querySelector("#codeEditBody .code-edit-layer");
    const gutter = document.querySelector("#codeEditBody .code-edit-gutter");
    window.__unwatch?.(); // the editor of an earlier edit mode
    let delivered = [];
    const observer = new MutationObserver((records) => delivered.push(...records));
    observer.observe(layer, { childList: true, characterData: true, subtree: true });
    observer.observe(gutter, { childList: true, characterData: true, subtree: true });
    window.__keys = [];
    const skip = () => {
      observer.takeRecords();
      delivered = [];
    };
    const look = () => {
      const records = [...delivered, ...observer.takeRecords()];
      delivered = [];
      // the places written: a block of lines, or the layer's <code> for blocks added or removed
      const places = new Set(records.map((r) => (r.target.nodeType === 1 ? r.target : r.target.parentElement).closest(".code-edit-block") ?? r.target));
      window.__keys.push({
        layerShown: getComputedStyle(layer).visibility === "visible",
        textTransparent: getComputedStyle(ta).color === "rgba(0, 0, 0, 0)",
        layerHoldsText: layer.textContent === ta.value + "\n",
        gutterWrites: records.filter((r) => gutter.contains(r.target)).length,
        placesWritten: [...places].filter((el) => layer.contains(el)).length,
      });
    };
    // a line of the layer as HTML (a block holds lines, each closed at its line feed):
    // the line at a 0-based index, or the first line whose text holds a needle
    const layerLines = () => [...layer.querySelectorAll(".code-edit-block")].flatMap((block) => block.innerHTML.split("\n").slice(0, -1));
    const textOf = (html) => new DOMParser().parseFromString(html, "text/html").body.textContent;
    window.__layerLineAt = (index) => layerLines()[index] ?? null;
    window.__layerLine = (needle) => layerLines().find((html) => textOf(html).includes(needle)) ?? null;
    window.addEventListener("input", skip, { capture: true });
    window.addEventListener("input", look);
    window.__unwatch = () => {
      window.removeEventListener("input", skip, { capture: true });
      window.removeEventListener("input", look);
      observer.disconnect();
    };
  });
}

test("INV-86 (BI-26): typing in a 40 KB file (colored), dark and light: on every key the layer stays shown, the textarea's text stays transparent and the layer holds the text (the typed text colored at once); a key writes one or two lines of the layer and never the gutter; when typing stops the gutter follows and the textarea is unscrolled and as large as its text", async ({ page }) => {
  await page.goto("/");
  const line = "const value = 1234567890; // a line of a big file\n";
  await drop(page, "big.js", line.repeat(Math.ceil((40 * 1024) / line.length)));
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.keyboard.press("l");
    if (theme === "dark") await expect(page.locator("body")).toHaveClass(/\bdark\b/);
    else await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
    await page.keyboard.press("e");
    await expect(editor(page)).toBeFocused();
    await watchKeys(page);
    await page.evaluate(() => {
      const ta = document.querySelector("#codeEditBody textarea");
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    // keys within one pause and keys each after a pause: the flicker came at each key after a pause
    const [name, digit] = theme === "dark" ? ["z", "5"] : ["w", "7"];
    await page.keyboard.type(`const ${name} = ${digit};`, { delay: 0 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("let y", { delay: 300 });
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    const keys = await page.evaluate(() => window.__keys);
    expect(keys).toHaveLength(21); // 12 + 2 Enter + 5 + 2 Backspace
    for (const key of keys) {
      expect(key).toEqual({ layerShown: true, textTransparent: true, layerHoldsText: true, gutterWrites: 0, placesWritten: key.placesWritten });
      expect(key.placesWritten).toBeGreaterThanOrEqual(1);
      expect(key.placesWritten).toBeLessThanOrEqual(2);
    }
    // the typed line is colored (highlight.js tokens)
    const typed = await page.evaluate((needle) => window.__layerLine(needle), `const ${name} = ${digit};`);
    expect(typed).toContain('<span class="hljs-keyword">const</span>');
    expect(typed).toContain(`<span class="hljs-number">${digit}</span>`);
    await expect(page.locator("#codeEditBody")).not.toHaveClass(/code-edit-typing/);
    // after the pause: the gutter has the new lines
    const lines = await editor(page).evaluate((ta) => ta.value.split("\n").length);
    await expect.poll(() => page.evaluate(() => document.querySelector("#codeEditBody .code-edit-gutter").textContent.split("\n").length)).toBe(lines);
    const after = await editor(page).evaluate((ta) => {
      // the layer's blocks (block boxes) give each line its height, the last empty line too
      const layer = document.querySelector("#codeEditBody .code-edit-layer");
      const lineHeight = parseFloat(getComputedStyle(layer).lineHeight);
      const lines = ta.value.split("\n").length;
      return {
        unscrolled: ta.scrollTop === 0 && ta.scrollLeft === 0,
        fits: ta.scrollHeight <= ta.clientHeight + 1,
        // a line is laid out in 1/64 px steps (20.796875 px for 20.8 px)
        layerHeight: Math.abs(layer.getBoundingClientRect().height - (lines * lineHeight + 8 + 36)) <= 1 + lines / 64,
      };
    });
    expect(after).toEqual({ unscrolled: true, fits: true, layerHeight: true });
    await page.keyboard.press("Enter"); // the next round types on a line of its own
    await page.keyboard.press("Escape"); // the focus leaves the textarea
    await page.keyboard.press("e"); // edit mode ends: the view again
    await expect(page.locator("#codeEditBody")).toHaveCount(0);
  }
});

test("INV-86 (c) (BI-26): IME composition in a colored file: the composition's text shows on the layer at once, underlined (a CSS highlight), its line colored whole; the layer stays shown; the underline goes when it is committed", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "IME composition is driven through the Chromium DevTools protocol");
  await page.goto("/");
  await drop(page, "data.json", JSON_TEXT);
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    const at = ta.value.indexOf("2");
    ta.setSelectionRange(at, at);
  });
  await watchKeys(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "\u3042", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "\u3042\u3044", selectionStart: 2, selectionEnd: 2 });
  const underlined = () => page.evaluate(() => CSS.highlights.get("grsmd-code-composing")?.values().next().value?.toString() ?? null);
  await expect.poll(underlined).toBe("\u3042\u3044");
  // the line holding the composition is colored as one line (its key keeps its color)
  const line = () => page.evaluate(() => window.__layerLine("\u3042\u30442"));
  expect(await line()).toContain('<span class="hljs-attr">');
  await cdp.send("Input.insertText", { text: "\u3042\u3044" });
  await expect(editor(page)).toHaveValue(JSON_TEXT.replace("2", "\u3042\u30442"));
  await expect.poll(underlined).toBeNull();
  const keys = await page.evaluate(() => window.__keys);
  expect(keys.length).toBeGreaterThanOrEqual(2);
  for (const key of keys) expect([key.layerShown, key.textTransparent, key.layerHoldsText, key.gutterWrites]).toEqual([true, true, true, 0]);
  expect(await line()).toContain('<span class="hljs-attr">');
});

for (const [name, text] of [
  ["page.html", "<!doctype html>\n<script>\nconst a = 1;\nlet b = 2;\n</script>\n<style>\nbody { color: red; }\np { margin: 0; }\n</style>\n"],
  ["comp.vue", "<template>\n  <p>x</p>\n</template>\n<script>\nconst a = 1;\nlet b = 2;\n</script>\n<style>\nbody { color: red; }\np { margin: 0; }\n</style>\n"],
  ["comp.svelte", "<script>\nconst a = 1;\nlet b = 2;\n</script>\n<p>x</p>\n<style>\nbody { color: red; }\np { margin: 0; }\n</style>\n"],
]) {
  test(`INV-86 (b) (BI-26): ${name}: typing in the <script> and the <style> (highlight.js sub-languages over lines) keeps the line colored on every key, each key after a pause`, async ({ page }) => {
    await page.goto("/");
    await drop(page, name, text);
    await page.keyboard.press("e");
    await expect(editor(page)).toBeFocused();
    await watchKeys(page);
    // after each key's own handler: the typed line still has highlight.js tokens
    await page.evaluate(() => {
      window.__colored = [];
      window.__line = -1;
      window.addEventListener("input", () => window.__colored.push(/class="hljs-/.test(window.__layerLineAt(window.__line) ?? "")));
    });
    for (const [after, typed, token] of [
      ["let b", "c", "hljs-keyword"],
      ["body { color", "x", "hljs-selector-tag"],
    ]) {
      await editor(page).evaluate((ta, at) => {
        const end = ta.value.indexOf(at) + at.length;
        ta.setSelectionRange(end, end);
        window.__line = ta.value.slice(0, end).split("\n").length - 1;
      }, after);
      await page.keyboard.type(typed.repeat(3), { delay: 300 });
      const line = await page.evaluate((needle) => window.__layerLine(needle), after + typed.repeat(3));
      expect(line).toContain(`class="${token}"`);
    }
    const look = await page.evaluate(() => ({ keys: window.__keys, colored: window.__colored }));
    expect(look.colored).toEqual(Array(6).fill(true));
    for (const key of look.keys) expect([key.layerShown, key.textTransparent, key.layerHoldsText, key.gutterWrites]).toEqual([true, true, true, 0]);
  });
}

test("INV-86 (b)(e) (BI-26): a one-line JSON of 20 KB (over typedColorMaxChars): each key writes its characters, Enter and Backspace over a line feed too, into the line's text in its own handler, every token kept and the place's colors on (colored on the screen at once, never plain), each key after a pause; the pause colors it again", async ({ page }) => {
  await page.goto("/");
  const items = Array.from({ length: 1000 }, (_, i) => `{"id":${i},"name":"item${i}"}`);
  await drop(page, "min.json", `[${items.join(",")}]`);
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
  await watchKeys(page);
  await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    const at = ta.value.indexOf('"item500"') + 5;
    ta.setSelectionRange(at, at);
    window.__colored = [];
    const tokens = (layer) => [...layer.querySelectorAll(".code-edit-chunk")].reduce((sum, chunk) => sum + JSON.parse(chunk.getAttribute("data-tokens")).length, 0);
    const texts = (ranges) => [...(ranges ?? [])].map((range) => range.startContainer.data.slice(range.startOffset, range.endOffset));
    window.__colorsAtCaret = () => texts(CSS.highlights.get("grsmd-code-string"));
    // Spec: INV-86 (e).
    window.addEventListener("input", () => {
      const layer = document.querySelector("#codeEditBody .code-edit-layer");
      window.__colored.push(tokens(layer) >= 4000 && window.__colorsAtCaret().length > 0);
    });
  });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => page.evaluate(() => window.__colorsAtCaret())).toContain('"item500"');
  await page.keyboard.type("abc", { delay: 300 });
  expect(await page.evaluate(() => window.__colorsAtCaret())).toContain('"itemabc500"');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  await expect(editor(page)).toHaveValue(/"itemabc500"/);
  expect(await page.evaluate(() => window.__colored)).toEqual(Array(5).fill(true));
  const keys = await page.evaluate(() => window.__keys);
  expect(keys).toHaveLength(5);
  // Why: the Backspace joins the two lines' blocks (a long line has a block of its own), so two places
  keys.forEach((key, index) => expect(key).toEqual({ layerShown: true, textTransparent: true, layerHoldsText: true, gutterWrites: 0, placesWritten: index === 4 ? 2 : 1 }));
  // after the pause: the typed name colored as one string
  await expect.poll(() => page.evaluate(() => window.__colorsAtCaret())).toContain('"itemabc500"');
});
