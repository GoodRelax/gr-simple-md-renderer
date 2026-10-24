import { devices } from "@playwright/test";
import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// The UI fixes of 2026-10-23 in real browsers: Esc applies and closes (D1),
// Undo / Redo up to CONFIG.edit.undoMaxSteps (D4, D5), Enter in a table's
// source (B2), the text colors (B3), and a new block from a gap between
// blocks (B1, INV-73) with the mouse and with touch taps. No request leaves
// the page (the fixture checks it).

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const editor = (page) => page.locator("#preview textarea.md-block-editor");
// the whole body: #editor follows each commit, undo and redo (INV-47); waits for it
const expectBody = (page, value) => expect(page.locator("#editor")).toHaveValue(value);

async function openEditMode(page, markdown) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
  await settled(page);
}

const DOC = "# Title\n\nFirst para.\n\nSecond para.\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
const MORE = DOC.replace("First para.", "First para. More");

test("Esc applies the open block and closes it; Ctrl+Z takes it back; Redo brings it again (D1, D3, D5)", async ({ page }) => {
  await openEditMode(page, DOC);
  await page.locator("#preview p", { hasText: "First para." }).click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(" More");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("#preview p", { hasText: "First para. More" })).toBeVisible();
  await expectBody(page, MORE);
  await expect(page.locator("#paletteSave")).toBeVisible(); // the palette stays
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator("#preview p", { hasText: "First para. More" })).toHaveCount(0);
  await expectBody(page, DOC);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(page.locator("#preview p", { hasText: "First para. More" })).toBeVisible();
  await expectBody(page, MORE);
  if (MOD === "Control") {
    await page.keyboard.press("Control+z");
    await expectBody(page, DOC); // the undo did happen
    await page.keyboard.press("Control+y");
    await expectBody(page, MORE);
  }
  // the next Esc (nothing open) hides the palette
  await page.keyboard.press("Escape");
  await expect(page.locator("#paletteSave")).toBeHidden();
});

