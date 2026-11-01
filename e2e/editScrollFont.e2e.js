import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// A block editor shows its text as the rendered block does (INV-83), opens
// with the caret where the block was double-clicked, and keeps that line
// where it was on screen when it opens and when it is committed (INV-84).
// Fitting its height while typing does not move the view (INV-40). Owner
// rulings ESF-1 to ESF-8 (2026-10-27 to 2026-10-29).

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

// A list, a quote and a paragraph, each long enough to wrap, with text
// above and below: the view can scroll both ways to keep a line (the
// editor may wrap a line where the rendered block does not).
const FILLER = (from, count) => Array.from({ length: count }, (_, i) => `Filler ${from + i} ` + "lorem ipsum dolor sit amet ".repeat(6));
const KINDS_DOC = [
  ...FILLER(0, 20),
  ["- first item " + "alpha beta gamma ".repeat(8) + "listword end", "- second item", "  - nested item"].join("\n"),
  "> quoted " + "delta epsilon zeta ".repeat(8) + "quoteword end\n> second line",
  "A paragraph with **bold** and a [link](https://example.com/p) " + "eta theta iota ".repeat(8) + "paraword end",
  ...FILLER(20, 20),
].join("\n\n");

test("edit mode: one press on a list item, a quote, a paragraph opens with the caret at the pressed word, and its line stays (INV-84)", async ({ page, browserName }) => {
  await page.goto("/");
  await renderMarkdown(page, KINDS_DOC);
  await settled(page);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  await settled(page);
  const editor = page.locator("#preview textarea.md-block-editor");
  for (const { word, source } of [
    { word: "listword", source: /alpha beta gamma $/ },
    { word: "quoteword", source: /delta epsilon zeta $/ },
    { word: "paraword", source: /eta theta iota $/ },
  ]) {
    await scrollTextTo(page, word, 300);
    const before = await renderedChar(page, word);
    // the left edge of the word's first character: the caret goes before it
    await page.mouse.click(before.x - 2, before.y);
    await expect(editor).toBeFocused();
    const opened = await editorState(page, word);
    const caret = await editor.evaluate((ta) => ta.value.slice(0, ta.selectionStart));
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await settled(page);
    const closed = await renderedChar(page, word);
    console.log(`${browserName} one press on ${word}: before ${before.top}, opened ${opened.top}, after Esc ${closed.top}`);
    expect(caret, word).toMatch(source);
    expect(Math.abs(opened.top - before.top), word).toBeLessThanOrEqual(1);
    expect(Math.abs(closed.top - before.top), word).toBeLessThanOrEqual(1);
  }
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

// The owner's case (ESF-8, 2026-10-29, Edge): the last block is a tall code block,
// mostly blank lines, typed into in its middle. Fitting the height shrank the
// editor for a moment, so Chromium too clamped the scroll: before the fix the
// view moved 351 px at the first key and 21 px more at each Enter.
const TALL_CODE_DOC = [
  ...Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(8)),
  ["```text", "first", ...Array(22).fill(""), "marker", "edit1", ...Array(20).fill(""), "edit2", ...Array(40).fill(""), "last", "```"].join("\n"),
].join("\n\n");

test("typing in the middle of a tall code block at the end of the document does not move the view (INV-40)", async ({ page, browserName }) => {
  await page.goto("/");
  await renderMarkdown(page, TALL_CODE_DOC);
  await settled(page);
  await scrollTextTo(page, "edit1", 380);
  const before = await renderedChar(page, "edit1");
  await page.mouse.dblclick(before.x, before.y);
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toBeFocused();
  const scrollPos = () => page.evaluate(() => document.querySelector("#preview").scrollTop);
  const start = await scrollPos();
  const moves = [];
  for (const key of ["End", "a", "b", "c", "Enter", "d", "Enter", "e"]) {
    await page.keyboard.press(key);
    moves.push((await scrollPos()) - start);
  }
  const typed = await editorState(page, "edit1");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await settled(page);
  const committed = await renderedChar(page, "edit1");
  console.log(`${browserName} tall code block: ${moves.join(", ")}; edit1 before ${before.top}, typed ${typed.top}, committed ${committed.top}`);
  for (const move of moves) expect(Math.abs(move)).toBeLessThanOrEqual(1);
  expect(Math.abs(typed.top - before.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(committed.top - before.top)).toBeLessThanOrEqual(1);
});

test("the Index and Search panels let 15% of what is behind show through (INV-77, INV-80)", async ({ page }) => {
  await open(page);
  await page.locator("#indexBtn").click();
  await page.locator("#searchBtn").click();
  for (const id of ["#indexPanel", "#searchPanel"]) {
    await expect(page.locator(id)).toBeVisible();
    expect(await page.locator(id).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(255, 255, 255, 0.85)");
  }
});

// Timing depends on the machine: only with GRSMD_PERF=1, as the other timing
// checks. INV-84 (performance): finding the double-clicked character in the
// rendered block and in its source, placing the caret and keeping its line
// must not make opening a large block slow: from the double click to the
// open editor laid out, within a browser's long task (50 ms, as INV-74).
// Measured 2026-10-28, develop before INV-84 / with it, three runs each
// (ms): 5,000 lines 45, 42, 55 / 49, 55, 51; highlighted 11, 14, 12 / 16,
// 27, 17; 100 KB paragraph 18, 17, 24 / 36, 41, 33. The 5,000 lines took
// about 45 ms before (laying out the editor's 200 KB is most of it), so
// their budget is 80 ms. Esc to the committed block drawn again is logged
// only: it is the block's render (85 to 95 ms for the 100 KB paragraph,
// before and with INV-84 alike).
const PERF_CASES = [
  {
    name: "a code block of 5,000 lines (no highlighting)",
    budget: 80,
    markdown: ["Intro.", "", "```", ...Array.from({ length: 5000 }, (_, n) => `value_${n} = compute(${n}) + offset; // line ${n}`), "```", "", "Outro."].join("\n"),
    pick: "line 4900",
  },
  {
    name: "a JavaScript block just under the highlighting limit",
    budget: 50,
    markdown: ["Intro.", "", "```js", ...Array.from({ length: 480 }, (_, n) => `const v${n} = fn("s${n}", ${n}); // c${n}`), "```", "", "Outro."].join("\n"),
    pick: "// c470",
  },
  {
    name: "a paragraph of 100 KB with bold and links",
    budget: 50,
    markdown: ["Intro.", "", Array.from({ length: 1400 }, (_, n) => `word${n} **bold${n}** [link${n}](https://example.com/p/${n}) and more`).join(" "), "", "Outro."].join("\n"),
    pick: "word1390 ",
  },
];

for (const c of PERF_CASES) {
  test(`INV-84 (performance): ${c.name}: double click to open within ${c.budget} ms`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "measured in Chrome (INV-51)");
    test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
    test.setTimeout(180000);
    await page.goto("/");
    await renderMarkdown(page, c.markdown);
    await settled(page);
    await scrollTextTo(page, c.pick, 300);
    const target = await renderedChar(page, c.pick);
    const open = await page.evaluate(({ x, y }) => {
      const t0 = performance.now();
      document.elementFromPoint(x, y).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2, view: window }));
      document.querySelector("#preview").getBoundingClientRect();
      return performance.now() - t0;
    }, target);
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toBeFocused();
    const caretAt = await editor.evaluate((ta) => ta.value.slice(ta.selectionStart - 12, ta.selectionStart + 12));
    await editor.evaluate((ta) => {
      ta.setRangeText("X", ta.selectionStart, ta.selectionStart, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const commit = await page.evaluate(async () => {
      performance.clearMeasures("grsmd-commit");
      const ta = document.querySelector("#preview textarea.md-block-editor");
      const t0 = performance.now();
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await new Promise((resolve) => {
        const check = () => (performance.getEntriesByName("grsmd-commit", "measure").length ? resolve() : setTimeout(check, 1));
        check();
      });
      const swap = performance.getEntriesByName("grsmd-commit", "measure")[0];
      return swap.startTime + swap.duration - t0;
    });
    await settled(page);
    console.log(`${c.name}: open ${open.toFixed(1)} ms (caret at ${JSON.stringify(caretAt)}), Esc to swap ${commit.toFixed(1)} ms`);
    expect(caretAt).toContain(c.pick.trim().slice(0, 4));
    expect(open).toBeLessThanOrEqual(c.budget);
  });
}

// INV-40 (performance, logged only): one key in a paragraph of a 1 MB
// document, from the input to the layout read after it. Fitting the editor's
// height lays out the whole document once; before review M1 (2026-10-29) the
// scroll was read before that too, which laid it out once more at each key.
// The budget is the review standard's G10 (a quarter of a frame, 4 ms); no
// number is set in the spec, so this logs the median (coordinator ruling
// 2026-10-29). The measures are in the spec at INV-40.
const BIG_DOC = Array.from({ length: 3000 }, (_, i) => {
  if (i % 10 === 0) return `## Section ${i}`;
  if (i % 10 === 5) return `- item ${i} one\n- item ${i} two\n- item ${i} three`;
  return `Para ${i} ` + "lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(7);
}).join("\n\n");

for (const where of [
  { name: "in the middle", pick: "Para 1501 " },
  { name: "near the end", pick: "Para 2991 " },
]) {
  test(`INV-40 (performance): one key in a paragraph ${where.name} of a 1 MB document (logged)`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "measured in Chrome (INV-51)");
    test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
    test.setTimeout(180000);
    await page.goto("/");
    await renderMarkdown(page, BIG_DOC);
    await settled(page);
    await scrollTextTo(page, where.pick, 300);
    const target = await renderedChar(page, where.pick);
    await page.mouse.dblclick(target.x, target.y);
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toBeFocused();
    const times = await page.evaluate(async () => {
      const ta = document.querySelector("#preview textarea.md-block-editor");
      const out = [];
      for (let k = 0; k < 15; k++) {
        // a frame between keys, as when typing: the layout is current and
        // the scroll events of the last key have come
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const t0 = performance.now();
        ta.setRangeText(k % 5 === 4 ? "\n" : "x", ta.selectionStart, ta.selectionStart, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#preview").getBoundingClientRect();
        out.push(performance.now() - t0);
      }
      return out;
    });
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`1 MB, one key ${where.name}: median ${sorted[7].toFixed(2)} ms (min ${sorted[0].toFixed(2)}, max ${sorted[14].toFixed(2)})`);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
  });
}

