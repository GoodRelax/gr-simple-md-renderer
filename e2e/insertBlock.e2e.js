import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// Insert table / Mermaid (INV-52, request 1) in real browsers: the open
// editor is committed and cut at a line boundary, the table's Col1 opens
// selected (typing replaces it), code / math / HTML / a table's source
// refuse with a toast, Undo takes only the inserted block away, and the
// opened cell is scrolled into view the least. No request leaves the page
// (the fixture checks it).

const T = "| Col1 | Col2 | Col3 |";
// CONFIG.edit.tableTemplate: the whole table as inserted (nothing typed in it)
const TABLE = `${T}\n|---|---|---|\n|  |  |  |\n|  |  |  |\n|  |  |  |`;
const REFUSED = "Can't insert here. Try outside this block.";

async function openEditMode(page, markdown) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
}

/** Open the block whose text starts with start, put text in it and the caret at caret. */
async function editBlock(page, start, text, caret) {
  await page.locator("#preview > .md-block", { hasText: start }).first().click();
  const ta = page.locator("textarea.md-block-editor");
  await expect(ta).toBeVisible();
  await ta.evaluate(
    (el, { text, caret }) => {
      if (text !== null) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.focus();
      el.setSelectionRange(caret, caret);
    },
    { text, caret },
  );
  return ta;
}

const body = (page) => page.locator("#editor").inputValue();
const selected = (page) => page.evaluate(() => window.getSelection().toString());
const editingCell = (page) => page.locator("#preview .grsmd-cell-editing");

test("an empty document: Edit, Insert table: the table only, Col1 open and selected, typing replaces it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#editBtn").click();
  await expect(page.locator("textarea.md-block-editor")).toBeVisible();
  await page.locator("#paletteTable").click();
  await expect(editingCell(page)).toHaveText("Col1");
  expect(await selected(page)).toBe("Col1");
  await page.keyboard.type("Name");
  await page.keyboard.press("Tab");
  await expect(page.locator("#preview table tr").first().locator("th").first()).toHaveText("Name");
  expect(await page.locator("textarea.md-block-editor").count()).toBe(0);
  expect((await body(page)).startsWith("| Name")).toBe(true);
});

