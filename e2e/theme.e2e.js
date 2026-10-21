import { test, expect, renderMarkdown, dropFile } from "./fixtures.js";

// Effective theme colors in a real browser (spec 5.8.1, PRT-X16): the
// code is colored by style.css with Primer prettylights (no highlight.js
// theme CSS is bundled).

const MARKDOWN = [
  "Text with a [link](#x) and `inline code`.",
  "",
  "> quoted",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  // class="nohighlight": highlight.js leaves it alone, so only style.css decides its ground.
  "<pre><b><code class=\"nohighlight\">nested</code></b></pre>",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
].join("\n");

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** Computed style values of the first element matching each selector. */
async function colors(page) {
  return page.evaluate(() => {
    const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo);
    return {
      body: cs("body").backgroundColor,
      topbar: cs("#topbar").backgroundColor,
      editor: cs("#editor").backgroundColor,
      text: cs("#preview p").color,
      link: cs("#preview a").color,
      inlineCode: cs("#preview p code").backgroundColor,
      inlineCodeRadius: cs("#preview p code").borderTopLeftRadius,
      pre: cs("#preview pre").backgroundColor,
      preCode: cs("#preview pre code").backgroundColor,
      prePadding: cs("#preview pre").paddingLeft,
      preCodePadding: cs("#preview pre code").paddingLeft,
      preText: cs("#preview pre code").color,
      nestedPreCode: cs("#preview pre b code.nohighlight").backgroundColor,
      nestedPreCodePadding: cs("#preview pre b code.nohighlight").paddingLeft,
      nestedPreCodeRadius: cs("#preview pre b code.nohighlight").borderTopLeftRadius,
      keyword: cs("#preview pre .hljs-keyword").color,
      quote: cs("#preview blockquote").color,
      quoteLine: cs("#preview blockquote").borderLeftColor,
      tableLine: cs("#preview td").borderTopColor,
      mermaid: cs("#preview .mermaid").backgroundColor,
      mermaidSvg: cs("#preview .mermaid svg").backgroundColor,
    };
  });
}

test("light: GitHub light colors for the preview; top bar and editor unchanged", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, MARKDOWN);
  await expect(page.locator("#preview .mermaid svg")).toBeVisible();

  const c = await colors(page);
  expect(c.topbar).toBe("rgb(240, 240, 240)");
  expect(c.editor).toBe("rgb(255, 248, 240)");
  expect(c.text).toBe("rgb(31, 35, 40)");
  expect(c.link).toBe("rgb(9, 105, 218)");
  expect(c.inlineCode).toMatch(/^rgba\(129, 139, 152, 0\.12\d*\)$/);
  expect(c.inlineCodeRadius).toBe("6px");
  expect(c.pre).toBe("rgb(246, 248, 250)");
  expect(c.preCode).toBe(TRANSPARENT);
  expect(c.prePadding).toBe("16px");
  expect(c.preCodePadding).toBe("0px");
  expect(c.nestedPreCode).toBe(TRANSPARENT);
  expect(c.nestedPreCodePadding).toBe("0px");
  expect(c.nestedPreCodeRadius).toBe("0px");
  expect(c.keyword).toBe("rgb(207, 34, 46)"); // prettylights keyword #cf222e
  expect(c.preText).toBe("rgb(31, 35, 40)");
  expect(c.quote).toBe("rgb(89, 99, 110)");
  expect(c.quoteLine).toBe("rgb(209, 217, 224)");
  expect(c.tableLine).toBe("rgb(209, 217, 224)");
  expect(c.mermaid).toBe(TRANSPARENT);
  expect(c.mermaidSvg).toBe(TRANSPARENT);
});

