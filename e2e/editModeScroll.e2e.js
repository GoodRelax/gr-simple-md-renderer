import { test, expect, renderMarkdown } from "./fixtures.js";

// Edit mode shows the hidden bands, the empty block and, above each table,
// the strip for its "Markdown" tab (5.1). Entering or leaving it must not
// move what the reader is looking at (PRT-X08): the element at the top of the
// preview stays where it was, within 1 px, in Chromium and WebKit. WebKit has
// no scroll anchoring: without RendererOrchestrator.keepReadingPosition the
// text moved by 329 px here when edit mode was left (2026-10-22). Blocks with
// no box while browsing (comments, reference definitions) once made the
// search pick a block far below the top (-1074 px in both browsers).

// Long documents toggled again and again: 12 to 18 s each without load. The
// tests in this file get three times the default time (test.slow), so that a
// loaded machine (another worktree's e2e, GRSMD_E2E_PORT) does not fail them.
test.beforeEach(() => test.slow());

function sections(count, body) {
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(`## Section ${i}`, "", ...body(i), "");
  return parts.join("\n");
}

const CASES = [
  {
    name: "tables",
    markdown: sections(30, (i) => [`Paragraph ${i} before the table.`, "", "| A | B |", "| --- | --- |", `| a${i} | b${i} |`]),
    target: "Paragraph 24 before the table.",
  },
  {
    name: "a comment after each paragraph",
    markdown: sections(60, (i) => [`Paragraph ${i} with a note.`, "", `<!-- note ${i} -->`]),
    target: "Paragraph 7 with a note.",
  },
  {
    name: "a comment and a table after each paragraph",
    markdown: sections(60, (i) => [`Paragraph ${i} with a note.`, "", `<!-- note ${i} -->`, "", "| A | B |", "| --- | --- |", `| a${i} | b${i} |`]),
    target: "Paragraph 7 with a note.",
  },
  {
    name: "reference definitions",
    markdown: sections(60, (i) => [`Paragraph ${i} with [a link][r${i}].`, "", `[r${i}]: https://example.com/${i}`, "", `<!-- note ${i} -->`]),
    target: "Paragraph 9 with a link.",
  },
  {
    name: "blocks of height 0",
    markdown: sections(60, (i) => [`Paragraph ${i} after an anchor.`, "", `<a id="anchor-${i}"></a>`, "", "| A | B |", "| --- | --- |", `| a${i} | b${i} |`]),
    target: "Paragraph 12 after an anchor.",
  },
  {
    name: "the top in the middle of a long code block",
    markdown: sections(10, (i) => [`Paragraph ${i}.`, "", "<!-- note -->", "", "```", ...Array.from({ length: 200 }, (_, n) => `code ${i}.${n}`), "```", "", "| A | B |", "| --- | --- |", "| a | b |"]),
    target: "code 6.100",
    code: true,
  },
];

// long enough to scroll on a phone, where the zoomed-out page shows about 2,100 px
const TABLES_LONG = {
  name: "tables (60)",
  markdown: sections(60, (i) => [`Paragraph ${i} before the table.`, "", "| A | B |", "| --- | --- |", `| a${i} | b${i} |`]),
  target: "Paragraph 30 before the table.",
};

// comments, tables, reference definitions and code blocks, one after another
const MIXED = {
  name: "mixed",
  markdown: sections(60, (i) => [`Paragraph ${i} with a note.`, "", `<!-- note ${i} -->`, "", "| A | B |", "| --- | --- |", `| a${i} | b${i} |`, "", `[r${i}]: https://example.com/${i}`, "", "```", `code ${i}`, "```"]),
  target: "Paragraph 30 with a note.",
};

/** The top on screen of the paragraph with the text, or of the code block's line. */
async function topOf(page, item) {
  return page.evaluate(({ target, code }) => {
    const preview = document.querySelector("#preview");
    if (!code) return [...preview.querySelectorAll("p")].find((p) => p.textContent === target).getBoundingClientRect().top;
    const pre = [...preview.querySelectorAll("pre")].find((el) => el.textContent.includes(target + "\n"));
    // the line's place: the pre's top plus the line's offset in it, which edit mode does not change
    return pre.getBoundingClientRect().top;
  }, item);
}

async function nextFrame(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
}

const ROUND_TRIPS = 5;

