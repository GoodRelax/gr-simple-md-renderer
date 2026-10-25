import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// The Index (INV-77, owner rulings T1 to T8, 2026-10-25) in a real browser:
// it floats at the right edge, 25 % see-through, scrolls by itself, and a
// pressed entry brings its heading to 8 px below the top of the preview. A
// jump made while the diagrams are still drawn stays (INV-78): the full
// render used to put the view back where it was when the render began.

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.goto("/");
});

function sections(count) {
  const parts = ["# Index test", ""];
  for (let i = 1; i <= count; i++) parts.push(`## Section ${i}`, "", `Text of section ${i}.`, "", `### Sub ${i}.1`, "", "More text.", "");
  return parts.join("\n");
}

const DIAGRAM_COUNT = 40;
const DIAGRAMS = Array.from({ length: DIAGRAM_COUNT }, (_, i) => `\`\`\`mermaid\nflowchart TD\n  A${i} --> B${i}\n  B${i} --> C${i}\n\`\`\`\n`).join("\n");

/** The heading's top below the top of the preview, in CSS px. */
async function headingTop(page, text) {
  return page.evaluate((t) => {
    const heading = [...document.querySelectorAll("#preview h1, #preview h2, #preview h3")].find((h) => h.textContent === t);
    return heading.getBoundingClientRect().top - document.querySelector("#preview").getBoundingClientRect().top;
  }, text);
}

test("INV-77 (1)(3)(4)(6): shows the headings over the preview, scrolls by itself, jumps and stays open", async ({ page }) => {
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

test("INV-78: a jump made while the diagrams are drawn is kept", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  // The press comes the moment the headings are in the preview, before any
  // diagram is drawn (a MutationObserver callback runs before the render
  // goes on to Mermaid); a press from Playwright arrives after the render
  // has ended, too late for the case. The diagrams are below the target, so
  // their growth cannot move it (WebKit has no scroll anchoring). The press
  // is what the browser sends for a click (pointerdown first).
  const drawnAtPress = await page.evaluate(
    (markdown) =>
      new Promise((resolve) => {
        const preview = document.querySelector("#preview");
        const observer = new MutationObserver(() => {
          const target = [...preview.querySelectorAll("h2")].find((h) => h.textContent === "Section 30");
          if (!target) return;
          observer.disconnect();
          document.querySelector("#indexBtn").click();
          const entry = [...document.querySelectorAll("#indexPanel .index-entry")].find((e) => e.textContent === "Section 30");
          entry.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
          entry.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse", button: 0 }));
          entry.click();
          resolve(preview.querySelectorAll(".mermaid > svg").length);
        });
        observer.observe(preview, { childList: true });
        const editor = document.querySelector("#editor");
        editor.value = markdown;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#renderLight").click();
      }),
    `${sections(40)}
${DIAGRAMS}`,
  );
  expect(drawnAtPress, "the press came before the diagrams were drawn").toBe(0);
  await settled(page);
  await expect(page.locator("#preview .mermaid > svg")).toHaveCount(DIAGRAM_COUNT);
  expect(Math.abs((await headingTop(page, "Section 30")) - 8)).toBeLessThanOrEqual(1);
});

test("INV-77 (4), INV-30: Esc closes the palette first and the Index last; a block edit is applied by the press", async ({ page }) => {
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

test("INV-77 (5)(6): dark colors, nothing in print, off after Clear", async ({ page }) => {
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

test("INV-77 (6)(7): placed again on a resize; opening keeps the focus on [Index]; Tab goes through the entries, Enter and Space jump", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await renderMarkdown(page, sections(30));
  await settled(page);
  const panel = page.locator("#indexPanel");
  await page.locator("#indexBtn").focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.activeElement.id)).toBe("indexBtn");

  const place = () =>
    page.evaluate(() => {
      const column = document.querySelector("#sidePanels").getBoundingClientRect();
      const preview = document.querySelector("#preview");
      const right = preview.getBoundingClientRect().left + preview.clientLeft + preview.clientWidth;
      return { gap: right - column.right, below: window.innerHeight - column.bottom };
    });
  await page.setViewportSize({ width: 900, height: 500 });
  await expect.poll(async () => Math.abs((await place()).gap - 8)).toBeLessThanOrEqual(1);
  expect((await place()).below).toBeGreaterThanOrEqual(7);

  // WebKit moves the focus with Tab to text fields only (Safari's default)
  const first = panel.getByRole("button", { name: "Section 20", exact: true });
  await first.focus();
  if (browserName === "chromium") {
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Sub 20.1", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
  }
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => Math.abs((await headingTop(page, "Section 20")) - 8)).toBeLessThanOrEqual(1);
  await panel.getByRole("button", { name: "Section 5", exact: true }).focus();
  await page.keyboard.press(" ");
  await expect.poll(async () => Math.abs((await headingTop(page, "Section 5")) - 8)).toBeLessThanOrEqual(1);
});

test("INV-77 (2): a commit builds the entries of its block only, and the Index keeps its scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await renderMarkdown(page, sections(60));
  await settled(page);
  await page.locator("#indexBtn").click();
  const panel = page.locator("#indexPanel");
  await panel.evaluate((el) => {
    el.scrollTop = 300;
    window.__e2eEntry = [...el.querySelectorAll(".index-entry")].find((e) => e.textContent === "Section 50");
  });
  await page.locator("#editBtn").click();
  await page.locator("#preview p").first().click();
  const editor = page.locator("textarea.md-block-editor");
  await editor.fill("Changed text.\n\n## New heading");
  await page.keyboard.press("Escape"); // applies and closes (INV-28)
  await expect(editor).toHaveCount(0);
  await settled(page);
  const after = await panel.evaluate((el) => ({
    texts: [...el.querySelectorAll(".index-entry")].slice(0, 4).map((e) => e.textContent),
    scrollTop: el.scrollTop,
    kept: window.__e2eEntry.isConnected && window.__e2eEntry.parentNode === el,
  }));
  expect(after.texts).toEqual(["Index test", "Section 1", "New heading", "Sub 1.1"]);
  expect(after.scrollTop).toBe(300);
  expect(after.kept).toBe(true);
});