// INV-40 (performance, logged only): in a code block of 5,000 lines, one key
// that adds a letter (the editor is measured as it is) and one Backspace
// (measured short), from the input to the layout read after it. Laying out
// the editor's 200 KB is most of it, before the iPad fix (2026-10-31) too.
const LONG_CODE = ["Intro.", "", "```", ...Array.from({ length: 5000 }, (_, n) => `value_${n} = compute(${n}) + offset; // line ${n}`), "```", "", "Outro."].join("\n");

test("INV-40 (performance): a letter and a Backspace in a code block of 5,000 lines (logged)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "measured in Chrome (INV-51)");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(180000);
  await page.goto("/");
  await renderMarkdown(page, LONG_CODE);
  await settled(page);
  await scrollTextTo(page, "line 2500", 300);
  const target = await renderedChar(page, "line 2500");
  await page.mouse.dblclick(target.x, target.y);
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toBeFocused();
  const times = await page.evaluate(async () => {
    const ta = document.querySelector("#preview textarea.md-block-editor");
    const added = [];
    const taken = [];
    for (let k = 0; k < 30; k++) {
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const t0 = performance.now();
      if (k % 2 === 0) ta.setRangeText("x", ta.selectionStart, ta.selectionStart, "end");
      else ta.setRangeText("", ta.selectionStart - 1, ta.selectionStart, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#preview").getBoundingClientRect();
      (k % 2 === 0 ? added : taken).push(performance.now() - t0);
    }
    const median = (list) => [...list].sort((a, b) => a - b)[7];
    return { added: median(added), taken: median(taken) };
  });
  console.log(`5,000 lines, one key: a letter ${times.added.toFixed(2)} ms, a Backspace ${times.taken.toFixed(2)} ms (medians of 15)`);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
});
