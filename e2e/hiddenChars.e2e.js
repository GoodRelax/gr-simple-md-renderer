import { test, expect, dropFile } from "./fixtures.js";

// Hidden characters (INV-101, spec 5.21; owner rulings AQ6 (5), AQ10, AQ14)
// in a real browser: the toast at open, the framed mark drawn by CSS before
// each run (the label is generated content: copy does not take it), none in
// the code editor, and the marks in print.

const ZWSP = "\u200b";
const RLO = "\u202e";
const PDF = "\u202c";
const tags = (ascii) => String.fromCodePoint(...[...ascii].map((c) => 0xe0000 + c.charCodeAt(0)));
const ENGLAND = `\u{1F3F4}${tags("gbeng")}\u{E007F}`;
const FAMILY = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";

const MD = [
  "# Hidden",
  `A zero${ZWSP}width space.`,
  `Read ${tags("This sentence is hidden from you.")}this.`,
  `// x = 1; ${RLO}// tnemmoc${PDF}`,
  `Family ${FAMILY} and ${ENGLAND} stay.`,
  "",
].join("\n\n");

/**
 * Each mark's label as drawn (the generated content's text is not in the
 * DOM, so it is read from the attribute the CSS draws) and its width.
 * @param {import("@playwright/test").Locator} root
 */
async function drawnMarks(root) {
  return root.locator("span.grsmd-hidden-mark").evaluateAll((marks) =>
    marks.map((m) => ({
      label: m.getAttribute("data-label"),
      width: Math.round(m.getBoundingClientRect().width),
      before: getComputedStyle(m, "::before").display,
    })),
  );
}

test("AT-HID-07 INV-101 (3)(4)(5): a dropped .md shows one toast and a framed mark before each run; copy takes the text only", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, { name: "hidden.md", text: MD });
  await expect(page.locator("#preview h1")).toHaveText("Hidden");
  await expect(page.locator("#toastContainer .toast")).toHaveText(["Hidden characters in 4 places. They are marked in the view."]);
  const preview = page.locator("#preview");
  await expect(preview.locator("span.grsmd-hidden-mark")).toHaveCount(4);
  const marks = await drawnMarks(preview);
  expect(marks.map((m) => m.label)).toEqual(["ZWSP", "hidden: This sentence is hidden from you.", "RLO", "PDF"]);
  for (const m of marks) expect(m.width, m.label).toBeGreaterThan(20); // the label is drawn
  expect(marks.every((m) => m.before === "inline")).toBe(true);
  // the selection of a marked paragraph is its own text, characters kept, no label
  const copied = await page.locator("#preview p", { hasText: "zero" }).evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(copied).toBe(`A zero${ZWSP}width space.`);
});

/**
 * Keep the text of every toast shown from now on (a toast leaves after 3 s).
 * @param {import("@playwright/test").Page} page
 */
async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) window.__toasts.push(n.textContent);
    }).observe(document.getElementById("toastContainer"), { childList: true });
  });
}

test("AT-HID-09 / AT-HID-11 INV-101 (4)(7): the code view marks its runs; the code editor has none, and the view has them again after it", async ({ page }) => {
  await page.goto("/");
  await recordToasts(page);
  await dropFile(page, { name: "hidden.js", text: `const a = 1;${ZWSP}\n// x ${RLO}y${PDF}\n` });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#toastContainer .toast")).toHaveText(["Hidden characters in 3 places. They are marked in the view."]);
  const body = page.locator("#codeViewBody");
  await expect(body.locator("span.grsmd-hidden-mark")).toHaveCount(3);
  expect((await drawnMarks(body)).map((m) => m.label)).toEqual(["ZWSP", "RLO", "PDF"]);
  // the lines keep their height: each marked line is as tall as a plain one
  const heights = await body.locator(".code-line").evaluateAll((lines) => lines.map((l) => Math.round(l.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);

  await page.locator("body").press("e");
  await expect(page.locator("#codeEditBody textarea")).toBeVisible();
  await expect(page.locator("#preview span.grsmd-hidden-mark")).toHaveCount(0);
  await page.locator("#codeEditBody textarea").press("Escape");
  await page.locator("body").press("e");
  await expect(page.locator("#codeViewBody span.grsmd-hidden-mark")).toHaveCount(3);
  const hiddenToasts = await page.evaluate(() => window.__toasts.filter((t) => t.startsWith("Hidden")));
  expect(hiddenToasts).toEqual(["Hidden characters in 3 places. They are marked in the view."]); // at open only
});

test("AT-HID-12 5.21.4: the marks are printed; an emoji and a flag have none", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, { name: "hidden.md", text: MD });
  await expect(page.locator("#preview span.grsmd-hidden-mark")).toHaveCount(4);
  const family = page.locator("#preview p", { hasText: "Family" });
  await expect(family.locator("span.grsmd-hidden-mark")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  const marks = await drawnMarks(page.locator("#preview"));
  expect(marks).toHaveLength(4);
  for (const m of marks) expect(m.width, m.label).toBeGreaterThan(20);
});
