import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// Typing in an open block editor keeps the caret and the view where they
// were from the first key on (INV-40, INV-84; PRT-AG04). The owner's iPad
// (beta2): after a tap in edit mode, the first key moved the caret to the
// start of the block, the next key moved it back. Playwright's WebKit does
// not show that move itself; these tests check what led to it: the editor
// was made one line high ("auto") at each key to be measured, and a view
// the browser moves at an insert (WebKit far off, at a hard break in a long
// paragraph; Chromium's scroll anchoring a line) was not put back.

test.beforeEach(() => test.slow());

const LONG_PARAGRAPH = Array.from({ length: 1500 }, (_, n) => (n === 1200 ? "TARGET" : `word${n}`)).join(" ");
const CODE_LINES = Array.from({ length: 160 }, (_, n) => (n === 120 ? "target_line = 120" : `line_${n} = ${n}`));
const DOC = [
  "# Typing keeps the view",
  "",
  ...Array.from({ length: 20 }, (_, n) => `Filler paragraph ${n}.\n`),
  LONG_PARAGRAPH,
  "",
  "```python",
  ...CODE_LINES,
  "```",
  "",
  // a long tail: the end of the document is far below what is shown
  ...Array.from({ length: 200 }, (_, n) => `Tail paragraph ${n}.\n`),
].join("\n");

/** The centre of the first rendered character of text in the preview. */
async function renderedChar(page, text) {
  return page.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector("#preview"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.data.indexOf(text);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, text);
}

/** The view's position: the document's when it scrolls (touch), else the preview's. */
function viewPos(page) {
  return page.evaluate(() => {
    const preview = document.querySelector("#preview");
    return preview.scrollHeight > preview.clientHeight ? preview.scrollTop : window.scrollY;
  });
}

/** Scroll the view so that text is at the given top on screen. */
async function scrollTextTo(page, text, top) {
  const at = await renderedChar(page, text);
  await page.evaluate((dy) => {
    const preview = document.querySelector("#preview");
    if (preview.scrollHeight > preview.clientHeight) preview.scrollTop += dy;
    else window.scrollBy(0, dy);
  }, at.y - top);
}

/**
 * From now on, every height the open editor is given (its style changes,
 * noted with their old values, so a height set and changed again in the same
 * task is seen too). heightsSince() returns them in order, the last one the
 * height it has now.
 */
async function recordHeights(page) {
  await page.evaluate(() => {
    const ta = document.querySelector("#preview textarea.md-block-editor");
    const heightOf = (style) => (/(?:^|;)\s*height:\s*([^;]+)/.exec(style ?? "") ?? [])[1]?.trim() ?? "";
    window.__e2eHeights = [];
    window.__e2eNoteHeights = (records) => {
      for (const r of records) window.__e2eHeights.push(heightOf(r.oldValue));
    };
    window.__e2eHeightObserver = new MutationObserver(window.__e2eNoteHeights);
    window.__e2eHeightOf = () => heightOf(ta.getAttribute("style"));
    window.__e2eHeightObserver.observe(ta, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
  });
}

function heightsSince(page) {
  return page.evaluate(() => {
    window.__e2eNoteHeights(window.__e2eHeightObserver.takeRecords());
    return [...window.__e2eHeights, window.__e2eHeightOf()];
  });
}

/** The open editor: the caret, the text around it, the view and the editor's own scroll. */
async function editorState(page) {
  return {
    view: await viewPos(page),
    ...(await page.evaluate(() => {
      const ta = document.querySelector("#preview textarea.md-block-editor");
      const caret = ta.selectionStart;
      return { caret, around: ta.value.slice(Math.max(0, caret - 8), caret) + "|" + ta.value.slice(caret, caret + 8), innerScroll: ta.scrollTop };
    })),
  };
}

/**
 * Type keys; each must leave the view where it was (when the browser moves
 * it in the insert, it is put back in the same task, before anything is
 * drawn) and the editor unscrolled, and the editor is never made shorter
 * than its text.
 */
async function typeKeepingView(page, browserName, name, keys) {
  const opened = await editorState(page);
  await recordHeights(page);
  const openedHeight = parseFloat(await page.evaluate(() => window.__e2eHeightOf()));
  const typed = [];
  for (const key of keys) {
    await page.keyboard.press(key);
    typed.push({ key, ...(await editorState(page)) });
  }
  const heights = await heightsSince(page);
  console.log(`${browserName} ${name}: opened ${JSON.stringify(opened)}, typed ${JSON.stringify(typed)}, heights ${JSON.stringify(heights)}`);
  // "auto": WebKit shows the caret where it is in the short editor, and the
  // view goes there (the iPad, beta2)
  for (const h of heights) {
    expect(h, JSON.stringify(heights)).toMatch(/^\d+(\.\d+)?px$/);
    expect(parseFloat(h), JSON.stringify(heights)).toBeGreaterThanOrEqual(openedHeight);
  }
  for (const s of typed) {
    expect(Math.abs(s.view - opened.view), s.key).toBeLessThanOrEqual(1);
    expect(s.innerScroll, s.key).toBe(0);
  }
  return { opened, typed };
}

test.describe("touch: [Edit], then a tap opens the block", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });

  /**
   * A tap at a point of the page (CSS pixels of the layout viewport). The
   * page has no viewport meta, so a mobile profile lays it out 980 px wide
   * and shows it scaled; Playwright's WebKit takes the tap in the scaled
   * screen pixels (Chromium in CSS pixels), so the point is scaled there.
   */
  async function tapAt(page, browserName, x, y) {
    const scale = browserName === "webkit" ? await page.evaluate(() => window.visualViewport.scale) : 1;
    await page.touchscreen.tap(x * scale, y * scale);
  }

  for (const c of [
    { name: "a paragraph", text: "TARGET" },
    { name: "a code block", text: "target_line" },
  ]) {
    test(`typing in ${c.name} keeps the caret and the view from the first key on (INV-40, INV-84; PRT-AG04)`, async ({ page, browserName }) => {
      await page.goto("/");
      await renderMarkdown(page, DOC);
      await settled(page);
      const button = await page.locator("#editBtn").boundingBox();
      await tapAt(page, browserName, button.x + button.width / 2, button.y + button.height / 2);
      await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
      await settled(page);
      await scrollTextTo(page, c.text, 500);
      const at = await renderedChar(page, c.text);
      await tapAt(page, browserName, at.x + 1, at.y);
      const editor = page.locator("#preview textarea.md-block-editor");
      await expect(editor).toBeFocused();
      await settled(page);
      // the tapped block starts above the view: a scroll to its start is a jump
      expect(await editor.evaluate((ta) => ta.getBoundingClientRect().top)).toBeLessThan(0);
      const { opened, typed } = await typeKeepingView(page, browserName, c.name, ["x", "y", "Enter", "z"]);
      expect(opened.around.replace("|", "")).toContain(c.text.slice(0, 4));
      // the letters go in at the tapped place, and the caret stays after them
      expect(typed[0].caret).toBe(opened.caret + 1);
      expect(typed[1].caret).toBe(opened.caret + 2);
      expect(typed[3].around).toMatch(/z\|/);
      // a Backspace takes the z away: the editor is measured short then, and
      // the view stays where it was
      await page.keyboard.press("Backspace");
      const deleted = await editorState(page);
      expect(deleted.caret).toBe(typed[3].caret - 1);
      expect(Math.abs(deleted.view - opened.view)).toBeLessThanOrEqual(1);
      expect(deleted.innerScroll).toBe(0);
    });
  }
});

