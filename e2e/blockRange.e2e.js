import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// INV-74 (owner rulings D1 to D14, U1 to U5): in edit mode the text a mouse
// drag selects in the preview stands for the top-level blocks it touches;
// they are framed, and a bar [Delete][Cut][Copy] shows under the selection.
// Delete / Backspace delete, Ctrl+X cuts, Ctrl+C copies the blocks' source
// whole; one delete or cut is one Undo unit. No request leaves the page.

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const expectBody = (page, value) => expect(page.locator("#editor")).toHaveValue(value);
const bar = (page) => page.locator(".grsmd-block-range-bar");
const barButton = (page, index) => bar(page).locator("button").nth(index);
const framed = (page) => page.locator("#preview > .md-block.md-block-range");

const DOC =
  "# Title\n\nFirst para with **bold**.\n\nSecond para.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| x | y |\n\n" +
  "```js\nconst a = 1;\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nLast para.\n";

async function openEditMode(page, markdown = DOC) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
  await settled(page);
}

/** A mouse drag from some way into the text of one element to some way into another's. */
async function drag(page, from, to, { fromX = 8, toX = 30 } = {}) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + fromX, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2 + 10, (a.y + b.y) / 2 + 5, { steps: 4 });
  await page.mouse.move(b.x + toX, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
}
const para = (page, text) => page.locator("#preview p", { hasText: text });

/** Select from the start of the first block holding fromText to the end of the one holding toText (as a long press then handles). */
function selectText(page, fromText, toText) {
  return page.evaluate(
    ({ fromText, toText }) => {
      const blocks = [...document.querySelectorAll("#preview > .md-block")];
      const textNode = (block, last) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? 1 : 3) });
        let node = walker.nextNode();
        if (!last) return node;
        for (let next = node; next; next = walker.nextNode()) node = next;
        return node;
      };
      const start = textNode(blocks.find((b) => b.textContent.includes(fromText)), false);
      const end = textNode(blocks.find((b) => b.textContent.includes(toText)), true);
      const r = document.createRange();
      r.setStart(start, 0);
      r.setEnd(end, end.data.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    },
    { fromText, toText },
  );
}

/**
 * How many times the bar's Copy button has shown its check so far. The
 * check lasts CONFIG.ui.copyFeedbackDuration (250 ms), so it is recorded
 * in the page as it happens (a slow test runner could miss it).
 */
async function watchChecks(page) {
  await page.evaluate(() => {
    window.__checks = 0;
    new MutationObserver((records) => {
      for (const r of records) if (r.target.classList?.contains("is-copied") && !(r.oldValue ?? "").includes("is-copied")) window.__checks++;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  });
  return () => page.evaluate(() => window.__checks);
}

/** What the copy events gave the clipboard as text/plain, in order. */
async function watchCopies(page) {
  await page.evaluate(() => {
    window.__copied = [];
    window.addEventListener("copy", (e) => window.__copied.push(e.clipboardData.getData("text/plain")));
  });
  return () => page.evaluate(() => window.__copied);
}

test("INV-74 (1) (2) (3): a mouse drag over two blocks frames them and shows the bar under the selection; [Delete] deletes them; one Undo brings them back; Redo again (D1, D2, D5)", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await expect(framed(page)).toHaveCount(2);
  await expect(bar(page)).toBeVisible();
  // under the selection's last line, not over the text it selected
  const barBox = await bar(page).boundingBox();
  const secondBox = await para(page, "Second para").boundingBox();
  expect(barBox.y).toBeGreaterThanOrEqual(secondBox.y + secondBox.height - 2);
  await expect(page.locator("#preview textarea.md-block-editor")).toHaveCount(0); // the drag opened nothing
  await barButton(page, 0).click();
  await expectBody(page, DOC.replace("First para with **bold**.\n\nSecond para.\n\n", ""));
  await expect(bar(page)).toBeHidden();
  await expect(framed(page)).toHaveCount(0);
  await expect(page.locator("#toastContainer .toast")).toHaveCount(0); // D2: no toast
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expectBody(page, DOC.replace("First para with **bold**.\n\nSecond para.\n\n", ""));
});

test("INV-74 (1) (3): Delete and Backspace delete the selected blocks; a selection inside one block is that block (D4, D8, D13)", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "Second para"), para(page, "Second para"), { fromX: 2, toX: 40 });
  await expect(framed(page)).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expectBody(page, DOC.replace("Second para.\n\n", ""));
  await drag(page, page.locator("#preview li", { hasText: "two" }), page.locator("#preview li", { hasText: "two" }), { fromX: 2, toX: 20 });
  await expect(framed(page)).toHaveCount(1); // the whole list (D13)
  await page.keyboard.press("Backspace");
  await expectBody(page, DOC.replace("Second para.\n\n", "").replace("- one\n- two\n\n", ""));
});

