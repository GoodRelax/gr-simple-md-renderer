import { test, expect, renderMarkdown } from "./fixtures.js";
import { CONFIG } from "../src/js/config.js";

// The palette's math (Text format, second row; owner ruling 2026-10-25) in
// real browsers: inline math goes in at the caret and is drawn by KaTeX
// once applied; Insert math boxes puts the three math boxes under their names in
// one press, drawn without an error and with nothing opened; one Undo takes
// them away and Redo brings them back. No request leaves the page (the
// fixture checks it).

// CONFIG.edit.inlineMathTemplate
const MATH = String.raw`$e = \lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^{n} = \sum_{k=0}^{\infty} \frac{1}{k!}$`;
const NAMES = ["Maxwell's Equations", "Einstein Field Equations and Christoffel Symbols", "Schroedinger Equation, Wavefunction Normalization, and Pauli Matrices"];
// the three math boxes under their names, as inserted (AT-MATH-05 checks the text itself)
const BOXES = CONFIG.edit.mathBoxesTemplate;
const DOC = "# Doc\n\nPara one.\n\nEnd.\n";

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

async function pressInFormat(page, id) {
  await page.locator("#paletteFormat").click();
  await expect(page.locator("#paletteFormatMenu")).toBeVisible();
  await page.locator(`#${id}`).click();
}

const body = (page) => page.locator("#editor");

test("Text format shows two rows: the formats, then inline math and the math boxes", async ({ page }) => {
  await openEditMode(page, DOC);
  await editBlock(page, "Para one.", null, 4);
  await page.locator("#paletteFormat").click();
  const red = await page.locator("#paletteColorRed").boundingBox();
  const inline = await page.locator("#paletteInlineMath").boundingBox();
  const box = await page.locator("#paletteMathBox").boundingBox();
  expect(inline.y).toBeGreaterThan(red.y + red.height - 1); // the second row
  expect(Math.abs(inline.x - red.x)).toBeLessThan(1); // starts under the first button
  expect(Math.abs(box.y - inline.y)).toBeLessThan(1);
  expect(box.x).toBeGreaterThan(inline.x);
  const menu = await page.locator("#paletteFormatMenu").boundingBox();
  const viewport = page.viewportSize();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
});

test("inline math goes in at the caret; applied with Esc, KaTeX draws it", async ({ page }) => {
  await openEditMode(page, DOC);
  const ta = await editBlock(page, "Para one.", null, 4); // Para| one.
  await pressInFormat(page, "paletteInlineMath");
  await expect(ta).toHaveValue(`Para ${MATH} one.`);
  await expect(page.locator("#paletteFormatMenu")).toBeHidden();
  await expect(ta).toHaveJSProperty("selectionStart", 5 + MATH.length);
  await expect(ta).toHaveJSProperty("selectionEnd", 5 + MATH.length);
  await expect(ta).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("textarea.md-block-editor")).toHaveCount(0);
  const para = page.locator("#preview > .md-block", { hasText: "Para" }).first();
  await expect(para.locator(".katex")).toHaveCount(1);
  await expect(page.locator("#preview .katex-error")).toHaveCount(0);
  await expect(body(page)).toHaveValue(`# Doc\n\nPara ${MATH} one.\n\nEnd.\n`);
});

test("inline math that would not read as itself: a toast, nothing changes", async ({ page }) => {
  await openEditMode(page, DOC);
  const ta = await editBlock(page, "Para one.", "costs $5 and", 12);
  await pressInFormat(page, "paletteInlineMath");
  await expect(page.locator("#toastContainer")).toContainText("You can't insert math here.");
  await expect(ta).toHaveValue("costs $5 and");
});

test("INV-52 Insert math boxes: three math boxes under their names in one press, drawn, nothing opened; Undo and Redo", async ({ page }) => {
  await openEditMode(page, DOC);
  await editBlock(page, "Para one.", "Line one\nLine two", 4);
  await pressInFormat(page, "paletteMathBox");
  await expect(page.locator("#preview .katex-display")).toHaveCount(3);
  await expect(page.locator("#preview .katex-error")).toHaveCount(0);
  await expect(page.locator("textarea.md-block-editor")).toHaveCount(0);
  for (const name of NAMES) await expect(page.locator("#preview > .md-block", { hasText: name })).toHaveCount(1);
  const withBoxes = `# Doc\n\nLine one\n\n${BOXES}\n\nLine two\n\nEnd.\n`;
  await expect(body(page)).toHaveValue(withBoxes);

  await page.locator("#paletteUndo").click();
  await expect(page.locator("#preview .katex-display")).toHaveCount(0);
  await expect(body(page)).toHaveValue("# Doc\n\nLine one\nLine two\n\nEnd.\n");

  await page.keyboard.press("Control+Shift+Z");
  await expect(page.locator("#preview .katex-display")).toHaveCount(3);
  await expect(body(page)).toHaveValue(withBoxes);
});

test("the math boxes are refused in a math block: a toast, the editor stays", async ({ page }) => {
  await openEditMode(page, DOC);
  const ta = await editBlock(page, "Para one.", "$$\nx\n$$", 3);
  await pressInFormat(page, "paletteMathBox");
  await expect(page.locator("#toastContainer")).toContainText("Can't insert here. Try outside this block.");
  await expect(ta).toHaveValue("$$\nx\n$$");
});
