import { test, expect, renderMarkdown } from "./fixtures.js";

// INV-69 in real browsers (PRT-X18): selected text and a URL pasted with
// Ctrl+V become a link (no permission; the browser's own Undo takes it
// back), in the block editor and in a table cell; the palette's Paste link
// reads the clipboard (a stand-in for navigator.clipboard here, so that no
// permission prompt is needed) and nothing is fetched (the fixtures fail a
// test on any request that leaves the local server).

const DOC = ["# Links", "", "See the example here.", "", "| Name | Note |", "| --- | --- |", "| Yamada | x |", ""].join("\n");

async function openEditMode(page) {
  await page.goto("/");
  await renderMarkdown(page, DOC);
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSave")).toBeVisible();
}

/** Dispatch a paste on the focused element, as the browser does for Ctrl+V. */
async function pasteText(page, plain, html = "") {
  return page.evaluate(
    ({ plain, html }) => {
      const data = new DataTransfer();
      data.setData("text/plain", plain);
      if (html) data.setData("text/html", html);
      const e = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", { value: data });
      document.activeElement.dispatchEvent(e);
      return e.defaultPrevented;
    },
    { plain, html },
  );
}

const paragraph = (page) => page.locator("#preview .md-block p", { hasText: "See the example" });
const editor = (page) => page.locator("#preview textarea.md-block-editor");
const cell = (page, r, c) => page.locator("#preview table").first().locator("tr").nth(r).locator("th, td").nth(c);

test("Ctrl+V on selected text with a URL makes a link; the browser's Undo takes it back", async ({ page }) => {
  await openEditMode(page);
  await paragraph(page).click();
  await expect(editor(page)).toBeFocused();
  await editor(page).evaluate((ta) => {
    const at = ta.value.indexOf("example");
    ta.setSelectionRange(at, at + "example".length);
  });
  expect(await pasteText(page, "https://example.com/a(b", '<img src="https://evil.example/x.png">')).toBe(true);
  await expect(editor(page)).toHaveValue("See the [example](<https://example.com/a(b>) here.");
  // not a URL in the clipboard: the browser's own paste (INV-69 (ii))
  await editor(page).evaluate((ta) => ta.setSelectionRange(0, 3));
  expect(await pasteText(page, "plain")).toBe(false);
  // the selected text is a URL itself: the browser's own paste too (ruling Q6)
  await editor(page).evaluate((ta) => {
    const at = ta.value.indexOf("https://");
    ta.setSelectionRange(at, ta.value.indexOf(">)"));
  });
  expect(await pasteText(page, "https://other.example/")).toBe(false);
  // a control character in the clipboard's URL: not a URL (INV-69), the browser's own paste
  await editor(page).evaluate((ta) => ta.setSelectionRange(0, 3));
  expect(await pasteText(page, "https://x.example/\u0007a")).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toHaveValue("See the example here.");
  await page.locator("#preview h1").click(); // commit
  await expect(page.locator("#editor")).toHaveValue(/See the example here\./);
});

test("in a cell: the link is drawn in the cell and written with \\| for a pipe in the URL", async ({ page }) => {
  await openEditMode(page);
  await cell(page, 1, 0).click();
  await expect(cell(page, 1, 0)).toHaveClass(/grsmd-cell-editing/);
  await cell(page, 1, 0).evaluate((td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  expect(await pasteText(page, "https://x.example/p|q")).toBe(true);
  await expect(cell(page, 1, 0).locator("a")).toHaveText("Yamada");
  await page.keyboard.press("Tab");
  await expect(page.locator("#editor")).toHaveValue(/\| \[Yamada\]\(https:\/\/x\.example\/p\\\|q\) \| x +\|/);
  await expect(page.locator("#preview table tr").nth(1).locator("td")).toHaveCount(2);
});

test("the Paste link button reads the clipboard when pressed; its HTML gives the link text and loads nothing", async ({ page }) => {
  await page.addInitScript(() => {
    const types = {
      "text/plain": "https://example.com/",
      "text/html": '<img src="https://evil.example/x.png"><a href="https://example.com/">Example site</a>',
    };
    window.__e2eClipboardReads = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: async () => {
          window.__e2eClipboardReads++;
          return [{ types: Object.keys(types), getType: async (t) => new Blob([types[t]], { type: t }) }];
        },
      },
    });
  });
  await openEditMode(page);
  await paragraph(page).click();
  await editor(page).evaluate((ta) => ta.setSelectionRange(0, 0));
  await page.locator("#paletteFormat").click();
  await page.locator('button[aria-label="Paste link from clipboard"]').click();
  await expect(editor(page)).toHaveValue("[Example site](https://example.com/)See the example here.");
  expect(await page.evaluate(() => window.__e2eClipboardReads)).toBe(1);
  expect(await editor(page).evaluate((ta) => ta.value.slice(ta.selectionStart, ta.selectionEnd))).toBe("Example site");
  await page.locator("#paletteFormat").click();
  await page.locator('button[aria-label="Remove link"]').click();
  await expect(editor(page)).toHaveValue("Example siteSee the example here.");
});