/**
 * Go in and out of edit mode ROUND_TRIPS times; the item's top after each
 * toggle, to be compared with where it was before the first (the reading
 * position must not move, nor add up, however often edit mode is toggled).
 */
async function toggleEditMode(page, item) {
  const tops = [];
  for (let i = 0; i < ROUND_TRIPS; i++) {
    await page.locator("#editBtn").click();
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    await nextFrame(page);
    tops.push(await topOf(page, item));
    await page.locator("#editBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
    await nextFrame(page);
    tops.push(await topOf(page, item));
  }
  return tops;
}

/**
 * Half the step the document scrolls by, in CSS px: the nearest any scroll
 * can put the reading position. Without a viewport meta (spec: none is
 * added) a phone lays the page out wide and shows it zoomed out; WebKit then
 * scrolls by steps of one screen pixel (1 / the zoom: about 2.5 px here,
 * zoom 0.398, whatever the device pixel ratio; devicePixelRatio reads 0.796
 * with two device pixels and 1.194 with three, the zoom held).
 * Chromium scrolls by 1 px. Measured by scrolling to whole-number requests
 * and reading where the page lands; the page is left where it was.
 */
async function halfScrollStep(page) {
  return page.evaluate(() => {
    const start = window.scrollY;
    const probe = document.querySelector("#preview");
    const landed = new Set();
    for (let y = 1000; y <= 1012; y++) {
      window.scrollTo(0, y);
      landed.add(Math.round(probe.getBoundingClientRect().top * 1000) / 1000);
    }
    window.scrollTo(0, start);
    const tops = [...landed].sort((p, q) => p - q);
    let step = Infinity;
    for (let i = 1; i < tops.length; i++) step = Math.min(step, tops[i] - tops[i - 1]);
    return step / 2;
  });
}

/** halfScrollStep, which must have measured a step (not Infinity) of at most 4 px. */
async function measuredTolerance(page) {
  const tolerance = await halfScrollStep(page);
  expect(tolerance).toBeGreaterThan(0);
  expect(tolerance).toBeLessThanOrEqual(2);
  return tolerance;
}

for (const item of CASES) {
  test(`entering and leaving edit mode keeps the reading position: ${item.name}`, async ({ page, browserName }) => {
    await page.goto("/");
    await renderMarkdown(page, item.markdown);
    // the full render restores its scroll position when the DOM is stable: wait for it
    await page.waitForTimeout(1000);
    await page.evaluate(({ target, code }) => {
      const preview = document.querySelector("#preview");
      const top = preview.getBoundingClientRect().top;
      if (code) {
        // the top of what is shown falls on the line, deep inside the block
        const pre = [...preview.querySelectorAll("pre")].find((el) => el.textContent.includes(target + "\n"));
        const lines = pre.textContent.split("\n");
        const offset = (lines.indexOf(target) / lines.length) * pre.getBoundingClientRect().height;
        preview.scrollTop += pre.getBoundingClientRect().top + offset - top;
      } else {
        const p = [...preview.querySelectorAll("p")].find((el) => el.textContent === target);
        preview.scrollTop += p.getBoundingClientRect().top - top - 40;
      }
    }, item);
    const before = await topOf(page, item);
    if (item.code) {
      const previewTop = await page.evaluate(() => document.querySelector("#preview").getBoundingClientRect().top);
      expect(before).toBeLessThan(previewTop - 500);
    }

    const tops = await toggleEditMode(page, item);
    console.log(`${browserName} ${item.name}: before ${before}, then ${tops.join(", ")}`);
    for (const top of tops) expect(Math.abs(top - before)).toBeLessThanOrEqual(1);
  });
}

/** The top on screen of the table whose text has the word, and of the heading. */
async function tableAndHeading(page, word, heading) {
  return page.evaluate(({ word, heading }) => {
    const preview = document.querySelector("#preview");
    const table = [...preview.querySelectorAll("table")].find((t) => t.textContent.includes(word));
    const h = [...preview.querySelectorAll("h2")].find((el) => el.textContent === heading);
    return { table: table.getBoundingClientRect().top, heading: h.getBoundingClientRect().top };
  }, { word, heading });
}

// The commit made while leaving edit mode is rendered later and restores its
// block to where it was measured, in edit mode. A commit that only changes the
// block keeps its DOM in place; one that adds a block restores the anchor.
for (const variant of [
  { name: "a cell's text", edit: (raw) => raw.replace("a20", "x20"), headingStays: true },
  { name: "a paragraph added after the table", edit: (raw) => raw.replace("a20", "x20") + "\n\nAdded paragraph.", headingStays: false },
]) {
  test(`leaving edit mode with a table's source changed (${variant.name}): the text stays after the render too (INV-46)`, async ({ page, browserName }) => {
    await page.goto("/");
    await renderMarkdown(page, CASES[0].markdown);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const preview = document.querySelector("#preview");
      const table = [...preview.querySelectorAll("table")].find((t) => t.textContent.includes("a20"));
      preview.scrollTop += table.getBoundingClientRect().top - preview.getBoundingClientRect().top - 40;
    });
    const before = await tableAndHeading(page, "a20", "Section 21");

    await page.locator("#editBtn").click();
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    await page.locator("#preview .md-block-table", { hasText: "a20" }).locator(".grsmd-table-tab").click();
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toHaveValue(/a20/);
    await editor.fill(variant.edit(await editor.inputValue()));
    await page.locator("#editBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
    await expect(page.locator("#preview table", { hasText: "x20" })).toHaveCount(1);
    // the partial render restores its anchor when the DOM is stable: wait for it
    await page.waitForTimeout(1000);
    await nextFrame(page);
    const after = await tableAndHeading(page, "x20", "Section 21");

    console.log(`${browserName} commit on leaving (${variant.name}): table ${before.table} -> ${after.table}, heading ${before.heading} -> ${after.heading}`);
    expect(Math.abs(after.table - before.table)).toBeLessThanOrEqual(1);
    if (variant.headingStays) expect(Math.abs(after.heading - before.heading)).toBeLessThanOrEqual(1);
  });
}

