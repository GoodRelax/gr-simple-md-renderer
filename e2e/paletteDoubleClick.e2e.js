import { test, expect, renderMarkdown } from "./fixtures.js";
import { CONFIG } from "../src/js/config.js";

// The palette grip's double click (INV-68, owner rulings PD1-PD3) in real
// browsers: a mouse double click minimizes and restores the palette, keeps
// the grip in place and the open block editor's focus and selection, selects
// no text and starts nothing else (no block opens, the body does not change).
// Only two taps count: a drag or a long press followed by a click that the
// browser counts as a double click does not toggle. On touch, two quick taps
// toggle once, without a browser zoom (the palette has touch-action: none).

const DOC = "# Doc\n\nPara one.\n\nPara two.\n";
const LONG_PRESS_MS = CONFIG.edit.paletteLongPressMs;

async function openEditMode(page) {
  await page.goto("/");
  await renderMarkdown(page, DOC);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
}

const palette = (page) => page.locator("#editPalette");
const grip = (page) => page.locator("#paletteGrip");
const blockEditor = (page) => page.locator("#preview textarea.md-block-editor");

async function gripCenter(page) {
  const box = await grip(page).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function expectMinimized(page, minimized) {
  if (minimized) await expect(palette(page)).toHaveClass(/edit-palette-minimized/);
  else await expect(palette(page)).not.toHaveClass(/edit-palette-minimized/);
}

/** The text the document selection holds, and whether it touches the palette. */
function documentSelection(page) {
  return page.evaluate(() => {
    const s = window.getSelection();
    const node = s.rangeCount ? s.anchorNode : null;
    return { text: s.toString(), inPalette: Boolean(node && document.getElementById("editPalette").contains(node)) };
  });
}

test("a mouse double click on the grip minimizes and restores; the grip stays; no text is selected and nothing else starts", async ({ page }) => {
  await openEditMode(page);
  const body = await page.locator("#editor").inputValue();
  const before = await grip(page).boundingBox();
  const c = await gripCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await expectMinimized(page, true);
  const after = await grip(page).boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  expect(await documentSelection(page)).toEqual({ text: "", inPalette: false });
  await expect(blockEditor(page)).toHaveCount(0);
  await page.mouse.dblclick(c.x, c.y);
  await expectMinimized(page, false);
  expect(await documentSelection(page)).toEqual({ text: "", inPalette: false });
  await expect(blockEditor(page)).toHaveCount(0);
  await expect(page.locator("#editor")).toHaveValue(body);
});

test("a double click on the grip keeps the open block editor, its focus and its selection (INV-36)", async ({ page }) => {
  await openEditMode(page);
  await page.locator("#preview > .md-block", { hasText: "Para one." }).first().click();
  const ta = blockEditor(page);
  await expect(ta).toBeVisible();
  await ta.evaluate((el) => {
    el.focus();
    el.setSelectionRange(1, 4);
  });
  const c = await gripCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await expectMinimized(page, true);
  await expect(ta).toBeVisible();
  await expect(ta).toBeFocused();
  await expect(ta).toHaveJSProperty("selectionStart", 1);
  await expect(ta).toHaveJSProperty("selectionEnd", 4);
  await expect(ta).toHaveValue("Para one.");
  await page.mouse.dblclick(c.x, c.y);
  await expectMinimized(page, false);
  await expect(ta).toBeFocused();
  await expect(ta).toHaveJSProperty("selectionStart", 1);
  await expect(ta).toHaveJSProperty("selectionEnd", 4);
});

test("a drag or a long press, then a click the browser counts as a double click, does not toggle", async ({ page }) => {
  await openEditMode(page);
  // a drag, then a second press counted as the second click
  let c = await gripCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 40, c.y - 30, { steps: 4 });
  await page.mouse.move(c.x - 80, c.y - 60, { steps: 4 });
  await page.mouse.up();
  c = await gripCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(LONG_PRESS_MS + 100);
  await expectMinimized(page, false);

  // a long press (minimizes by itself), then a second press counted as the second click
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_MS + 100);
  await expectMinimized(page, true);
  await page.mouse.up();
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(100);
  await expectMinimized(page, true);
});

test("a double click on a palette button or a popover does not minimize", async ({ page }) => {
  await openEditMode(page);
  const button = await page.locator("#paletteMermaid").boundingBox();
  await page.mouse.dblclick(button.x + button.width / 2, button.y + button.height / 2);
  await expectMinimized(page, false);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("two quick taps on the grip minimize once, without a zoom; two more restore; slow taps do nothing", async ({ page }) => {
    await openEditMode(page);
    await page.evaluate(() => {
      window.__gripPointerTypes = [];
      document.getElementById("editPalette").addEventListener("pointerdown", (e) => window.__gripPointerTypes.push(e.pointerType), true);
    });
    const c = await gripCenter(page);
    await page.touchscreen.tap(c.x, c.y);
    await expectMinimized(page, false);
    await page.touchscreen.tap(c.x, c.y);
    await expectMinimized(page, true);
    await page.waitForTimeout(LONG_PRESS_MS + 100); // a dblclick, if the browser sends one, does not toggle back
    await expectMinimized(page, true);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(await documentSelection(page)).toEqual({ text: "", inPalette: false });
    await page.touchscreen.tap(c.x, c.y);
    await page.touchscreen.tap(c.x, c.y);
    await expectMinimized(page, false);
    await page.waitForTimeout(LONG_PRESS_MS + 100);
    await expectMinimized(page, false);

    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(CONFIG.edit.paletteDoubleTapMs + 150);
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(100);
    await expectMinimized(page, false);
    await expect(blockEditor(page)).toHaveCount(0);
    // the taps came as touch (the paletteDoubleTapMs path, not the dblclick of a mouse)
    const types = await page.evaluate(() => window.__gripPointerTypes);
    expect(types).toHaveLength(6);
    expect(new Set(types)).toEqual(new Set(["touch"]));
  });
});