test("dark: GitHub dark colors for the page and the preview; editor ground unchanged", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, MARKDOWN);
  await page.keyboard.press("d");
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await expect(page.locator("#preview .mermaid svg")).toBeVisible();

  const c = await colors(page);
  expect(c.body).toBe("rgb(13, 17, 23)");
  expect(c.topbar).toBe("rgb(21, 27, 35)");
  expect(c.editor).toBe("rgb(45, 37, 32)");
  expect(c.text).toBe("rgb(240, 246, 252)");
  expect(c.link).toBe("rgb(68, 147, 248)");
  expect(c.inlineCode).toBe("rgba(101, 108, 118, 0.2)");
  expect(c.pre).toBe("rgb(21, 27, 35)");
  expect(c.preCode).toBe(TRANSPARENT);
  expect(c.prePadding).toBe("16px");
  expect(c.preCodePadding).toBe("0px");
  expect(c.nestedPreCode).toBe(TRANSPARENT);
  expect(c.nestedPreCodePadding).toBe("0px");
  expect(c.nestedPreCodeRadius).toBe("0px");
  expect(c.keyword).toBe("rgb(255, 123, 114)"); // prettylights keyword #ff7b72
  expect(c.preText).toBe("rgb(240, 246, 252)");
  expect(c.quote).toBe("rgb(145, 152, 161)");
  expect(c.quoteLine).toBe("rgb(61, 68, 77)");
  expect(c.tableLine).toBe("rgb(61, 68, 77)");
  expect(c.mermaid).toBe(TRANSPARENT);
  expect(c.mermaidSvg).toBe(TRANSPARENT);
});

test("code view: dark and light colors, line numbers and highlighting", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, { name: "sample.py", text: "def f():\n    return 1\n" });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);

  const read = () =>
    page.evaluate(() => {
      const body = document.querySelector("#codeViewBody");
      const line = document.querySelector(".code-line");
      return {
        ground: getComputedStyle(body).backgroundColor,
        text: getComputedStyle(body).color,
        number: getComputedStyle(line, "::before").color,
        keyword: getComputedStyle(document.querySelector("#codeViewBody .hljs-keyword")).color,
      };
    });

  expect(await read()).toEqual({
    ground: "rgb(13, 17, 23)",
    text: "rgb(240, 246, 252)",
    number: "rgb(145, 152, 161)",
    keyword: "rgb(255, 123, 114)",
  });

  await page.keyboard.press("l");
  await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
  expect(await read()).toEqual({
    ground: "rgb(255, 255, 255)",
    text: "rgb(31, 35, 40)",
    number: "rgb(89, 99, 110)",
    keyword: "rgb(207, 34, 46)",
  });
});

/**
 * Render `markdown` in dark, enter edit mode and open the first paragraph.
 * @returns the focused block editor and a reader of its ground, border and ring
 */
async function openDarkEditor(page, markdown) {
  await page.goto("/");
  await renderMarkdown(page, markdown);
  await page.keyboard.press("d");
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await page.locator("#editBtn").click();
  await page.locator("#preview p").first().click();
  const editor = page.locator("#preview textarea.md-block-editor");
  await expect(editor).toBeFocused();
  const look = () =>
    editor.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { ground: cs.backgroundColor, border: cs.borderTopStyle, outline: cs.outlineStyle };
    });
  return { editor, look };
}

test("print in dark: the focused block editor shows no focus ring (INV-53)", async ({ page }) => {
  // A short paragraph has the marks layer, so its editor ground is transparent
  // on screen already; this test checks the focus ring.
  const { look } = await openDarkEditor(page, MARKDOWN);
  expect((await look()).outline).toBe("solid"); // on screen: the focus ring
  await page.emulateMedia({ media: "print" });
  expect(await look()).toEqual({ ground: TRANSPARENT, border: "none", outline: "none" });
  await page.emulateMedia({ media: null });
});