test.describe("while editing a block: cut at a line boundary", () => {
  const DOC = "# Doc\n\nPara one.\n\nEnd.\n";
  // the whole body after the insert: both parts of the cut, the table between
  const doc = (middle) => `# Doc\n\n${middle}\n\nEnd.\n`;
  for (const [name, text, caret, expected] of [
    ["the caret in the first line", "Line one\nLine two", 4, doc(`Line one\n\n${TABLE}\n\nLine two`)],
    ["the caret at the start of the second line", "Line one\nLine two", 9, doc(`Line one\n\n${TABLE}\n\nLine two`)],
    ["the caret at the very start: above", "Line one\nLine two", 0, doc(`${TABLE}\n\nLine one\nLine two`)],
    ["the caret in the last line: below", "Line one\nLine two", 13, doc(`Line one\nLine two\n\n${TABLE}`)],
    ["a list: two lists", "- a\n- b", 3, doc(`- a\n\n${TABLE}\n\n- b`)],
    ["a list item of two lines: cut after the item", "- a\n  more\n- b", 3, doc(`- a\n  more\n\n${TABLE}\n\n- b`)],
    ["a quote: two quotes", "> a\n> b", 3, doc(`> a\n\n${TABLE}\n\n> b`)],
    ["bold over two lines is not cut: below the paragraph", "alpha **beta\ngamma** delta", 3, doc(`alpha **beta\ngamma** delta\n\n${TABLE}`)],
    ["a backslash line break at the cut goes", "one\\\ntwo", 2, doc(`one\n\n${TABLE}\n\ntwo`)],
  ]) {
    test(name, async ({ page }) => {
      await openEditMode(page, DOC);
      await editBlock(page, "Para one.", text, caret);
      await page.locator("#paletteTable").click();
      await expect(editingCell(page)).toHaveText("Col1");
      expect(await selected(page)).toBe("Col1");
      expect(await body(page)).toBe(expected);
    });
  }

  test("an underlined heading is not cut: the table goes below it", async ({ page }) => {
    await openEditMode(page, "Title\n=====\n\nEnd.\n");
    await editBlock(page, "Title", null, 3);
    await page.locator("#paletteTable").click();
    await expect(editingCell(page)).toHaveText("Col1");
    expect(await body(page)).toBe(`Title\n=====\n\n${TABLE}\n\nEnd.\n`);
  });

  test("a cut drops the line end spaces that no longer break a line", async ({ page }) => {
    await openEditMode(page, DOC);
    await editBlock(page, "Para one.", "x  \ny", 1);
    await page.locator("#paletteTable").click();
    await expect(editingCell(page)).toHaveText("Col1");
    expect(await body(page)).toContain(`# Doc\n\nx\n\n${T}`);
  });

  test("letters typed right after the press are not shortcuts (no new tab, no Clear)", async ({ page, context }) => {
    await openEditMode(page, DOC);
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    await editBlock(page, "Para one.", null, 3);
    await page.locator("#paletteTable").click();
    const popup = page.waitForEvent("popup", { timeout: 1000 }).then(
      () => true,
      () => false,
    );
    await page.keyboard.type("ncrd", { delay: 0 });
    // the letters typed before the cell opened are dropped; the rest replace Col1
    await expect(editingCell(page)).toHaveText(/^(Col1|n?c?r?d)$/);
    expect(await popup).toBe(false);
    expect(context.pages()).toHaveLength(1);
    expect(dialogs).toBe(0);
    await expect(page.locator("#paletteSave")).toBeVisible();
  });

  test("Undo once: only the table goes; the edit made before it stays", async ({ page }) => {
    await openEditMode(page, DOC);
    await editBlock(page, "Para one.", "Line one\nLine two", 4);
    await page.locator("#paletteTable").click();
    await expect(editingCell(page)).toHaveText("Col1");
    await page.keyboard.press("Escape");
    await page.locator("#paletteUndo").click();
    await settled(page);
    expect(await body(page)).toBe("# Doc\n\nLine one\nLine two\n\nEnd.\n");
    await expect(page.locator("#paletteUndo")).toHaveAttribute("aria-disabled", "true");
  });

  test("Mermaid: the sample's source opens, the caret at the end of `flowchart TD`", async ({ page }) => {
    await openEditMode(page, DOC);
    await editBlock(page, "Para one.", null, 3);
    await page.locator("#paletteMermaid").click();
    await page.locator(".edit-palette-popover button[aria-label='Flowchart']").click();
    const ta = page.locator("textarea.md-block-editor");
    await expect(ta).toHaveValue(/^```mermaid\nflowchart TD\n/);
    const caret = await ta.evaluate((el) => [el.selectionStart, el.selectionEnd]);
    expect(caret).toEqual(["```mermaid\nflowchart TD".length, "```mermaid\nflowchart TD".length]);
    expect(await body(page)).toContain("Para one.\n\n```mermaid\nflowchart TD");
  });
});

test.describe("refused with a toast: nothing changes, the editor stays", () => {
  const DOC = [
    "# Doc",
    "",
    "```js",
    "const code = 1;",
    "```",
    "",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
    "",
    "$$",
    "x^2",
    "$$",
    "",
    "<div>",
    "html note",
    "</div>",
    "",
    "- step",
    "  ```sh",
    "  npm run",
    "  ```",
    "",
    "Indented code next:",
    "",
    "    indented code line",
    "",
    "> quoted",
    "> ```",
    "> quoted code",
    "> ```",
    "",
    "Between the lists.",
    "",
    "- item",
    "",
    "  | p | q |",
    "  | --- | --- |",
    "  | r | s |",
    "",
    "| A | B |",
    "| --- | --- |",
    "| x | y |",
    "",
  ].join("\n");

  for (const [name, open, caret] of [
    ["a code block", "const code", 8],
    ["a math block", null, 4],
    ["an HTML block", "html note", 8],
    ["code in a list item", "step", 20],
    ["a table in a list item", "item", 40],
    ["indented code", "indented code line", 6],
    ["code in a quote", "quoted", 18],
  ]) {
    test(name, async ({ page }) => {
      await openEditMode(page, DOC);
      if (open) await editBlock(page, open, null, caret);
      else {
        await page.locator("#preview > .md-block", { has: page.locator(".katex-display") }).click();
        await page.locator("textarea.md-block-editor").evaluate((el, c) => el.setSelectionRange(c, c), caret);
      }
      const before = await page.locator("textarea.md-block-editor").inputValue();
      await page.locator("#paletteTable").click();
      await expect(page.locator("#toastContainer")).toContainText(REFUSED);
      await expect(page.locator("textarea.md-block-editor")).toHaveValue(before);
      expect(await body(page)).toBe(DOC);
      expect(await editingCell(page).count()).toBe(0);
    });
  }

  test("a Mermaid block", async ({ page }) => {
    await openEditMode(page, DOC);
    await page.locator("#preview > .md-block", { has: page.locator(".mermaid") }).click();
    const ta = page.locator("textarea.md-block-editor");
    await expect(ta).toHaveValue(/^```mermaid/);
    await ta.evaluate((el) => el.setSelectionRange(15, 15));
    await page.locator("#paletteTable").click();
    await expect(page.locator("#toastContainer")).toContainText(REFUSED);
    await expect(ta).toHaveValue(/^```mermaid/);
    expect(await body(page)).toBe(DOC);
  });

  test("a PlantUML block (its consent refused: nothing is sent, the fixture checks it)", async ({ page }) => {
    const markdown = "# Doc\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n";
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss(); // Cancel: the diagram is not sent (INV-02)
    });
    await openEditMode(page, markdown);
    await expect(page.locator("#preview .plantuml-error")).toBeVisible();
    expect(dialogs).toHaveLength(1);
    await page.locator("#preview .plantuml-error").click();
    const ta = page.locator("textarea.md-block-editor");
    await expect(ta).toHaveValue(/^```plantuml/);
    await ta.evaluate((el) => el.setSelectionRange(15, 15));
    await page.locator("#paletteTable").click();
    await expect(page.locator("#toastContainer")).toContainText(REFUSED);
    await expect(ta).toHaveValue(/^```plantuml/);
    expect(await body(page)).toBe(markdown);
    expect(dialogs).toHaveLength(1); // no new consent dialog either
  });

  test("a table's source", async ({ page }) => {
    await openEditMode(page, DOC);
    await page.locator("#preview > .md-block-table .grsmd-table-tab").click();
    await page.locator("textarea.md-block-editor").evaluate((el) => el.setSelectionRange(3, 3));
    await page.locator("#paletteTable").click();
    await expect(page.locator("#toastContainer")).toContainText(REFUSED);
    await expect(page.locator("textarea.md-block-editor")).toHaveValue(/^\| A \| B \|/);
    expect(await body(page)).toBe(DOC);
  });
});