// INV-78 (review round 1, M1): the three cases of the review, during a theme
// switch. The diagrams are above the text: while they are drawn again they
// are short code blocks, so what is below them moves up and back.
const MOVED_DOC = `${DIAGRAMS}\n${sections(60)}`;

/**
 * Switch to dark and, the moment the blocks are in the preview (before any
 * diagram is drawn), do act: "wheel" (a wheel turn and 100 px of scroll),
 * "shift" (Shift pressed) or "press" (a press on the key hint, outside the
 * text). For "wheel", window.__e2eMark is the reader's place after the
 * scroll: the first block below the top of the preview and how far below.
 * Resolves with the number of diagrams drawn at the act.
 */
function switchThemeWith(page, act) {
  return page.evaluate(
    (kind) =>
      new Promise((resolve) => {
        const preview = document.querySelector("#preview");
        const observer = new MutationObserver(() => {
          if (!preview.querySelector("h2")) return;
          observer.disconnect();
          const drawn = preview.querySelectorAll(".mermaid > svg").length;
          if (kind === "wheel") {
            preview.addEventListener(
              "scroll",
              () => {
                const top = preview.getBoundingClientRect().top;
                const block = [...preview.children].find((b) => b.getBoundingClientRect().bottom > top);
                const el = block.firstElementChild;
                window.__e2eMark = { el, top: el.getBoundingClientRect().top - top };
                resolve(drawn);
              },
              { once: true },
            );
            preview.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
            preview.scrollBy(0, 100);
            return;
          }
          if (kind === "shift") document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
          else document.querySelector("#keyHint").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
          resolve(drawn);
        });
        observer.observe(preview, { childList: true });
        document.querySelector("#renderDark").click();
      }),
    act,
  );
}

test("INV-78 (M1): a wheel turn of 100 px during a theme switch is kept at the reader's place", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await renderMarkdown(page, MOVED_DOC);
  await settled(page);
  await expect(page.locator("#preview .mermaid > svg")).toHaveCount(DIAGRAM_COUNT);
  await page.evaluate(() => {
    const preview = document.querySelector("#preview");
    const heading = [...preview.querySelectorAll("h2")].find((h) => h.textContent === "Section 10");
    preview.scrollTop += heading.getBoundingClientRect().top - preview.getBoundingClientRect().top;
  });
  expect(await switchThemeWith(page, "wheel"), "the act came before the diagrams were drawn").toBe(0);
  await settled(page);
  await expect(page.locator("#preview .mermaid > svg")).toHaveCount(DIAGRAM_COUNT);
  const mark = await page.evaluate(() => {
    const { el, top } = window.__e2eMark;
    const now = el.getBoundingClientRect().top - document.querySelector("#preview").getBoundingClientRect().top;
    return { inDiagram: !!el.closest(".mermaid"), connected: el.isConnected, top, now };
  });
  expect(mark.inDiagram).toBe(false);
  expect(mark.connected).toBe(true);
  expect(Math.abs(mark.now - mark.top)).toBeLessThanOrEqual(1);
});

for (const [act, name] of [
  ["shift", "Shift"],
  ["press", "a press on the key hint (outside the text)"],
]) {
  test(`INV-78 (M1): ${name} during a theme switch does not move the view: it goes back where it was`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await renderMarkdown(page, MOVED_DOC);
    await settled(page);
    await expect(page.locator("#preview .mermaid > svg")).toHaveCount(DIAGRAM_COUNT);
    // at the end: while the diagrams are short, the document is too short to stay there
    const before = await page.evaluate(() => {
      const preview = document.querySelector("#preview");
      preview.scrollTop = preview.scrollHeight;
      return preview.scrollTop;
    });
    expect(await switchThemeWith(page, act), "the act came before the diagrams were drawn").toBe(0);
    await settled(page);
    await expect(page.locator("#preview .mermaid > svg")).toHaveCount(DIAGRAM_COUNT);
    const after = await page.evaluate(() => document.querySelector("#preview").scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });
}
