import { test, expect, dropFile } from "./fixtures.js";

test("dropping a .md file shows the Markdown preview", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, {
    name: "dropped.md",
    text: "# Dropped heading\n\nSome *text*.\n",
    type: "text/markdown",
  });

  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  await expect(page.locator("#preview h1")).toHaveText("Dropped heading");
  await expect(page.locator("#preview em")).toHaveText("text");
});

test("dropping a non-.md text file shows the code view", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, {
    name: "script.js",
    text: "function hello() {\n  return 'world';\n}\n",
    type: "text/javascript",
  });

  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#fileInfo")).toContainText("script.js");
  await expect(page.locator("#preview")).toContainText("function hello()");
  await expect(page.locator("#editBtn")).toBeEnabled(); // SC-27: the code view is editable
});

// Without the fix only Chromium fails this (see the known limit in load.e2e.js).
test("5.13 rule 1: dropping a .md file with 41 leading blank lines shows the Markdown preview", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, {
    name: "blank-lines.md",
    text: "\n".repeat(41) + "# Dropped heading\n\nSome *text*.\n",
    type: "text/markdown",
  });

  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  await expect(page.locator("#preview h1")).toHaveText("Dropped heading");
});
