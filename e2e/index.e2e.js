import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// The Index (INV-77, owner rulings T1 to T8, 2026-10-25) in a real browser:
// it floats at the right edge, 25 % see-through, scrolls by itself, and a
// pressed entry brings its heading to 8 px below the top of the preview. A
// jump made while the diagrams are still drawn stays (INV-78): the full
// render used to put the view back where it was when the render began.

test.beforeEach(() => test.slow());

function sections(count) {
  const parts = ["# Index test", ""];
  for (let i = 1; i <= count; i++) parts.push(`## Section ${i}`, "", `Text of section ${i}.`, "", `### Sub ${i}.1`, "", "More text.", "");
  return parts.join("\n");
}

const DIAGRAMS = Array.from({ length: 6 }, (_, i) => `\`\`\`mermaid\nflowchart TD\n  A${i} --> B${i}\n  B${i} --> C${i}\n\`\`\`\n`).join("\n");

/** The heading's top below the top of the preview, in CSS px. */
async function headingTop(page, text) {
  return page.evaluate((t) => {
    const heading = [...document.querySelectorAll("#preview h1, #preview h2, #preview h3")].find((h) => h.textContent === t);
    return heading.getBoundingClientRect().top - document.querySelector("#preview").getBoundingClientRect().top;
  }, text);
}

test("shows the headings over the preview, scrolls by itself, jumps and stays open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await renderMarkdown(page, sections(60));
  await settled(page);
  const button = page.locator("#indexBtn");
  const panel = page.locator("#indexPanel");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator(".index-entry")).toHaveCount(121);

  // 25 % see-through ground, at the right edge left of the scroll bar, its own scroll
  const look = await panel.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const preview = document.querySelector("#preview");
    const right = preview.getBoundingClientRect().left + preview.clientWidth;
    return { background: getComputedStyle(el).backgroundColor, gap: right - box.right, scrolls: el.scrollHeight > el.clientHeight };
  });
  expect(look.background).toBe("rgba(255, 255, 255, 0.75)");
  expect(Math.abs(look.gap - 8)).toBeLessThanOrEqual(1);
  expect(look.scrolls).toBe(true);

  await panel.getByRole("button", { name: "Section 40", exact: true }).click();
  expect(Math.abs((await headingTop(page, "Section 40")) - 8)).toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Sub 3.1", exact: true }).click();
  expect(Math.abs((await headingTop(page, "Sub 3.1")) - 8)).toBeLessThanOrEqual(1);

  await button.click();
  await expect(panel).toBeHidden();
  await page.keyboard.press("i");
  await expect(panel).toBeVisible();
});

test("a jump made while the diagrams are drawn is kept (INV-78)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await renderMarkdown(page, `${DIAGRAMS}\n${sections(40)}`);
  // at once, before the diagrams and the full render are done
  await page.locator("#indexBtn").click();
  await page.locator("#indexPanel").getByRole("button", { name: "Section 30", exact: true }).click();
  await settled(page);
  expect(Math.abs((await headingTop(page, "Section 30")) - 8)).toBeLessThanOrEqual(40);
});

test("Esc closes the palette first and the Index last; a block edit is applied by the press", async ({ page }) => {
  await renderMarkdown(page, sections(10));
  await settled(page);
  await page.locator("#indexBtn").click();
  await page.locator("#editBtn").click();
  await expect(page.locator(".edit-palette")).toBeVisible();
  await page.locator("#preview p").first().click();
  const editor = page.locator("textarea.md-block-editor");
  await expect(editor).toBeVisible();

  // pressing an entry is outside the editor: it commits, then jumps
  await editor.fill("Changed text.");
  await page.locator("#indexPanel").getByRole("button", { name: "Section 9", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator("#preview p").first()).toHaveText("Changed text.");

  await page.keyboard.press("Escape");
  await expect(page.locator(".edit-palette")).toBeHidden();
  await expect(page.locator("#indexPanel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#indexPanel")).toBeHidden();
});

test("dark colors, nothing in print, off after Clear", async ({ page }) => {
  await renderMarkdown(page, sections(3));
  await settled(page);
  await page.keyboard.press("d");
  await settled(page);
  await page.locator("#indexBtn").click();
  await expect(page.locator("#indexPanel")).toHaveCSS("background-color", "rgba(21, 27, 35, 0.75)");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#sidePanels")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.locator("#preview").click({ position: { x: 5, y: 5 } }); // the focus out of #editor
  await page.keyboard.press("c");
  await expect(page.locator("#indexBtn")).toBeDisabled();
  await expect(page.locator("#indexPanel")).toBeHidden();
});
