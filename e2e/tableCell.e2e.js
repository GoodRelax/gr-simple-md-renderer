import { test, expect, renderMarkdown, dropFile } from "./fixtures.js";

// Table cells edited in place (INV-62 to INV-65) in real browsers: typing in
// a contenteditable cell, the keys, and the table element kept between cell
// commits (UIR-01, PRT-X21). jsdom cannot type into a cell; this can.

const DOC = ["# Cells", "", "| Name | Note |", "| --- | --- |", "| Yamada | **bold** |", "| Suzuki | plain |", ""].join("\n");

async function openEditMode(page, markdown = DOC) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
}

const cell = (page, r, c) => page.locator("#preview table").first().locator("tr").nth(r).locator("th, td").nth(c);

test("type in a cell, Tab to the next: the source is aligned, the table element is the same", async ({ page }) => {
  await openEditMode(page);
  await page.evaluate(() => {
    window.__e2eTable = document.querySelector("#preview table");
    window.__e2eWrapper = window.__e2eTable.parentElement;
  });
  await cell(page, 1, 0).click();
  await expect(cell(page, 1, 0)).toHaveAttribute("contenteditable", /plaintext-only|true/);
  await page.keyboard.press("End");
  await page.keyboard.type(" Taro");
  await page.keyboard.press("Tab");
  await expect(cell(page, 1, 1)).toHaveClass(/grsmd-cell-editing/);
  await expect(cell(page, 1, 0)).not.toHaveAttribute("contenteditable", /.*/);
  await expect(cell(page, 1, 0)).toHaveText("Yamada Taro");
  await expect(page.locator("#editor")).toHaveValue(/\| Yamada Taro \| \*\*bold\*\* \|/);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Enter"); // the cell below
  await expect(cell(page, 2, 1)).toHaveClass(/grsmd-cell-editing/);
  const same = await page.evaluate(() => {
    const table = document.querySelector("#preview table");
    return table === window.__e2eTable && table.parentElement === window.__e2eWrapper;
  });
  expect(same).toBe(true);
  await expect(page.locator("#editor")).toHaveValue(/\*\*bold!\*\*/);
});

