import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// What crosses the UI units, or needs a real browser to be seen: the review's
// T-3 (9), (11), (6) and S-2, and the release tests' U20, N1, N2, N3, M04 and
// N6. Every test also checks (fixtures) that no request leaves for an
// external host and that nothing is logged as an error.

const RED_LIGHT = "rgb(184, 79, 0)"; // #B84F00
const RED_DARK = "rgb(224, 102, 26)"; // #E0661A
const IMG = "https://img.example/a.png";

async function openEditMode(page, markdown) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
}

const cell = (page, r, c) => page.locator("#preview table").first().locator("tr").nth(r).locator("th, td").nth(c);
const openCell = (page) => page.locator("#preview .grsmd-cell-editing");

test("T-3 (9) K-1: Align column and Format stay open while a changed cell moves on with Tab and Enter, and on Insert row", async ({ page }) => {
  await openEditMode(page, ["| A | B |", "| --- | --- |", "| x | y |", "| p | q |", ""].join("\n"));
  for (const [opener, menu] of [["#paletteTableOptions", "#paletteTableMenu"], ["#paletteFormat", "#paletteFormatMenu"]]) {
    await cell(page, 1, 0).click();
    await page.locator(opener).click();
    await expect(page.locator(menu)).toBeVisible();
    // the palette's buttons do not take the focus: typing goes on in the cell
    await page.keyboard.press("End");
    await page.keyboard.type("1");
    await page.keyboard.press("Tab");
    await expect(cell(page, 1, 1)).toHaveClass(/grsmd-cell-editing/);
    await expect(page.locator(menu), `${opener} after Tab`).toBeVisible();
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");
    await expect(cell(page, 2, 1)).toHaveClass(/grsmd-cell-editing/);
    await expect(page.locator(menu), `${opener} after Enter`).toBeVisible();
    await page.locator("#paletteRow").click();
    await expect(cell(page, 3, 1)).toHaveClass(/grsmd-cell-editing/);
    await expect(page.locator(menu), `${opener} after Insert row`).toBeVisible();
    await page.keyboard.press("Escape"); // the popover
    await page.keyboard.press("Escape"); // the cell
    await expect(openCell(page)).toHaveCount(0);
  }
});

