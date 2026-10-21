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
  await expect(page.locator("#editBtn")).toBeDisabled();
});
