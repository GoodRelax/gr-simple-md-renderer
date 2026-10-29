import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// The help (SC-16, FS-10): the English | Japanese switch, the download box and
// the version, and the keys while the help or the prompt is open (5.11).
// Every test also checks (fixtures) that no request leaves for an external
// host and that nothing is logged as an error.

const DOWNLOAD_URL =
  "https://github.com/GoodRelax/gr-simple-md-renderer/releases/latest/download/GRSMD.html";
const help = (page) => page.locator("#helpModal");
const body = (page, lang) => page.locator(`#helpModal .help-body[lang="${lang}"]`);
const langButton = (page, lang) => page.locator(`#helpModal [data-help-lang="${lang}"]`);

async function openHelp(page) {
  await page.locator("#helpBtn").click();
  await expect(help(page)).toBeVisible();
}

test.describe("English browser", () => {
  test.use({ locale: "en-US" });

  test("PRT-L01 / L03: English first; the switch shows one body and keeps the choice while the page is open (INV-04: nothing stored)", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    await expect(page.locator("#helpModal h2")).toHaveText("GR Simple Markdown");
    await expect(body(page, "en")).toBeVisible();
    await expect(body(page, "ja")).toBeHidden();
    await expect(langButton(page, "en")).toHaveAttribute("aria-pressed", "true");

    await langButton(page, "ja").click();
    await expect(body(page, "ja")).toBeVisible();
    await expect(body(page, "en")).toBeHidden();
    await expect(langButton(page, "ja")).toHaveAttribute("aria-pressed", "true");
    await expect(langButton(page, "en")).toHaveAttribute("aria-pressed", "false");

    await page.locator("#helpModal .close-btn").click();
    await expect(help(page)).toBeHidden();
    await openHelp(page);
    await expect(body(page, "ja")).toBeVisible();

    // nothing kept: a reload starts from the browser's language again
    await page.reload();
    await openHelp(page);
    await expect(body(page, "en")).toBeVisible();
    await expect(body(page, "ja")).toBeHidden();
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, ""]);
  });

  test("PRT-L05: the download box links to the latest release in a new tab, and shows this build's version", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    for (const lang of ["en", "ja"]) {
      if (lang === "ja") await langButton(page, "ja").click();
      const link = body(page, lang).locator(".help-download-btn");
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", DOWNLOAD_URL);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    const versionOf = (lang) => body(page, lang).locator(".help-version");
    const ja = (await versionOf("ja").innerText()).replace(/\s+/g, " ").trim();
    expect(ja).toMatch(/^\u958b\u767a\u7248 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\uff08UTC\uff09$/);
    await langButton(page, "en").click();
    const en = (await versionOf("en").innerText()).replace(/\s+/g, " ").trim();
    expect(en).toMatch(/^Development build \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \(UTC\)$/);
    const time = versionOf("en").locator("time");
    await expect(time).toHaveAttribute("datetime", (await time.innerText()).trim());
    expect(await page.locator('[data-build-kind="release"]').count()).toBe(0);
  });

  test("PRT-L03: while the help is open, the one-key shortcuts do not act behind it; Esc closes it and leaves the palette alone", async ({ page }) => {
    await page.goto("/");
    await renderMarkdown(page, "# Title\n\nSome text.\n");
    // the palette is shown first: a leaked Esc would hide it (11-c escapePressed)
    await page.keyboard.press("e");
    await expect(page.locator("#paletteSave")).toBeVisible();
    await openHelp(page);
    for (const key of ["c", "d", "e", "ArrowDown"]) await page.keyboard.press(key);
    await settled(page);
    await expect(page.locator("#preview h1")).toHaveText("Title"); // not cleared
    expect(await page.evaluate(() => document.body.classList.contains("dark"))).toBe(false);
    await expect(page.locator("#paletteSave")).toBeVisible(); // "e" did not hide it
    await expect(help(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(help(page)).toBeHidden();
    await expect(page.locator("#paletteSave")).toBeVisible(); // Esc did not reach the app

    // closed: the keys are the app's again
    await page.keyboard.press("e");
    await expect(page.locator("#paletteSave")).toBeHidden();
  });

  test("PRT-L01 / L03: the focus moves into the help on open, Tab and Shift+Tab stay inside, and Esc gives it back to [?]", async ({ page }) => {
    await page.goto("/");
    // links, diagrams and buttons behind the help: places a leaking Tab would reach
    await renderMarkdown(page, "# Title\n\n[a](https://example.com/a) [b](https://example.com/b)\n\n| A |\n| --- |\n| x |\n");
    await openHelp(page);
    const inHelp = () => page.evaluate(() => document.getElementById("helpModal").contains(document.activeElement));
    const focusedLang = () => page.evaluate(() => document.activeElement?.dataset?.helpLang ?? null);
    expect(await focusedLang()).toBe("en");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await inHelp(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inHelp(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    // the switch and the close button by keyboard only
    await page.locator('#helpModal [data-help-lang="en"]').focus();
    await page.keyboard.press("Tab");
    expect(await focusedLang()).toBe("ja");
    await page.keyboard.press("Enter");
    await expect(body(page, "ja")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.classList.contains("close-btn"))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(help(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("helpBtn");

    // Esc: the focus is not left in the hidden help
    await openHelp(page);
    expect(await focusedLang()).toBe("ja"); // the pressed language
    await page.keyboard.press("Escape");
    await expect(help(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("helpBtn");
  });

  test("PRT-L03: the prompt (long press on [?]) also keeps the one-key shortcuts away and closes with Esc", async ({ page }) => {
    await page.goto("/");
    await renderMarkdown(page, "# Title\n\nSome text.\n");
    const box = await page.locator("#helpBtn").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const prompt = page.locator("#promptModal");
    await expect(prompt).toBeVisible();
    await expect(help(page)).toBeHidden();
    // the focus is on the prompt's close button, and Tab stays inside the prompt
    expect(await page.evaluate(() => document.activeElement.matches("#promptModal .close-btn"))).toBe(true);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.getElementById("promptModal").contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("c");
    await page.keyboard.press("d");
    await settled(page);
    await expect(page.locator("#preview h1")).toHaveText("Title");
    expect(await page.evaluate(() => document.body.classList.contains("dark"))).toBe(false);
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("helpBtn");
  });
});

test.describe("Japanese browser", () => {
  test.use({ locale: "ja-JP" });

  test("PRT-L03: Japanese first, with the same sections as English", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    await expect(body(page, "ja")).toBeVisible();
    await expect(body(page, "en")).toBeHidden();
    await expect(langButton(page, "ja")).toHaveAttribute("aria-pressed", "true");
    const sections = (lang) =>
      body(page, lang).locator(":scope > [data-help-section]").evaluateAll((els) => els.map((e) => e.dataset.helpSection));
    expect(await sections("ja")).toEqual(["download", "about", "usage", "details", "privacy", "samples", "licenses"]);
    expect(await sections("en")).toEqual(await sections("ja"));
  });
});

test.describe("the help's title row and text size (B4, B6)", () => {
  test.use({ locale: "ja-JP", viewport: { width: 900, height: 500 } });

  test("PRT-L07: the title row with the switch and the close button stays at the top while the help scrolls", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    const head = page.locator("#helpModal .help-head");
    const before = await head.boundingBox();
    // the help is longer than the window: scroll it to the end
    await help(page).evaluate((modal) => {
      modal.scrollTop = modal.scrollHeight;
    });
    expect(await help(page).evaluate((modal) => modal.scrollTop)).toBeGreaterThan(100);
    const after = await head.boundingBox();
    expect(after.y).toBeLessThanOrEqual(before.y);
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.y).toBeLessThan(2);
    await expect(langButton(page, "en")).toBeInViewport();
    await expect(page.locator("#helpModal .close-btn")).toBeInViewport();
    // the row is opaque: the text scrolled under it does not show through
    const ground = await head.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ground).not.toBe("rgba(0, 0, 0, 0)");
    // the switch still works there
    await langButton(page, "en").click();
    await expect(body(page, "en")).toBeVisible();
  });

  test("PRT-L08: the help's text is 75% of the page's (12px); the prompt's is not changed", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    const size = (selector) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size('#helpModal .help-body[lang="ja"] li')).toBe(12);
    expect(await size("#helpModal .modal-content")).toBe(12);
    expect(await size("#helpModal .help-lang")).toBeCloseTo(9.75, 2);
    expect(await size("#helpModal .close-btn")).toBe(21);
    expect(await size("#helpModal h2")).toBe(18); // 1.5em of 12px
    expect(await size("#promptModal .close-btn")).toBe(28);
    expect(await size("#promptModal .modal-content")).toBe(16);
  });
});

