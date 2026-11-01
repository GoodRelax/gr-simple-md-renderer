import { test, expect, dropFile, renderMarkdown, settled } from "./fixtures.js";

// The top bar on an iPad held upright (820 x 1180; the page has no viewport
// meta, so it is laid out 980 px wide and shown scaled). The owner's iPad
// (beta2, 2026-10-31): with a .json file in the code view, the file
// information next to the title shrank to about 40 px, its words broke one
// per line, and the bar, its buttons with it, grew to a quarter of the
// screen. Here the buttons are narrower than on the iPad (other fonts), so
// the second case widens them until the file information is as narrow.

test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });

const JSON_TEXT = JSON.stringify({ name: "ipad-check", version: 1, settings: { theme: "light", editor: { fontSize: 14, tabSize: 2, wrap: false } } }, null, 2) + "\n";

/** The top bar's height, and the file information's width, rows and lines. */
function topBar(page) {
  return page.evaluate(() => {
    const info = document.getElementById("fileInfo");
    const style = getComputedStyle(info);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const content = info.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return {
      bar: document.getElementById("topbar").getBoundingClientRect().height,
      infoWidth: info.getBoundingClientRect().width,
      rows: Math.round(content / lineHeight),
      lines: info.textContent.split("\n").length,
    };
  });
}

for (const c of [
  { name: "as laid out here", buttonPadding: null },
  { name: "with buttons as wide as on the iPad (the file information under 80 px)", buttonPadding: "2px 18px" },
]) {
  test(`a .json file in the code view, ${c.name}: the top bar keeps its height, and the file information one row per line (INV-89, FS-04)`, async ({ page, browserName }) => {
    await page.goto("/");
    if (c.buttonPadding) await page.addStyleTag({ content: `#controls button { padding: ${c.buttonPadding}; }` });
    await renderMarkdown(page, "# Markdown first\n\nText.\n");
    await settled(page);
    const markdown = await topBar(page);
    await dropFile(page, { name: "ipad-check.json", text: JSON_TEXT });
    await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
    await expect(page.locator("#fileInfo")).toBeVisible();
    const code = await topBar(page);
    console.log(`${browserName} ${c.name}: markdown bar ${markdown.bar}, code ${JSON.stringify(code)}`);
    if (c.buttonPadding) expect(code.infoWidth).toBeLessThan(80);
    // the two lines of the file information stay two rows
    expect(code.rows).toBe(code.lines);
    // the bar is as tall as in the Markdown view
    expect(Math.abs(code.bar - markdown.bar)).toBeLessThanOrEqual(1);
  });
}
