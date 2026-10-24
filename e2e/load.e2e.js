import { test, expect, renderMarkdown } from "./fixtures.js";

const RICH_MARKDOWN = [
  "# E2E heading",
  "",
  "Inline math $x^2 + y^2$ and a table:",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
].join("\n");

test("page loads with its CSP and no errors", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bview-initial\b/);

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("default-src 'none'");
});

test("rendering Markdown, math, code and Mermaid raises no errors", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, RICH_MARKDOWN);

  const preview = page.locator("#preview");
  await expect(preview.locator("h1")).toHaveText("E2E heading");
  await expect(preview.locator(".katex").first()).toBeVisible();
  await expect(preview.locator("table")).toBeVisible();
  await expect(preview.locator("code.hljs, code[class*='language-js']").first()).toBeVisible();
  await expect(preview.locator(".mermaid svg").first()).toBeVisible();
});

// Leading blank lines are read line by line (5.13 rule 1): 41 of them took
// hours in the wrapper check before (each line doubled the time).
// Known limit (review L3): only Chromium fails this (and the drop test in
// fileDrop.e2e.js) without the fix. WebKit's engine gives up after about
// 1 s and answers "no match", so it passes even without the fix; the slow
// case there is caught by AT-WRAP-20 and by Chromium. No time check is
// added: it would depend on the machine.
test("5.13 rule 1: a document with 41 leading blank lines renders", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, "\n".repeat(41) + "## Section 0\n\nParagraph 0 with **bold** text.\n");
  await expect(page.locator("#preview h2")).toHaveText("Section 0");
});