test("INV-74 (4): Ctrl+C copies the blocks' source whole and changes nothing; the Copy button shows a check; Ctrl+X cuts (D3, D7, D11)", async ({ page, browserName, context }) => {
  await openEditMode(page);
  const copies = await watchCopies(page);
  const checks = await watchChecks(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await page.keyboard.press(`${MOD}+c`);
  await expect.poll(copies).toEqual(["First para with **bold**.\n\nSecond para."]);
  await expect.poll(checks).toBe(1);
  await expect(barButton(page, 2)).not.toHaveClass(/\bis-copied\b/); // only for a moment
  await expectBody(page, DOC);
  await expect(framed(page)).toHaveCount(2); // the selection stays
  if (browserName === "chromium") {
    // the system clipboard has it (read here by the test only; the page never reads it)
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("First para with **bold**.\n\nSecond para.");
  }
  await page.keyboard.press(`${MOD}+x`);
  await expect.poll(copies).toEqual(["First para with **bold**.\n\nSecond para.", "First para with **bold**.\n\nSecond para."]);
  await expectBody(page, DOC.replace("First para with **bold**.\n\nSecond para.\n\n", ""));
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
});

test("INV-74 (2) (4): the bar's Cut and Copy buttons write the source too (the copy event, no read)", async ({ page }) => {
  await openEditMode(page);
  const copies = await watchCopies(page);
  const checks = await watchChecks(page);
  await drag(page, para(page, "Second para"), para(page, "Last para"));
  await barButton(page, 2).click();
  await expect.poll(checks).toBe(1);
  await barButton(page, 1).click();
  const source = DOC.slice(DOC.indexOf("Second para."), DOC.indexOf("Last para.") + "Last para.".length);
  await expect.poll(copies).toEqual([source, source]);
  await expectBody(page, "# Title\n\nFirst para with **bold**.\n\n");
});

test("INV-74 (1) (3), INV-48: a range over a table, code, a list and a diagram deletes them as blocks; Undo brings all back", async ({ page }) => {
  await openEditMode(page);
  await selectText(page, "one", "Last para.");
  await expect(framed(page)).toHaveCount(5);
  await page.keyboard.press("Delete");
  await expectBody(page, "# Title\n\nFirst para with **bold**.\n\nSecond para.\n\n");
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
  await expect(page.locator("#preview .mermaid svg")).toBeVisible();
});

test("INV-74 (1) (3), INV-49: Ctrl+A then Delete empties the document: the empty block shows; one Undo brings it all back (U4, INV-49)", async ({ page }) => {
  await openEditMode(page);
  await page.locator("#preview h1").click(); // the title opens; Esc applies it and closes it
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+a`);
  await expect(framed(page)).toHaveCount(await page.locator("#preview > .md-block[data-block-id]").count());
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toBeInViewport();
  await page.keyboard.press("Delete");
  await expectBody(page, "");
  await expect(page.locator("#preview > .md-block-empty")).toBeVisible();
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
});

test("INV-74 (5): Esc takes the range away first and keeps edit mode; the next Esc hides the palette (D14)", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect(framed(page)).toHaveCount(0);
  await expect(page.locator("#paletteSave")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#paletteSave")).toBeHidden();
});

test("INV-74 (2), INV-73: while blocks are selected the gaps' + does not show; it does again after Esc", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  const gap = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll("#preview > .md-block")];
    const i = blocks.findIndex((el) => el.textContent.includes("Second para."));
    const a = blocks[i].getBoundingClientRect();
    const b = blocks[i + 1].getBoundingClientRect();
    return { x: document.querySelector("#preview").getBoundingClientRect().left + 60, y: (a.bottom + b.top) / 2 };
  });
  await page.mouse.move(gap.x, gap.y - 1);
  await page.mouse.move(gap.x, gap.y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.locator(".grsmd-gap-insert")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.mouse.move(gap.x, gap.y - 1);
  await page.mouse.move(gap.x, gap.y);
  await expect(page.locator(".grsmd-gap-insert")).toBeVisible();
});

test("INV-74 (6): outside edit mode a selection is the browser's: no frame, no bar, Delete and Ctrl+C change nothing (D9)", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, DOC);
  await settled(page);
  const copies = await watchCopies(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await expect(framed(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press("Delete");
  await page.keyboard.press(`${MOD}+c`);
  await expectBody(page, DOC);
  // the browser's own copy of the visible text, not the source (it must have happened)
  await expect.poll(async () => (await copies()).length).toBeGreaterThan(0);
  for (const text of await copies()) expect(text).not.toContain("**");
});

test("INV-74 (6), INV-45: with an unrendered change in the top box, Delete renders the top box first and deletes nothing", async ({ page }) => {
  await openEditMode(page);
  const changed = `${DOC}\nAdded in the top box.\n`;
  await page.locator("#editor").evaluate((editor, text) => {
    editor.focus();
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, changed);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await page.keyboard.press("Delete");
  await expect(page.locator("#toastContainer")).toContainText("Updated from the top box");
  await expect(para(page, "Added in the top box.")).toBeVisible();
  await expectBody(page, changed);
});

test("INV-74 (2): the bar goes above the selection when there is no room under it, and stays in the viewport (D10, U4)", async ({ page }) => {
  const paras = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of a long page.`).join("\n\n");
  await openEditMode(page, `# Long\n\n${paras}\n`);
  // a paragraph scrolled to end 10 px above the bottom of the viewport: no room for the bar under it
  const target = "Paragraph 40 of a long page.";
  await page.evaluate((text) => {
    const p = [...document.querySelectorAll("#preview p")].find((el) => el.textContent === text);
    const scroller = document.querySelector("#preview").scrollHeight > document.querySelector("#preview").clientHeight ? document.querySelector("#preview") : document.scrollingElement;
    scroller.scrollTop += p.getBoundingClientRect().bottom - (window.innerHeight - 10);
  }, target);
  await settled(page);
  const viewport = page.viewportSize();
  const before = await para(page, target).boundingBox();
  expect(Math.abs(before.y + before.height - (viewport.height - 10))).toBeLessThan(2);
  await drag(page, para(page, target), para(page, target), { fromX: 2, toX: 40 });
  await expect(bar(page)).toBeVisible();
  const barBox = await bar(page).boundingBox();
  const pBox = await para(page, target).boundingBox();
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewport.height);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(pBox.y + 1); // above the line
});