test.describe("the clipboard permission note (CON-12, INV-69)", () => {
  test("is in Privacy & Security in both languages, and the Editing chapter is gone", async ({ page }) => {
    await page.goto("/");
    await openHelp(page);
    for (const [lang, words] of [["en", "Clipboard to Ask or Block"], ["ja", "\u300c\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u300d\u3092\u300c\u78ba\u8a8d\u3059\u308b\u300d\u304b\u300c\u30d6\u30ed\u30c3\u30af\u300d"]]) {
      if (lang === "ja") await langButton(page, "ja").click();
      const privacy = body(page, lang).locator('[data-help-section="privacy"]');
      await expect(privacy).toContainText("goodrelax.github.io");
      await expect(privacy).toContainText(words);
      await expect(body(page, lang).locator('[data-help-section="editing"]')).toHaveCount(0);
    }
  });
});

test.describe("how to start editing (owner rulings AQ4, AQ13, INV-57, INV-29)", () => {
  const LINES = {
    en: "With a mouse, double-click the preview to enter edit mode and open that block. With touch or a pen, press [Edit], then tap a block.",
    ja: "\u30de\u30a6\u30b9\u3067\u306f\u3001\u30d7\u30ec\u30d3\u30e5\u30fc\u3092\u30c0\u30d6\u30eb\u30af\u30ea\u30c3\u30af\u3059\u308b\u3068\u3001\u7de8\u96c6\u30e2\u30fc\u30c9\u306b\u5165\u308a\u3001\u305d\u306e\u30d6\u30ed\u30c3\u30af\u3092\u958b\u304d\u307e\u3059\u3002\u30bf\u30c3\u30c1\u3084\u30da\u30f3\u3067\u306f\u3001[Edit] \u3092\u62bc\u3057\u3066\u304b\u3089\u30d6\u30ed\u30c3\u30af\u3092\u30bf\u30c3\u30d7\u3057\u307e\u3059\u3002",
  };

  test("AT-HLP-12 FS-10, INV-29, INV-57 (AQ4, AQ13: the pen is as touch): Details has the line right after the [Edit] row in both languages; the start screen has its 4th step", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#affordanceText")).toContainText("4. Double-click a block     ->  Edit  (touch or pen: [Edit], tap)");
    await openHelp(page);
    for (const lang of ["en", "ja"]) {
      if (lang === "ja") await langButton(page, "ja").click();
      const rows = body(page, lang).locator('[data-help-section="details"] > ul > li');
      const texts = (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      const at = texts.findIndex((t) => t.startsWith("[Edit] / E"));
      expect(at, lang).toBeGreaterThanOrEqual(0);
      expect(texts[at + 1], lang).toBe(LINES[lang]);
    }
  });
});
