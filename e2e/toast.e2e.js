import { test, expect, renderMarkdown } from "./fixtures.js";

// Toasts wrap inside a narrow screen (owner ruling R11, spec 5.12): at
// 375 px no toast runs off either side, and a long file name with no spaces
// breaks onto more lines.

test.use({ viewport: { width: 375, height: 700 } });

const inScreen = (page) =>
  page.locator("#toastContainer .toast").evaluateAll((toasts) =>
    toasts.map((t) => {
      const r = t.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(t).lineHeight) || 16;
      return { left: r.left, right: r.right, lines: Math.round((t.clientHeight - 2 * parseFloat(getComputedStyle(t).paddingTop)) / lineHeight) };
    }),
  );

test("at 375 px a real toast and a long file name toast stay inside the screen and wrap", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, "```js\nconst a = 1;\n```\n");
  await page.locator("#editBtn").click();
  await page.locator("#preview > .md-block").first().click();
  await page.locator("#paletteTable").click(); // refused: the 42-character toast (INV-52)
  await expect(page.locator("#toastContainer")).toContainText("Can't insert here.");
  // A toast as utils.showToast makes one (the element only), with a file name
  // as long as a Saved: toast can carry.
  await page.evaluate(() => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = `Saved: ${"very-long-file-name-without-any-space-".repeat(3)}notes.md`;
    document.getElementById("toastContainer").appendChild(toast);
  });
  const boxes = await inScreen(page);
  expect(boxes).toHaveLength(2);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(375);
  }
  expect(boxes[1].lines).toBeGreaterThan(1); // the long name wraps
});