test("INV-74 (4): a copy the browser starts (menu, callout) writes the blocks' source while blocks are selected (owner ruling 2026-10-25)", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await expect(bar(page)).toBeVisible();
  const checks = await watchChecks(page);
  // the copy event the context menu's Copy fires (the menu itself cannot be clicked by a test)
  const menuCopy = () =>
    page.evaluate(() => {
      const data = new DataTransfer();
      const e = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector("#preview p").dispatchEvent(e);
      return { prevented: e.defaultPrevented, text: data.getData("text/plain") };
    });
  await expect.poll(menuCopy).toEqual({ prevented: true, text: "First para with **bold**.\n\nSecond para." });
  await expect.poll(checks).toBe(1);
  await expectBody(page, DOC);
  // without a range it is the browser's own copy
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await expect.poll(async () => (await menuCopy()).prevented).toBe(false);
});

test("INV-74 (3): Shift+Delete deletes the selected blocks as Delete does (owner ruling 2026-10-25)", async ({ page }) => {
  await openEditMode(page);
  await drag(page, para(page, "First para"), para(page, "Second para"));
  await expect(framed(page)).toHaveCount(2);
  await page.keyboard.press("Shift+Delete");
  await expectBody(page, DOC.replace("First para with **bold**.\n\nSecond para.\n\n", ""));
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("INV-74 (2) (3): a tap on the bar's Delete (a selection made by a long press) deletes the blocks; the tap opens nothing", async ({ page }) => {
    await openEditMode(page);
    await selectText(page, "First para", "Second para");
    await expect(bar(page)).toBeVisible();
    const box = await barButton(page, 0).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expectBody(page, DOC.replace("First para with **bold**.\n\nSecond para.\n\n", ""));
    await expect(page.locator("#preview textarea.md-block-editor")).toHaveCount(0);
  });
});

