import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// A block editor shows its text as the rendered block does (INV-83), opens
// with the caret where the block was double-clicked, and keeps that line
// where it was on screen when it opens and when it is committed (INV-84).
// Fitting its height while typing does not move the view (INV-40). Owner
// rulings ESF-1 to ESF-5 (2026-10-27).

test.beforeEach(() => test.slow());

const CODE_LINES = 40;
const DOC = [
  ...Array.from({ length: 6 }, (_, i) => [`## Section ${i}`, "", `Paragraph ${i} ` + "lorem ipsum dolor sit amet, a [link](https://example.com/a/long/path/that/goes/on) and **bold** text ".repeat(6), ""]).flat(),
  "```js",
  ...Array.from({ length: CODE_LINES }, (_, n) => `const line${n} = ${n}; // code line ${n}`),
  "```",
  "",
  ...Array.from({ length: 6 }, (_, i) => [`## Section ${i + 6}`, "", `Paragraph ${i + 6} ` + "lorem ipsum dolor sit amet ".repeat(10), ""]).flat(),
  "Last paragraph " + "tail words here ".repeat(80),
].join("\n");

/** The first rendered character of text in the preview: its centre and top. */
async function renderedChar(page, text, nth = 1) {
  return page.evaluate(
    ({ text, nth }) => {
      const walker = document.createTreeWalker(document.querySelector("#preview"), NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = node.data.indexOf(text); i >= 0; i = node.data.indexOf(text, i + 1)) {
          if (++seen < nth) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
        }
      }
      return null;
    },
    { text, nth },
  );
}

/** In the open editor: the top on screen of the first character of text, and the text around the caret. */
async function editorState(page, text) {
  return page.evaluate((text) => {
    const ta = document.querySelector("#preview textarea.md-block-editor");
    const style = getComputedStyle(ta);
    const copy = document.createElement("div");
    for (const p of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingLeft", "tabSize"]) copy.style[p] = style[p];
    Object.assign(copy.style, { position: "absolute", visibility: "hidden", top: "0", left: "0", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
    const at = ta.value.indexOf(text);
    const mark = document.createElement("span");
    mark.textContent = ta.value[at];
    copy.append(ta.value.slice(0, at), mark, ta.value.slice(at + 1));
    document.body.append(copy);
    const top = ta.getBoundingClientRect().top + mark.getBoundingClientRect().top - copy.getBoundingClientRect().top;
    copy.remove();
    const caret = ta.selectionStart;
    return { top, before: ta.value.slice(Math.max(0, caret - 12), caret), after: ta.value.slice(caret, caret + 12) };
  }, text);
}

/** Scroll the preview so that text is at the given top. */
async function scrollTextTo(page, text, top) {
  await page.evaluate(
    ({ text, top }) => {
      const preview = document.querySelector("#preview");
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.data.indexOf(text);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        preview.scrollTop += range.getClientRects()[0].top - top;
        return;
      }
    },
    { text, top },
  );
}

async function open(page) {
  await page.goto("/");
  await renderMarkdown(page, DOC);
  await settled(page);
}

test("a code block opens with the caret on the double-clicked line, which stays where it was; typing and Esc keep it there (INV-84)", async ({ page, browserName }) => {
  await open(page);
  // line 30 well inside the block, whose top is above what is shown
  await scrollTextTo(page, "line30 ", 300);
  const before = await renderedChar(page, "line30 ");
  await page.mouse.dblclick(before.x + 20, before.y);
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toBeFocused();
  const opened = await editorState(page, "line30 ");
  expect(opened.before + opened.after).toContain("line30");
  await page.keyboard.type("XY");
  const typed = await editorState(page, "XY");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await settled(page);
  const committed = await renderedChar(page, "XY");
  console.log(`${browserName} code line: before ${before.top}, opened ${opened.top}, typed ${typed.top}, committed ${committed.top}`);
  expect(Math.abs(opened.top - before.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(typed.top - before.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(committed.top - before.top)).toBeLessThanOrEqual(1);
});

test("a paragraph with links before the double-clicked word: the caret is at that word, and its line stays (INV-84)", async ({ page, browserName }) => {
  await open(page);
  await scrollTextTo(page, "Paragraph 3 ", 200);
  // the fifth " text " of paragraph 3: five links come before it
  const word = await page.evaluate(() => {
    const p = [...document.querySelectorAll("#preview p")].find((el) => el.textContent.startsWith("Paragraph 3 "));
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.data.indexOf(" text ");
      if (i < 0 || ++seen < 5) continue;
      const range = document.createRange();
      range.setStart(node, i + 1);
      range.setEnd(node, i + 2);
      const r = range.getClientRects()[0];
      return { x: r.left + 1, y: r.top + r.height / 2, top: r.top };
    }
    return null;
  });
  await page.mouse.dblclick(word.x, word.y);
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toBeFocused();
  const state = await page.evaluate(() => {
    const ta = document.querySelector("#preview textarea.md-block-editor");
    return { before: ta.value.slice(0, ta.selectionStart) };
  });
  // five links and their destinations before it; the caret right before "text"
  expect(state.before.split("](https://").length - 1).toBe(5);
  expect(state.before).toMatch(/\*\*bold\*\* $/);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await settled(page);
  const after = await page.evaluate(() => {
    const p = [...document.querySelectorAll("#preview p")].find((el) => el.textContent.startsWith("Paragraph 3 "));
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.data.indexOf(" text ");
      if (i < 0 || ++seen < 5) continue;
      const range = document.createRange();
      range.setStart(node, i + 1);
      range.setEnd(node, i + 2);
      return range.getClientRects()[0].top;
    }
    return null;
  });
  console.log(`${browserName} paragraph word: before ${word.top}, after Esc ${after}`);
  expect(Math.abs(after - word.top)).toBeLessThanOrEqual(1);
});

test("the editor shows its text as the rendered block does: paragraph, heading, code (INV-83)", async ({ page }) => {
  await open(page);
  const cases = [
    { selector: "#preview p", pick: "Paragraph 2 ", text: "p" },
    { selector: "#preview h2", pick: "Section 2", text: "h2" },
    { selector: "#preview pre code", pick: "line5 ", text: "pre code" },
  ];
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  for (const c of cases) {
    const rendered = await page.evaluate(({ selector, pick }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.includes(pick));
      el.scrollIntoView({ block: "center" });
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight };
    }, c);
    await page.locator(c.selector, { hasText: c.pick }).first().click();
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toBeFocused();
    const shown = await editor.evaluate((ta) => {
      const s = getComputedStyle(ta);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, padding: s.paddingTop, border: s.borderTopWidth };
    });
    expect({ fontFamily: shown.fontFamily, fontSize: shown.fontSize, fontWeight: shown.fontWeight, lineHeight: shown.lineHeight }, c.text).toEqual(rendered);
    expect(shown.border, c.text).toBe("0px");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
  }
});