test("Esc applies the open cell's change (D1); Shift+Enter is a <br>; Ctrl+Z undoes the last cells in turn", async ({ page }) => {
  await openEditMode(page);
  await cell(page, 2, 1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Tab"); // the last cell: nothing
  await expect(cell(page, 2, 1)).toHaveClass(/grsmd-cell-editing/);
  await page.locator("#preview h1").click(); // outside: commit
  await expect(page.locator("#editor")).toHaveValue(/\| plain<br>two \|/);
  await cell(page, 1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("zzz");
  await page.keyboard.press("Escape");
  await expect(cell(page, 1, 0)).toHaveText("Yamadazzz");
  await expect(cell(page, 1, 0)).not.toHaveClass(/grsmd-cell-editing/);
  await expect(page.locator("#paletteSave")).toBeVisible(); // W4: the palette stays
  const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";
  await page.keyboard.press(undo);
  await expect(cell(page, 1, 0)).toHaveText("Yamada");
  await expect(page.locator("#editor")).toHaveValue(/plain<br>two/);
  await page.keyboard.press(undo);
  await expect(page.locator("#editor")).not.toHaveValue(/plain<br>two/);
});

test("a cell with math opens as its text; the table tab opens the source", async ({ page }) => {
  await openEditMode(page, ["| A | B |", "| --- | --- |", "| $x^2$ | y |", ""].join("\n"));
  await cell(page, 1, 0).click();
  await expect(cell(page, 1, 0)).toHaveClass(/grsmd-cell-raw/);
  await expect(cell(page, 1, 0)).toHaveText("$x^2$");
  await page.keyboard.press("Escape");
  await page.locator("#preview .grsmd-table-tab").click();
  await expect(page.locator("#preview textarea.md-block-editor")).toHaveValue(/\| \$x\^2\$ \| y \|/);
});

// Timing depends on the machine and on the other tests running at the same
// time: only with GRSMD_PERF=1, as the vitest timing checks
// (R6 Independence, Q8).
test("INV-51 (PRT-X23): 1 MB with a 1,000 x 5 table, each step within 300 ms in Chromium", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "INV-51 is measured in Chrome");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(120000);
  const rows = Array.from({ length: 1000 }, (_, i) => `| r${i} | a${i} | b${i} | c${i} | d${i} |`).join("\n");
  const table = `| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
  let filler = "";
  for (let i = 0; filler.length < 1024 * 1024; i++) filler += `\n## Section ${i}\n\nParagraph ${i} with some words to make it longer, and **bold** text.\n`;
  await page.goto("/");
  await dropFile(page, { name: "big.md", text: `${table}${filler}`, type: "text/markdown" });
  await expect(page.locator("#preview table")).toBeVisible({ timeout: 60000 });
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
  // Each step is timed from the press to the next frame after it: the
  // synchronous handler, the queued partial render (microtasks), and the
  // style, layout and paint of what changed.
  const ms = await page.evaluate(async () => {
    const t = () => performance.now();
    const shown = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const td = (r, c) => document.querySelector("#preview table").rows[r].cells[c];
    const pointAt = (el) => {
      const r = el.getBoundingClientRect();
      return { clientX: r.left + 2, clientY: r.top + 2 };
    };
    const press = (el, at) => {
      for (const type of ["pointerdown", "pointerup"]) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, ...at }));
      }
    };
    const out = {};
    let at = pointAt(td(500, 1));
    let t0 = t();
    press(td(500, 1), at);
    await shown();
    out.open = t() - t0;
    const cell = td(500, 1);
    cell.firstChild.data += "x";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    t0 = t();
    cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await shown();
    out.commit = t() - t0;
    // a change, then a press on another cell of the same table (INV-30)
    const next = document.querySelector("#preview .grsmd-cell-editing");
    next.firstChild.data += "y";
    next.dispatchEvent(new InputEvent("input", { bubbles: true }));
    at = pointAt(td(498, 3));
    t0 = t();
    press(td(498, 3), at);
    await shown();
    out.tap = t() - t0;
    out.tapped = td(498, 3).classList.contains("grsmd-cell-editing");
    const row = document.querySelector("#paletteRow");
    at = pointAt(row);
    t0 = t();
    press(row, at);
    await shown();
    out.operation = t() - t0;
    const column = document.querySelector("#paletteColumn");
    at = pointAt(column);
    t0 = t();
    press(column, at);
    await shown();
    out.column = t() - t0;
    press(document.querySelector("#paletteTableOptions"), pointAt(document.querySelector("#paletteTableOptions")));
    await shown();
    const center = document.querySelector('[aria-label="Align center"]');
    at = pointAt(center);
    t0 = t();
    press(center, at);
    await shown();
    out.align = t() - t0;
    out.aligned = document.querySelector("#preview .grsmd-cell-editing")?.getAttribute("align") === "center";
    const open = document.querySelector("#preview .grsmd-cell-editing");
    open.textContent = "word";
    const range = document.createRange();
    range.selectNodeContents(open);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const bold = document.querySelector("#paletteBold");
    bold.removeAttribute("aria-disabled");
    at = pointAt(bold);
    t0 = t();
    press(bold, at);
    await shown();
    out.format = t() - t0;
    out.bold = Boolean(document.querySelector("#preview .grsmd-cell-editing strong"));
    return out;
  });
  console.log(`INV-51 table (ms): ${JSON.stringify(ms)}`);
  expect(ms.bold).toBe(true);
  expect(ms.aligned).toBe(true);
  expect(ms.tapped).toBe(true);
  for (const key of ["open", "commit", "tap", "operation", "column", "align", "format"]) expect(ms[key], key).toBeLessThanOrEqual(300);
});

test("INV-57: a double click on a cell outside edit mode opens it with the caret where it was clicked", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, DOC);
  const target = cell(page, 2, 0); // "Suzuki"
  const box = await target.boundingBox();
  // the upper part of the cell, near the start of the word: the table moves
  // down when edit mode adds the strip for the tab above it
  await page.mouse.dblclick(box.x + 4, box.y + 3);
  await expect(target).toHaveClass(/grsmd-cell-editing/);
  const caret = await page.evaluate(() => {
    const s = getSelection();
    const td = document.querySelector("#preview .grsmd-cell-editing");
    const before = document.createRange();
    before.setStart(td, 0);
    before.setEnd(s.anchorNode, s.anchorOffset);
    return { inCell: td.contains(s.anchorNode), collapsed: s.isCollapsed, offset: before.toString().length };
  });
  expect(caret.inCell).toBe(true);
  expect(caret.collapsed).toBe(true);
  expect(caret.offset).toBeLessThan(3); // near the start of "Suzuki", not its end (6)
});