// Timing depends on the machine: only with GRSMD_PERF=1, as the other timing
// checks. INV-74 (performance): 1 MB, every block selected (Ctrl+A): the
// frame that shows the frame and the bar (its script, and the style and
// layout it leaves) within SELECT_ALL_FRAME_BUDGET_MS (a browser's long
// task); then Delete, from the key to the DOM swap (the commit measure),
// within 300 ms.
const SELECT_ALL_FRAME_BUDGET_MS = 50;
test("INV-74 (performance), INV-51: 1 MB in Chromium, the frame after Ctrl+A within 50 ms, then Delete within 300 ms", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "INV-51 is measured in Chrome");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(180000);
  let doc = "";
  for (let i = 0; doc.length < 1024 * 1024; i++) doc += `\n## Section ${i}\n\nParagraph ${i} with some words to make it longer, and **bold** text.\n`;
  await openEditMode(page, doc);
  const measure = (key) =>
    page.evaluate(async (key) => {
      performance.clearMeasures("grsmd-commit");
      const t0 = performance.now();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...(key === "z" ? { ctrlKey: true, code: "KeyZ" } : {}) }));
      const inHandler = performance.now() - t0;
      await new Promise((resolve) => {
        const check = () => (performance.getEntriesByName("grsmd-commit", "measure").length ? resolve() : setTimeout(check, 5));
        check();
      });
      const swap = performance.getEntriesByName("grsmd-commit", "measure")[0];
      return { inHandler, toSwap: swap.startTime + swap.duration - t0 };
    }, key);
  // each frame callback from now on, with the style and layout it leaves (read at once)
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__frameTimes = [];
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const t0 = performance.now();
        cb(t);
        document.querySelector("#preview").getBoundingClientRect();
        window.__frameTimes.push(performance.now() - t0);
      });
  });
  await page.keyboard.press(`${MOD}+a`);
  await expect(bar(page)).toBeVisible();
  const selectFrame = await page.evaluate(() => Math.max(0, ...window.__frameTimes));
  const del = await measure("Delete");
  await expectBody(page, "\n"); // the leading blank line stays
  await settled(page);
  console.log(`INV-74 1 MB: the frame after Ctrl+A ${selectFrame.toFixed(1)} ms; Delete: handler ${del.inHandler.toFixed(1)} ms, to the DOM swap ${del.toSwap.toFixed(1)} ms`);
  expect(selectFrame).toBeLessThanOrEqual(SELECT_ALL_FRAME_BUDGET_MS);
  expect(del.toSwap).toBeLessThanOrEqual(300);
});