test("T-3 (11) S-2: HTML with an external image pasted into a cell is text; an image cell edited and a row inserted load nothing", async ({ page }) => {
  await openEditMode(page, ["| A | B |", "| --- | --- |", `| ![i](${IMG}) | y |`, ""].join("\n"));
  await expect(page.locator("#preview .external-image-placeholder")).toHaveCount(1);
  await cell(page, 1, 1).click();
  await page.evaluate(() => {
    const target = document.querySelector("#preview .grsmd-cell-editing");
    const data = new DataTransfer();
    data.setData("text/html", '<img src="https://img.example/pasted.png"><b>pasted</b>');
    data.setData("text/plain", "pasted");
    target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(cell(page, 1, 1)).toContainText("pasted");
  await expect(cell(page, 1, 1).locator("img, b")).toHaveCount(0);
  await page.keyboard.press("Tab");
  // the raw cell of the image: change the URL, commit
  await cell(page, 1, 0).click({ position: { x: 3, y: 3 } }); // the cell, not its placeholder (INV-29)
  await expect(cell(page, 1, 0)).toHaveClass(/grsmd-cell-raw/);
  await page.keyboard.press("End");
  await page.keyboard.type(` ![j](https://img.example/b.png)`);
  await page.keyboard.press("Tab");
  await expect(cell(page, 1, 0).locator(".external-image-placeholder")).toHaveCount(2);
  await page.locator("#paletteRow").click();
  await expect(page.locator("#preview table tr")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview img")).toHaveCount(0);
  // the fixture fails the test if any request went out
});

test("T-3 (6): a cell colored and left changed, then [Render Dark]: committed, and the color shows in its dark pair", async ({ page }) => {
  await openEditMode(page, ["| A | B |", "| --- | --- |", "| word | y |", ""].join("\n"));
  await cell(page, 1, 0).click();
  await cell(page, 1, 0).evaluate((td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.locator("#paletteFormat").click();
  await page.locator("#paletteColorRed").click();
  await expect(cell(page, 1, 0).locator("span[style]")).toHaveCSS("color", RED_LIGHT);
  await page.locator("#renderDark").click();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await expect(page.locator("#editor")).toHaveValue(/<span style="color: #B84F00">word<\/span>/);
  await expect(openCell(page)).toHaveCount(0);
  await expect(cell(page, 1, 0).locator("span[style]")).toHaveCSS("color", RED_DARK);
});

test("U20: after a click on a diagram opens its code, a move without a button does not scroll the preview", async ({ page }) => {
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} of filler text.\n`).join("\n");
  await openEditMode(page, `${filler}\n\`\`\`mermaid\nflowchart TD\n  A --> B\n  B --> C\n\`\`\`\n\n${filler}`);
  const diagram = page.locator("#preview .mermaid svg");
  await expect(diagram).toHaveCount(1, { timeout: 20000 });
  await settled(page); // the full render puts its scroll back when the DOM is stable (review CR-5)
  await page.evaluate(() => {
    const preview = document.querySelector("#preview");
    const svg = preview.querySelector(".mermaid svg");
    preview.scrollTop += svg.getBoundingClientRect().top - preview.getBoundingClientRect().top - preview.clientHeight / 2;
  });
  await settled(page);
  const box = await diagram.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(20, box.height / 2));
  await expect(page.locator("#preview textarea.md-block-editor")).toHaveValue(/^```mermaid/);
  const before = await page.evaluate(() => document.querySelector("#preview").scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 });
  const after = await page.evaluate(() => ({ top: document.querySelector("#preview").scrollTop, cursor: document.body.style.cursor }));
  expect(after.top).toBe(before);
  expect(after.cursor).toBe("");
});

test("N2 N3 M04: a document's own app classes are not styled; the band shows a pointer; math is 1.5 times the text", async ({ page }) => {
  await openEditMode(page, ['Text <span class="grsmd-table-tab">mine</span> and <span class="md-block-hidden">also mine</span>.', "", "<!-- note -->", "", "Math $x^2$ here.", ""].join("\n"));
  await page.locator("#editBtn").click(); // browsing
  await expect(page.locator("#preview p", { hasText: "Text" })).toHaveText("Text mine and also mine.");
  await expect(page.locator("#preview p .grsmd-table-tab")).toBeVisible();
  await expect(page.locator("#preview p .md-block-hidden")).toBeVisible();
  await page.locator("#editBtn").click(); // edit mode
  const band = page.locator("#preview > .md-block-hidden");
  await band.hover();
  await expect(band).toHaveCSS("cursor", "pointer");
  const ratio = await page.locator("#preview .katex").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.parentElement).fontSize));
  expect(ratio).toBeCloseTo(1.5, 2);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test("N1: a long press on [?] opens the MCBSMD prompt, and it stays open when the finger lifts", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "a real touch sequence (CDP) is Chromium only");
    await page.goto("/");
    const box = await page.locator("#helpBtn").boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(800);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    await page.waitForTimeout(300);
    await expect(page.locator("#promptModal")).toBeVisible();
    await expect(page.locator("#helpModal")).toBeHidden();
  });

  test("N6: a phone (no viewport meta) lays the page out 980 px wide, and the top bar fits in it", async ({ page }) => {
    await page.goto("/");
    // (Chromium's emulation reads innerWidth / scrollWidth 981 from rounding: the elements are measured)
    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const past = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > width + 0.5);
      return { width, bar: document.querySelector("#topbar").getBoundingClientRect().right, past: past.map((el) => el.id || el.tagName) };
    });
    expect(layout.width).toBe(980);
    expect(layout.bar).toBeLessThanOrEqual(layout.width + 0.5);
    expect(layout.past).toEqual([]);
  });
});

test("P1 (owner ruling 2026-10-23): edit mode moves no block; each tab sits right above its table, outside the header", async ({ page }) => {
  const doc = ["Para one.", "", "| A | B |", "| --- | --- |", "| x | y |", "", "| C | D |", "| --- | --- |", "| z | w |", "", "## Head", "", "| E | F |", "| --- | --- |", "| q | r |", "", "Last para.", ""].join("\n");
  await page.goto("/");
  await renderMarkdown(page, doc);
  const tops = () => page.evaluate(() => [...document.querySelectorAll("#preview > .md-block")].map((b) => Math.round(b.getBoundingClientRect().top * 100) / 100));
  const before = await tops();
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
  expect(await tops()).toEqual(before);
  const placement = await page.evaluate(() =>
    [...document.querySelectorAll("#preview > .md-block-table")].map((w) => {
      const tab = w.querySelector(":scope > .grsmd-table-tab").getBoundingClientRect();
      const table = w.querySelector(":scope > table").getBoundingClientRect();
      return { height: tab.height, gap: Math.round((table.top - tab.bottom) * 100) / 100 };
    }),
  );
  for (const p of placement) {
    expect(p.height).toBe(16);
    expect(p.gap).toBe(0);
  }
  await page.locator("#editBtn").click();
  expect(await tops()).toEqual(before);
});
