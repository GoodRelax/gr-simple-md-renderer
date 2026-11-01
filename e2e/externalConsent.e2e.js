import { test, expect, renderMarkdown } from "./fixtures.js";

// Every request that leaves the local test server is aborted inside the
// browser by the externalRequests fixture, so these tests never contact
// example.com or the PlantUML server; they only count what was attempted.

const IMAGE_URL = "https://example.com/e2e-image.png";
const IMAGE_MARKDOWN = `# Image\n\n![remote](${IMAGE_URL})\n`;
const PLANTUML_MARKDOWN = "# PlantUML\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n";
const PLANTUML_ORIGIN = "https://www.plantuml.com";

// Long enough for an ungated <img> or fetch to have been issued.
const SETTLE_MS = 500;

// Chromium logs each load aborted by the externalRequests guard as a console
// error. A guard check expects those, and nothing else.
const BLOCKED_LOAD = /^console\.error: Failed to load resource: net::ERR_BLOCKED_BY_CLIENT\b/;

/** Opt a guard check out of the teardown checks and keep the narrower one. */
function useGuardCheck() {
  // The request after consent is expected; it is aborted, never sent.
  test.use({ allowExternalRequests: true, allowPageProblems: true });
  test.afterEach(({ pageProblems }) => {
    expect(pageProblems.filter((p) => !BLOCKED_LOAD.test(p))).toEqual([]);
  });
}

/** Answer every confirm() with `accept` and record its message. */
function answerDialogs(page, accept) {
  const messages = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.message());
    await (accept ? dialog.accept() : dialog.dismiss());
  });
  return messages;
}

test.describe("external images", () => {
  test("INV-01, INV-19: nothing is requested before consent, or after it is refused", async ({ page, externalRequests }) => {
    const dialogs = answerDialogs(page, false);
    await page.goto("/");
    await renderMarkdown(page, IMAGE_MARKDOWN);

    const placeholder = page.locator("#preview .external-image-placeholder");
    await expect(placeholder).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    expect(externalRequests).toEqual([]);

    await placeholder.click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(SETTLE_MS);
  });

  test.describe("guard check", () => {
    useGuardCheck();

    test("the image is requested only after consent", async ({ page, externalRequests }) => {
      answerDialogs(page, true);
      await page.goto("/");
      await renderMarkdown(page, IMAGE_MARKDOWN);
      await page.waitForTimeout(SETTLE_MS);
      expect(externalRequests).toEqual([]);

      await page.locator("#preview .external-image-placeholder").click();
      await expect.poll(() => externalRequests).toContain(IMAGE_URL);
      expect(externalRequests.every((url) => url === IMAGE_URL)).toBe(true);
    });
  });
});

test.describe("PlantUML", () => {
  test("INV-01, INV-03: nothing is sent when consent is refused", async ({ page }) => {
    const dialogs = answerDialogs(page, false);
    await page.goto("/");
    await renderMarkdown(page, PLANTUML_MARKDOWN);

    await expect(page.locator("#preview .plantuml-error")).toBeVisible();
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain("PlantUML");
    await page.waitForTimeout(SETTLE_MS);
  });

  test.describe("guard check", () => {
    useGuardCheck();

    test("the server is contacted only after consent", async ({ page, externalRequests }) => {
      const dialogs = answerDialogs(page, true);
      await page.goto("/");
      expect(externalRequests).toEqual([]);
      await renderMarkdown(page, PLANTUML_MARKDOWN);

      // confirm() comes from the asynchronous render after the button press.
      await expect.poll(() => dialogs.length).toBe(1);
      await expect
        .poll(() => externalRequests.filter((url) => url.startsWith(`${PLANTUML_ORIGIN}/`)).length)
        .toBeGreaterThan(0);
      expect(externalRequests.every((url) => url.startsWith(`${PLANTUML_ORIGIN}/`))).toBe(true);
    });
  });
});