test("print in dark: a block editor without the marks layer shows no ground (INV-53)", async ({ page }) => {
  // Over CONFIG.edit.invisibleMarkMaxChars (50,000) there is no marks layer,
  // so the editor carries the dark ground #010409 itself on screen.
  const { editor, look } = await openDarkEditor(page, "a".repeat(50001));
  await expect(editor).not.toHaveClass(/\bmd-block-editor-overlaid\b/);
  expect((await look()).ground).toBe("rgb(1, 4, 9)");
  await page.emulateMedia({ media: "print" });
  expect(await look()).toEqual({ ground: TRANSPARENT, border: "none", outline: "none" });
  await page.emulateMedia({ media: null });
});

test("print in dark: the document is printed in the light colors (owner ruling 2026-10-22)", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, MARKDOWN);
  await page.keyboard.press("d");
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await expect(page.locator("#preview .mermaid svg")).toBeVisible();
  expect((await colors(page)).text).toBe("rgb(240, 246, 252)"); // on screen: dark

  await page.emulateMedia({ media: "print" });
  const c = await colors(page);
  expect(c.body).toBe(TRANSPARENT);
  expect(c.text).toBe("rgb(31, 35, 40)");
  expect(c.link).toBe("rgb(9, 105, 218)");
  expect(c.inlineCode).toMatch(/^rgba\(129, 139, 152, 0\.12\d*\)$/);
  expect(c.pre).toBe("rgb(246, 248, 250)");
  expect(c.preText).toBe("rgb(31, 35, 40)");
  expect(c.keyword).toBe("rgb(207, 34, 46)");
  expect(c.quote).toBe("rgb(89, 99, 110)");
  expect(c.tableLine).toBe("rgb(209, 217, 224)");
  await page.emulateMedia({ media: null });
});

test("print in dark: the code view is printed in the light colors", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, { name: "sample.py", text: "def f():\n    return 1\n" });
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ media: "print" });
  const look = await page.evaluate(() => {
    const body = document.querySelector("#codeViewBody");
    return {
      ground: getComputedStyle(body).backgroundColor,
      text: getComputedStyle(body).color,
      number: getComputedStyle(document.querySelector(".code-line"), "::before").color,
      keyword: getComputedStyle(document.querySelector("#codeViewBody .hljs-keyword")).color,
    };
  });
  expect(look).toEqual({
    ground: "rgb(255, 255, 255)",
    text: "rgb(31, 35, 40)",
    number: "rgb(89, 99, 110)",
    keyword: "rgb(207, 34, 46)",
  });
  await page.emulateMedia({ media: null });
});

test("print: the key hint and toasts are not printed", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, MARKDOWN);
  // A toast as utils.showToast makes one (the element only; no app state).
  await page.evaluate(() => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "toast";
    document.getElementById("toastContainer").appendChild(toast);
  });
  const display = () =>
    page.evaluate(() => ["#keyHint", "#toastContainer"].map((sel) => getComputedStyle(document.querySelector(sel)).display));
  expect(await display()).toEqual(["block", "flex"]); // on screen, right after rendering
  await page.emulateMedia({ media: "print" });
  expect(await display()).toEqual(["none", "none"]);
  await page.emulateMedia({ media: null });
});

test("print: an invisible character mark loses its ground but keeps the character (INV-70)", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, MARKDOWN);
  await page.keyboard.press("d");
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await expect(page.locator("#preview .mermaid svg")).toBeVisible(); // the dark re-render is done
  // A mark as the renderer wraps a character in a cell (the element only).
  await page.evaluate(() => {
    const mark = document.createElement("span");
    mark.className = "grsmd-invisible";
    mark.id = "e2eMark";
    mark.textContent = "\u00a0";
    document.querySelector("#preview td").appendChild(mark);
  });
  const look = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("e2eMark"));
      return { ground: cs.backgroundColor, shadow: cs.boxShadow, display: cs.display };
    });
  expect((await look()).ground).toBe("rgba(187, 128, 9, 0.15)"); // on screen: #bb800926
  await page.emulateMedia({ media: "print" });
  expect(await look()).toEqual({ ground: TRANSPARENT, shadow: "none", display: "inline" });
  await page.emulateMedia({ media: null });
});