test("the opened cell is scrolled into view the least, and not at all when it is in view", async ({ page }) => {
  const paras = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of the long document.`);
  await openEditMode(page, `${paras.join("\n\n")}\n`);
  // in view: nothing moves (the edited block keeps its top)
  const top = await page.locator("#preview > .md-block", { hasText: /^Paragraph 2 of/ }).evaluate((el) => el.getBoundingClientRect().top);
  const scroll = await page.locator("#preview").evaluate((el) => el.scrollTop);
  await editBlock(page, /^Paragraph 2 of/, null, 5);
  await page.locator("#paletteTable").click();
  await expect(editingCell(page)).toHaveText("Col1");
  expect(await page.locator("#preview").evaluate((el) => el.scrollTop)).toBe(scroll);
  const after = await page.locator("#preview > .md-block", { hasText: /^Paragraph 2 of/ }).evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(after - top)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  // out of view: the last opened block sits at the bottom edge; the new
  // table goes after it, and its Col1 comes just to the bottom edge
  const target = page.locator("#preview > .md-block", { hasText: /^Paragraph 40 of/ });
  await target.click();
  await page.keyboard.press("Escape");
  await page.locator("#preview").evaluate((preview, el) => {
    const r = el.getBoundingClientRect();
    const p = preview.getBoundingClientRect();
    preview.scrollTop += r.bottom - (p.top + preview.clientHeight) + 2;
  }, await target.elementHandle());
  await settled(page);
  await page.locator("#paletteTable").click();
  await expect(editingCell(page)).toHaveText("Col1");
  const place = await editingCell(page).evaluate((cell) => {
    const preview = document.querySelector("#preview");
    const r = cell.getBoundingClientRect();
    return { bottom: r.bottom, edge: preview.getBoundingClientRect().top + preview.clientHeight };
  });
  expect(Math.abs(place.bottom - place.edge)).toBeLessThanOrEqual(2);
});