test("leaving edit mode with a block lower down changed: the bands between go, and the render does not move the text back (INV-46)", async ({ page, browserName }) => {
  await page.goto("/");
  await renderMarkdown(page, CASES[1].markdown);
  await page.waitForTimeout(1000);
  const item = { target: "Paragraph 7 with a note." };
  await page.evaluate(({ target }) => {
    const preview = document.querySelector("#preview");
    const p = [...preview.querySelectorAll("p")].find((el) => el.textContent === target);
    preview.scrollTop += p.getBoundingClientRect().top - preview.getBoundingClientRect().top - 40;
  }, item);
  const before = await topOf(page, item);

  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  // two comment bands lie between paragraph 7 and paragraph 9
  await page.locator("#preview p", { hasText: "Paragraph 9 with a note." }).click();
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toHaveValue(/Paragraph 9/);
  await editor.fill("Paragraph 9 with a note.\n\nAdded paragraph.");
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
  await expect(page.locator("#preview p", { hasText: "Added paragraph." })).toHaveCount(1);
  await page.waitForTimeout(1000);
  await nextFrame(page);
  const after = await topOf(page, item);

  console.log(`${browserName} commit lower down on leaving: before ${before}, after ${after}`);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

// A comment's band shows only in edit mode: committed as a comment it has no
// box afterwards; committed as text it becomes a paragraph where the band was.
for (const variant of [
  { name: "still a comment", text: "<!-- note 8 changed -->", shows: null },
  { name: "now a paragraph", text: "Text that was a note.", shows: "Text that was a note." },
]) {
  test(`leaving edit mode with a comment's band changed (${variant.name}): the text stays (INV-46)`, async ({ page, browserName }) => {
    await page.goto("/");
    await renderMarkdown(page, CASES[1].markdown);
    await page.waitForTimeout(1000);
    const item = { target: "Paragraph 7 with a note." };
    await page.evaluate(({ target }) => {
      const preview = document.querySelector("#preview");
      const p = [...preview.querySelectorAll("p")].find((el) => el.textContent === target);
      preview.scrollTop += p.getBoundingClientRect().top - preview.getBoundingClientRect().top - 40;
    }, item);
    const before = await topOf(page, item);

    await page.locator("#editBtn").click();
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    // the band of the comment after paragraph 8
    await page.evaluate(() => {
      const preview = document.querySelector("#preview");
      const p = [...preview.querySelectorAll("p")].find((el) => el.textContent === "Paragraph 8 with a note.");
      p.closest(".md-block").nextElementSibling.setAttribute("data-e2e-band", "");
    });
    await page.locator("#preview [data-e2e-band]").click();
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toHaveValue(/note 8/);
    await editor.fill(variant.text);
    await page.locator("#editBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
    if (variant.shows) await expect(page.locator("#preview p", { hasText: variant.shows })).toHaveCount(1);
    await page.waitForTimeout(1000);
    await nextFrame(page);
    const after = await topOf(page, item);

    console.log(`${browserName} band ${variant.name} on leaving: before ${before}, after ${after}`);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
}

test.describe("touch: the document scrolls under the sticky top bar", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  for (const doc of [TABLES_LONG, CASES[1], CASES[2], MIXED]) {
    test(`in and out of edit mode ${ROUND_TRIPS} times keeps the reading position below the top bar: ${doc.name}`, async ({ page, browserName }) => {
      await page.goto("/");
      expect(await page.evaluate(() => window.matchMedia("(any-pointer: coarse)").matches)).toBe(true);
      await renderMarkdown(page, doc.markdown);
      await page.waitForTimeout(1000);
      // the paragraph 40 px below the bar; the one before it ends under the bar
      const item = { target: doc.target };
      await page.evaluate(({ target }) => {
        const bar = document.querySelector("#topbar").getBoundingClientRect().bottom;
        const p = [...document.querySelectorAll("#preview p")].find((el) => el.textContent === target);
        window.scrollTo(0, window.scrollY + p.getBoundingClientRect().top - bar - 40);
      }, item);
      const before = await topOf(page, item);
      const tops = await toggleEditMode(page, item);
      const tolerance = await measuredTolerance(page);
      console.log(`${browserName} touch ${doc.name} (half a scroll step ${tolerance}): before ${before}, then ${tops.join(", ")}`);
      for (const top of tops) expect(Math.abs(top - before)).toBeLessThanOrEqual(tolerance);
    });
  }

  test("leaving edit mode with a block lower down changed keeps the reading position below the top bar", async ({ page, browserName }) => {
    await page.goto("/");
    await renderMarkdown(page, CASES[1].markdown);
    await page.waitForTimeout(1000);
    const item = { target: "Paragraph 30 with a note." };
    await page.evaluate(({ target }) => {
      const bar = document.querySelector("#topbar").getBoundingClientRect().bottom;
      const p = [...document.querySelectorAll("#preview p")].find((el) => el.textContent === target);
      window.scrollTo(0, window.scrollY + p.getBoundingClientRect().top - bar - 40);
    }, item);
    const before = await topOf(page, item);

    await page.locator("#editBtn").click();
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    await nextFrame(page);
    const inEdit = await topOf(page, item);
    await page.locator("#preview p", { hasText: "Paragraph 32 with a note." }).click();
    const editor = page.locator("#preview textarea.md-block-editor");
    await expect(editor).toHaveValue(/Paragraph 32/);
    await editor.fill("Paragraph 32 with a note.\n\nAdded paragraph.");
    await page.locator("#editBtn").click();
    await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
    await expect(page.locator("#preview p", { hasText: "Added paragraph." })).toHaveCount(1);
    await page.waitForTimeout(1000);
    await nextFrame(page);
    const after = await topOf(page, item);

    const tolerance = await measuredTolerance(page);
    console.log(`${browserName} touch commit on leaving (half a scroll step ${tolerance}): before ${before}, in edit mode ${inEdit}, after ${after}`);
    expect(Math.abs(inEdit - before)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(tolerance);
  });
});

test("an empty document: edit mode shows the empty block, and nothing scrolls or fails", async ({ page }) => {
  await page.goto("/");
  // the only paragraph committed empty: no block is left, and the empty
  // block stands for the document (INV-49)
  await renderMarkdown(page, "Only paragraph.");
  await page.waitForTimeout(500);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  await page.locator("#preview p", { hasText: "Only paragraph." }).click();
  await page.locator("#preview textarea.md-block-editor").fill("");
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
  await expect(page.locator("#preview .md-block-empty")).toHaveCount(1);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  await expect(page.locator("#preview .md-block-empty")).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("#preview").scrollTop)).toBe(0);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
  await expect(page.locator("#preview .md-block-empty")).toBeHidden();
  expect(await page.evaluate(() => document.querySelector("#preview").scrollTop)).toBe(0);
});
