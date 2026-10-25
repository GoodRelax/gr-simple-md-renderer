import { test, expect, renderMarkdown, settled, dropFile } from "./fixtures.js";

// Search and replace (INV-80, owner rulings S1 to S14, 2026-10-25) in a real
// browser: the source is searched, Down / Up move, Enter does nothing, a big
// table goes to the right row, Esc closes in its order, replacing is for the
// edit mode and one Undo takes it back, the code view searches its lines,
// and nothing of it is printed.

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.goto("/");
});

/** The count beside the query, once it reads expected. */
async function expectCount(page, expected) {
  await expect(page.locator("#searchCount")).toHaveText(expected);
}

/** The text of the current match and the first cell of its table row. */
async function currentMatch(page) {
  return page.evaluate(() => {
    const range = [...(CSS.highlights.get("grsmd-search-current") ?? [])][0];
    if (!range) return null;
    const box = range.getBoundingClientRect();
    const view = document.querySelector("#preview").getBoundingClientRect();
    return {
      text: range.toString(),
      row: range.startContainer.parentElement.closest("tr")?.cells[0].textContent ?? null,
      inView: box.top >= view.top && box.bottom <= view.bottom && box.left >= view.left && box.right <= view.right,
    };
  });
}

const DOC = "# Alpha\n\nThe cat sat.\n\n## Beta\n\nA cat and a cat.\n\n```js\nconst cat = 1;\n```\n";

test("INV-80 (3)(4)(6)(7): f opens it; the source is searched as you type; Down / Up move round the ends; Enter does nothing; Esc in the box closes it", async ({ page }) => {
  await renderMarkdown(page, DOC);
  await settled(page);
  await page.locator("#preview").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("f");
  const input = page.locator("#searchInput");
  await expect(input).toBeFocused();
  await input.pressSequentially("cat");
  await expectCount(page, "1 / 4"); // the code block's source counts too (S3)
  expect((await currentMatch(page)).text).toBe("cat");
  await input.press("ArrowDown");
  await expectCount(page, "2 / 4");
  await input.press("ArrowUp");
  await input.press("ArrowUp");
  await expectCount(page, "4 / 4");
  await input.press("Enter");
  await expectCount(page, "4 / 4");
  await input.press("Escape");
  await expect(page.locator("#searchPanel")).toBeHidden();
});

test("INV-80 (2)(3): a regular expression is searched when typing stops; an invalid one says so", async ({ page }) => {
  await renderMarkdown(page, DOC);
  await settled(page);
  await page.locator("#searchBtn").click();
  await page.locator("#searchRegex").click();
  const input = page.locator("#searchInput");
  await input.fill("^## (\\w+)$");
  await expectCount(page, "1 / 1");
  await input.fill("(");
  await expectCount(page, "Invalid pattern");
});

test("INV-80 (4): a big table: the n-th match goes to its own row, also to the right edge of a wide row", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const rows = Array.from({ length: 400 }, (_, i) => `| r${i + 1} | value ${(i + 1) % 10} | ${"lorem ipsum dolor sit amet ".repeat(3)} | far right ${i + 1} |`);
  await renderMarkdown(page, ["# Big table", "", "| No | Value | Text | End |", "| --- | --- | --- | --- |", ...rows, ""].join("\n"));
  await settled(page);
  await page.locator("#searchBtn").click();
  const input = page.locator("#searchInput");
  await input.fill("value 7");
  await expectCount(page, "1 / 40");
  for (let i = 0; i < 25; i++) await input.press("ArrowDown");
  await expectCount(page, "26 / 40");
  await expect.poll(async () => (await currentMatch(page))?.row).toBe("r257");
  expect((await currentMatch(page)).inView).toBe(true);
  await input.fill("far right 333");
  await expectCount(page, "1 / 1");
  await expect.poll(async () => (await currentMatch(page))?.inView).toBe(true);
});

