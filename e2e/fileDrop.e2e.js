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

test("SC-27, INV-85: dropping a non-.md text file shows the code view; [Edit] is on", async ({ page }) => {
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

// The open checks of a dropped file (INV-18; owner rulings AQ1, AQ9, AQ11):
// only the listed file types open (FILE_TYPES, spec 5.4), and a text that
// holds U+0000 after decoding is refused before any question.

/**
 * Accept every alert and keep its message.
 * @param {import("@playwright/test").Page} page
 * @returns {string[]}
 */
function recordAlerts(page) {
  const messages = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.accept();
  });
  return messages;
}

/**
 * Drop a file built from bytes in the page (no text encoding on the way).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {number[]} bytes
 */
async function dropBytes(page, name, bytes) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { lastModified: Date.now() }));
      return dt;
    },
    { name, bytes },
  );
  await page.dispatchEvent("#preview", "dragover", { dataTransfer });
  await page.dispatchEvent("#preview", "drop", { dataTransfer });
}

const NOT_ALLOWED = "GRSMD can't open this type of file. It opens only known text file types.";
const BINARY = "GRSMD can only open text files.";

test("AT-FT-14 INV-18 (AQ1, D29): a file of no listed type (.png, .xyz) is refused with an alert; the start screen stays", async ({ page }) => {
  await page.goto("/");
  const alerts = recordAlerts(page);
  await dropFile(page, { name: "image.png", text: "not really an image", type: "image/png" });
  await expect.poll(() => alerts).toEqual([NOT_ALLOWED]);
  await dropFile(page, { name: "notes.xyz", text: "plain text\n" });
  await expect.poll(() => alerts).toEqual([NOT_ALLOWED, NOT_ALLOWED]);
  await expect(page.locator("body")).toHaveClass(/\bview-initial\b/);
  await expect(page.locator("#affordanceText")).toContainText("Get started:");
});

test("AT-FT-15 INV-18 (AQ9): .markdown opens in the Markdown preview; LICENSE opens in the code view", async ({ page }) => {
  await page.goto("/");
  const alerts = recordAlerts(page);
  await dropFile(page, { name: "notes.markdown", text: "# Notes heading\n" });
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  await expect(page.locator("#preview h1")).toHaveText("Notes heading");
  await dropFile(page, { name: "LICENSE", text: "MIT License\n\nCopyright (c) someone\n" });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#fileInfo")).toContainText("LICENSE");
  await expect(page.locator("#codeViewBody")).toContainText("MIT License");
  expect(alerts).toEqual([]);
});

test("AT-FT-16 INV-18 (AQ11): a text that holds U+0000 after decoding is refused before the open dialog (.py, Shift_JIS) and for a .md; nothing changes", async ({ page }) => {
  await page.goto("/");
  const alerts = recordAlerts(page);
  // not valid UTF-8, so the open dialog would ask; the Shift_JIS text holds U+0000
  await dropBytes(page, "old.py", [0x23, 0x20, 0x82, 0xa0, 0x00, 0x0d, 0x0a]);
  await expect.poll(() => alerts).toEqual([BINARY]);
  await expect(page.locator("#codeOpenModal")).toBeHidden();
  await dropFile(page, { name: "nul.md", text: "# Title\n\u0000\n" });
  await expect.poll(() => alerts).toEqual([BINARY, BINARY]);
  await expect(page.locator("body")).toHaveClass(/\bview-initial\b/);
  await expect(page.locator("#affordanceText")).toContainText("Get started:");
});