test("Esc with the Format popover open closes the popover first, then applies the block, then hides the palette (D9)", async ({ page }) => {
  await openEditMode(page, DOC);
  await page.locator("#preview p", { hasText: "First para." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.locator("#paletteFormat").click();
  const menu = page.locator("#paletteFormatMenu");
  await expect(menu).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expectBody(page, DOC.replace("First para.", "First para.!"));
  await expect(page.locator("#paletteSave")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#paletteSave")).toBeHidden();
});

test("Redo in a block editor is the browser's: typing undone with Ctrl+Z comes back with Ctrl+Y / Ctrl+Shift+Z (ruling M5)", async ({ page }) => {
  await openEditMode(page, DOC);
  // a unit to redo is on the record: the app's Redo must not take it
  await page.locator("#preview p", { hasText: "Second para." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("2");
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+z`);
  await expectBody(page, DOC);
  await page.locator("#preview p", { hasText: "First para." }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("X");
  await expect(editor(page)).toHaveValue("First para.X");
  await page.keyboard.press(`${MOD}+z`);
  await expect(editor(page)).toHaveValue("First para.");
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(editor(page)).toHaveValue("First para.X");
  await expectBody(page, DOC); // nothing redone in the document
});

test("Esc during IME composition does not close the editor (D2)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "IME composition is driven through the Chromium DevTools protocol");
  await openEditMode(page, DOC);
  await page.locator("#preview p", { hasText: "First para." }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "\u3042", selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeVisible();
});

test("Undo goes back unit by unit, and Redo forward again (D4)", async ({ page }) => {
  await openEditMode(page, DOC);
  for (const [start, add] of [["First", "1"], ["Second", "2"], ["Title", "3"]]) {
    await page.locator("#preview > .md-block", { hasText: start }).first().click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.type(add);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
  }
  const all = DOC.replace("First para.", "First para.1").replace("Second para.", "Second para.2").replace("# Title", "# Title3");
  await expectBody(page, all);
  await page.locator("#paletteUndo").click();
  await expectBody(page, all.replace("# Title3", "# Title"));
  await page.locator("#paletteUndo").click();
  await page.locator("#paletteUndo").click();
  await expectBody(page, DOC);
  await expect(page.locator("#paletteUndo")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expectBody(page, DOC.replace("First para.", "First para.1"));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expectBody(page, all);
});

test("Enter in a table's source is a newline; Shift+Enter is <br> (B2)", async ({ page }) => {
  await openEditMode(page, "# T\n\n| A | B |\n| --- | --- |\n| x | y |\n");
  await page.locator("#preview .grsmd-table-tab").click();
  const ta = editor(page);
  await expect(ta).toBeVisible();
  await ta.evaluate((el) => {
    const at = el.value.indexOf("x") + 1;
    el.setSelectionRange(at, at);
  });
  await page.keyboard.press("Shift+Enter");
  await expect(ta).toHaveValue(/\| x<br> \| y \|/);
  await ta.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.press("Enter");
  await page.keyboard.type("| z | w |");
  await expect(ta).toHaveValue(/\| y \|\n\| z \| w \|$/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview table tr")).toHaveCount(3);
});

test("the palette's red, blue and green are GitHub's; dark shows their pairs (B3)", async ({ page }) => {
  await openEditMode(page, '# T\n\n<span style="color: #CF222E">r</span> <span style="color: #0550AE">b</span> <span style="color: #1A7F37">g</span> <span style="color: #B84F00">old</span>\n');
  const color = (text) => page.locator("#preview span", { hasText: new RegExp(`^${text}$`) }).evaluate((el) => getComputedStyle(el).color);
  expect([await color("r"), await color("b"), await color("g")]).toEqual(["rgb(207, 34, 46)", "rgb(5, 80, 174)", "rgb(26, 127, 55)"]);
  await page.locator("#renderDark").click();
  await settled(page);
  expect([await color("r"), await color("b"), await color("g")]).toEqual(["rgb(248, 81, 73)", "rgb(88, 166, 255)", "rgb(63, 185, 80)"]);
  expect(await color("old")).toBe("rgb(184, 79, 0)"); // a former color: shown as written, no dark pair
});

/** The middle of the gap between the wrappers of two blocks (or just below the last one). */
async function gapPoint(page, aboveText) {
  return page.evaluate((text) => {
    const blocks = [...document.querySelectorAll("#preview > .md-block")];
    const i = blocks.findIndex((el) => el.textContent.includes(text));
    const a = blocks[i].getBoundingClientRect();
    const b = blocks[i + 1]?.getBoundingClientRect();
    const left = document.querySelector("#preview").getBoundingClientRect().left + 60;
    return { x: left, y: b ? (a.bottom + b.top) / 2 : a.bottom + 4 };
  }, aboveText);
}
const line = (page) => page.locator(".grsmd-gap-insert");

test.describe("a new block from a gap between blocks (B1, INV-73)", () => {
  test("mouse: the line shows only in edit mode; a click opens an empty editor below the last diagram; Esc applies; one Undo takes it away", async ({ page }) => {
    await page.goto("/");
    await renderMarkdown(page, DOC);
    await settled(page);
    let p = await gapPoint(page, "First para.");
    await page.mouse.move(p.x, p.y);
    await expect(line(page)).toHaveCount(0); // not in edit mode
    await page.locator("#editBtn").click();
    await settled(page);
    p = await gapPoint(page, "flowchart");
    await page.mouse.move(p.x, p.y - 1);
    await page.mouse.move(p.x, p.y);
    await expect(line(page)).toBeVisible();
    await line(page).click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(page)).toHaveValue("");
    await page.keyboard.type("After the diagram.");
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await expectBody(page, `${DOC}\nAfter the diagram.\n`); // the last newline stays (L1)
    await expect(page.locator("#preview > .md-block").last()).toHaveText("After the diagram.");
    await page.keyboard.press(`${MOD}+z`);
    await expectBody(page, DOC);
  });

  test("mouse: between two blocks, while another block is open (it is committed first); empty and Esc changes nothing", async ({ page }) => {
    await openEditMode(page, DOC);
    await page.locator("#preview p", { hasText: "Second para." }).click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    const p = await gapPoint(page, "First para.");
    await page.mouse.move(p.x, p.y - 1);
    await page.mouse.move(p.x, p.y);
    await expect(line(page)).toBeVisible();
    await line(page).click();
    await expect(editor(page)).toHaveValue("");
    await expectBody(page, DOC.replace("Second para.", "Second para.!"));
    await page.keyboard.press("Escape"); // empty: nothing
    await expect(editor(page)).toHaveCount(0);
    await expectBody(page, DOC.replace("Second para.", "Second para.!"));
    const q = await gapPoint(page, "First para.");
    await page.mouse.move(q.x, q.y - 1);
    await page.mouse.move(q.x, q.y);
    await line(page).click();
    await page.keyboard.type("Between.");
    await page.locator("#preview h1").click(); // outside: commit, and the title opens
    await expect(page.locator("#editor")).toHaveValue(/First para\.\n\nBetween\.\n\nSecond para\.!/);
  });

  test.describe("touch", () => {
    test.use({ hasTouch: true });

    test("tap the gap: the line shows (no block opens); tap the line: the editor opens there", async ({ page }) => {
      await openEditMode(page, DOC);
      const p = await gapPoint(page, "First para.");
      await page.touchscreen.tap(p.x, p.y);
      await expect(line(page)).toBeVisible();
      await expect(editor(page)).toHaveCount(0);
      const box = await line(page).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(editor(page)).toBeVisible();
      await page.keyboard.type("Tapped in.");
      await page.locator("#preview h1").tap();
      await expect(page.locator("#editor")).toHaveValue(/First para\.\n\nTapped in\.\n\nSecond para\./);
    });
  });
});

test.describe("a phone: the top bar over the preview (review M1)", () => {
  // Pixel 7 (Chromium): coarse pointer, so the top bar is sticky over the scrolled page
  const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
  test.use(pixel7);
  test.skip(({ browserName }) => browserName !== "chromium", "the Pixel 7 profile is a Chromium device");

  test("a tap on the top bar where a gap is under it shows no line; the bar's button still works", async ({ page }) => {
    const paras = Array.from({ length: 200 },(_, i) => `Paragraph ${i} of a long page.`).join("\n\n");
    await openEditMode(page, `# Long\n\n${paras}\n`);
    // scroll so that the middle of a gap lies under the middle of a button of the (sticky) top bar
    const at = await page.evaluate(() => {
      const button = document.querySelector("#renderDark").getBoundingClientRect();
      const y = button.top + button.height / 2;
      const blocks = [...document.querySelectorAll("#preview > .md-block")];
      const a = blocks[100].getBoundingClientRect();
      const b = blocks[101].getBoundingClientRect();
      document.scrollingElement.scrollTop += (a.bottom + b.top) / 2 - y;
      const a2 = blocks[100].getBoundingClientRect();
      const b2 = blocks[101].getBoundingClientRect();
      return { x: button.left + button.width / 2, y, gap: (a2.bottom + b2.top) / 2 };
    });
    expect(Math.abs(at.gap - at.y)).toBeLessThan(2); // the gap is right under the button
    const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("#topbar") !== null, at);
    expect(under).toBe(true);
    await page.touchscreen.tap(at.x, at.y);
    await expect(line(page)).toHaveCount(0);
    await expect(editor(page)).toHaveCount(0);
    await expect(page.locator("body")).toHaveClass(/\bdark\b/); // the button's own tap did act
  });
});

// Timing depends on the machine: only with GRSMD_PERF=1, as the other timing
// checks (R6 Independence, Q8). Review M3: following the mouse in edit mode
// on 1 MB.
const MOVE_FRAME_BUDGET_MS = 4; // a quarter of a 60 Hz frame
test("INV-51 / INV-73 (review M3): 1 MB in edit mode, the frame that follows a mouse move takes at most 4 ms in Chromium", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "INV-51 is measured in Chrome");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(180000);
  let doc = "";
  for (let i = 0; doc.length < 1024 * 1024; i++) doc += `\n## Section ${i}\n\nParagraph ${i} with some words to make it longer, and **bold** text.\n`;
  await openEditMode(page, doc);
  // time every animation frame callback from now on (the gaps follow the mouse in one)
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__frameTimes = [];
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const t0 = performance.now();
        cb(t);
        window.__frameTimes.push(performance.now() - t0);
      });
  });
  // one move: its pointermove handlers, then the longest frame callback after it
  const times = await page.evaluate(async () => {
    const box = document.querySelector("#preview").getBoundingClientRect();
    const out = [];
    for (let i = 0; i < 40; i++) {
      const x = box.left + 80;
      const y = box.top + 40 + ((i * 7) % Math.max(box.height - 80, 1));
      const target = document.elementFromPoint(x, y) ?? document.body;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.__frameTimes = [];
      const t0 = performance.now();
      target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
      const inEvent = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(inEvent + Math.max(0, ...window.__frameTimes));
    }
    return out;
  });
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`M3 mouse move frames on 1 MB (ms): median ${median.toFixed(2)}, max ${times[times.length - 1].toFixed(2)}`);
  expect(median).toBeLessThanOrEqual(MOVE_FRAME_BUDGET_MS);
});