/**
 * The caret's line in the open editor on screen (a hidden copy of the
 * editor's text up to the caret, then a mark), and the top and bottom of
 * what the preview shows.
 */
function caretLine(page) {
  return page.evaluate(() => {
    const ta = document.querySelector("#preview textarea.md-block-editor");
    const preview = document.querySelector("#preview");
    const style = getComputedStyle(ta);
    const copy = document.createElement("div");
    for (const p of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingLeft", "tabSize", "whiteSpace", "overflowWrap"]) copy.style[p] = style[p];
    Object.assign(copy.style, { position: "absolute", visibility: "hidden", top: "0", left: "0" });
    const mark = document.createElement("span");
    mark.textContent = "|";
    copy.append(ta.value.slice(0, ta.selectionStart), mark);
    document.body.append(copy);
    const top = ta.getBoundingClientRect().top + mark.getBoundingClientRect().top - copy.getBoundingClientRect().top;
    const bottom = top + mark.getBoundingClientRect().height;
    copy.remove();
    const shownTop = preview.getBoundingClientRect().top;
    return { top, bottom, shownTop, shownBottom: shownTop + preview.clientHeight };
  });
}

test.describe("mouse: a double click opens the block", () => {
  async function openAt(page, text, top) {
    await page.goto("/");
    await renderMarkdown(page, DOC);
    await settled(page);
    await scrollTextTo(page, text, top);
    const at = await renderedChar(page, text);
    await page.mouse.dblclick(at.x + 1, at.y);
    await expect(page.locator("#preview textarea.md-block-editor")).toBeFocused();
    await settled(page);
  }

  test("letters and hard breaks in the middle of a long paragraph keep the view (INV-40, INV-71)", async ({ page, browserName }) => {
    await openAt(page, "TARGET", 300);
    await typeKeepingView(page, browserName, "long paragraph", ["x", "Enter", "y", "Enter", "z"]);
  });

  test("a hard break on the last line shown scrolls the least that shows the caret (INV-40)", async ({ page, browserName }) => {
    await openAt(page, "TARGET", 300);
    // the caret's line is the last one shown
    const opened = await caretLine(page);
    await page.evaluate((dy) => (document.querySelector("#preview").scrollTop += dy), opened.bottom - opened.shownBottom + 2);
    await settled(page);
    const before = await viewPos(page);
    await page.keyboard.press("Enter");
    const after = await viewPos(page);
    const typed = await caretLine(page);
    console.log(`${browserName} bottom edge: view ${before} -> ${after}, caret line ${JSON.stringify(typed)}`);
    // the least move that shows the caret's line: a line or so, not a jump
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThanOrEqual(2 * (opened.bottom - opened.top) + 2);
    expect(typed.top).toBeGreaterThanOrEqual(typed.shownTop - 1);
    expect(typed.bottom).toBeLessThanOrEqual(typed.shownBottom + 1);
  });
});