for (const touch of [false, true]) {
  test.describe(touch ? "touch: the document scrolls" : "mouse: the preview scrolls", () => {
    if (touch) test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test("typing at the end of the last block, scrolled to the end, does not move the view (INV-40)", async ({ page, browserName }) => {
      await open(page);
      const scrollPos = () => page.evaluate((t) => (t ? window.scrollY : document.querySelector("#preview").scrollTop), touch);
      await page.evaluate((t) => {
        if (t) window.scrollTo(0, document.documentElement.scrollHeight);
        else {
          const preview = document.querySelector("#preview");
          preview.scrollTop = preview.scrollHeight;
        }
      }, touch);
      await page.locator("#editBtn").click();
      await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
      await settled(page);
      const last = await renderedChar(page, "Last paragraph");
      await page.locator("#preview p", { hasText: "Last paragraph" }).click({ position: { x: 5, y: 5 } });
      const editor = page.locator("#preview textarea.md-block-editor");
      await expect(editor).toBeFocused();
      const start = await scrollPos();
      const moves = [];
      for (const key of ["a", "b", "c", "d", "e", "f", "g", "h", "Enter", "i"]) {
        await page.keyboard.press(key);
        moves.push((await scrollPos()) - start);
      }
      console.log(`${browserName} ${touch ? "touch" : "mouse"} typing at the end (last block top ${last.top}): ${moves.join(", ")}`);
      for (const move of moves) expect(Math.abs(move)).toBeLessThanOrEqual(3);
    });
  });
}

test("the Index and Search panels let 15% of what is behind show through (INV-77, INV-80)", async ({ page }) => {
  await open(page);
  await page.locator("#indexBtn").click();
  await page.locator("#searchBtn").click();
  for (const id of ["#indexPanel", "#searchPanel"]) {
    await expect(page.locator(id)).toBeVisible();
    expect(await page.locator(id).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(255, 255, 255, 0.85)");
  }
});