test("INV-80 (5): replacing: edit mode only, Replace goes on, All counts in a toast, one Ctrl+Z takes it back; Enter in the replace box does nothing", async ({ page }) => {
  await renderMarkdown(page, DOC);
  await settled(page);
  await page.locator("#searchBtn").click();
  await expect(page.locator("#replaceAllBtn")).toBeDisabled();
  await page.locator("#searchInput").press("Escape");

  await page.locator("#editBtn").click();
  await page.keyboard.press("Control+f");
  const input = page.locator("#searchInput");
  await expect(input).toBeFocused();
  await input.fill("cat");
  await expectCount(page, "1 / 4");
  const replace = page.locator("#replaceInput");
  await replace.fill("dog");
  await replace.press("Enter");
  await expectCount(page, "1 / 4");
  await page.locator("#replaceOneBtn").click();
  await expectCount(page, "1 / 3");
  await expect(page.locator("#preview")).toContainText("The dog sat.");
  await page.locator("#replaceAllBtn").click();
  await expect(page.locator(".toast").last()).toHaveText("Replaced 3.");
  await expect(page.locator("#preview")).toContainText("A dog and a dog.");

  await page.locator("#preview").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#preview")).toContainText("A cat and a cat.");
  await expect(page.locator("#preview")).toContainText("The dog sat.");
});

test("INV-80 (6), INV-77 (4): Esc outside the box: the palette, then Search, then the Index", async ({ page }) => {
  await renderMarkdown(page, DOC);
  await settled(page);
  await page.locator("#indexBtn").click();
  await page.locator("#searchBtn").click();
  await page.locator("#editBtn").click();
  await page.locator("#preview").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(page.locator(".edit-palette")).toBeHidden();
  await expect(page.locator("#searchPanel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#searchPanel")).toBeHidden();
  await expect(page.locator("#indexPanel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#indexPanel")).toBeHidden();
});

test("INV-80 (1)(5)(8): the code view searches its lines and has no replace row; nothing of Search is printed", async ({ page }) => {
  await dropFile(page, { name: "a.py", text: "a = 1\ncat = 2\nprint(cat)\n" });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await page.locator("#searchBtn").click();
  await expect(page.locator("#replaceRow")).toBeHidden();
  await page.locator("#searchInput").fill("cat");
  await expectCount(page, "1 / 2");
  await expect(page.locator(".search-hit")).toHaveText("cat = 2");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#sidePanels")).toBeHidden();
  await expect(page.locator(".search-hit")).toHaveCSS("outline-style", "none");
});

// Timing depends on the machine: only with GRSMD_PERF=1, as the other timing
// checks. G10: a typed key and a Down press cost at most 4 ms on 1 MB.
const KEY_BUDGET_MS = 4;
test("INV-80 (G10): 1 MB, a typed key and a Down press each take at most 4 ms in Chromium", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured in Chrome");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(180000);
  let doc = "";
  for (let i = 0; doc.length < 1024 * 1024; i++) doc += `\n## Section ${i}\n\nParagraph ${i} with some words to make it longer, and **bold** text.\n`;
  await renderMarkdown(page, doc);
  await settled(page, 1000);
  await page.locator("#searchBtn").click();
  const times = await page.evaluate(() => {
    const input = document.querySelector("#searchInput");
    const median = (f) => {
      const all = [];
      for (let i = 0; i < 9; i++) all.push(f());
      return all.sort((a, b) => a - b)[4];
    };
    const typed = (value) => () => {
      input.value = value;
      const t = performance.now();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return performance.now() - t;
    };
    const down = () => {
      const t = performance.now();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      return performance.now() - t;
    };
    return { e: median(typed("e")), section: median(typed("Section 1")), none: median(typed("zzzz")), down: median(down) };
  });
  for (const [name, ms] of Object.entries(times)) expect(ms, name).toBeLessThanOrEqual(KEY_BUDGET_MS);

  // Replace all of every paragraph (INV-51): the press, up to the new model
  // and its Undo record; the redraw that follows is as big as a document load
  await page.locator("#searchInput").press("Escape");
  await page.locator("#editBtn").click();
  await page.locator("#searchBtn").click();
  await page.locator("#searchInput").fill("some words");
  await page.locator("#replaceInput").fill("other words");
  const replaceAllMs = await page.evaluate(() => {
    const t = performance.now();
    document.querySelector("#replaceAllBtn").click();
    return performance.now() - t;
  });
  expect(replaceAllMs, "Replace all").toBeLessThanOrEqual(300);
});
