import { test, expect } from "./fixtures.js";

// GitHub editing (SC-28): the token field of the dialogs (CON-16, INV-93;
// owner rulings D28, D34, D35, D37), open-edit-push and its toast (INV-93..96,
// D36), the primary key + S in a dialog (INV-58) and the [O] key hint (5.11,
// INV-100, D33).
// Every request to api.github.com is answered here by page.route with a fake
// GitHub: nothing reaches the real GitHub (the externalRequests guard checks
// that nothing else leaves the browser either).
//
// D40: GitHub editing is not offered in the release (CONFIG.github.offered is
// false, and the CSP has no api.github.com), so the tests of the editing
// itself are skipped until a later branch removes the code. The tests at the
// end check that no entry to it is shown (PRT-AK12, AT-HLP-26).

const TOKEN = "github_pat_11FAKE0000000000_e2eonly";
const FILE_URL = "https://github.com/GoodRelax/sample/blob/main/docs/sample.md";
const API = "https://api.github.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
};

/**
 * Answer api.github.com like GitHub does for one public file.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>} the "METHOD path" of each request answered
 */
async function fakeGitHub(page) {
  const seen = [];
  let text = "# Sample\n\nfrom the fake GitHub\n";
  let blob = "1".repeat(40);
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    seen.push(`${request.method()} ${url.pathname}`);
    const json = (body, status = 200) =>
      route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/repos/GoodRelax/sample/contents/docs/sample.md" && request.method() === "GET") {
      const content = Buffer.from(text, "utf8").toString("base64");
      return json({ type: "file", size: Buffer.byteLength(text), encoding: "base64", content, sha: blob });
    }
    if (url.pathname === "/repos/GoodRelax/sample/contents/docs/sample.md" && request.method() === "PUT") {
      const body = JSON.parse(request.postData());
      if (body.sha !== blob) return json({ message: "sha does not match" }, 409);
      text = Buffer.from(body.content, "base64").toString("utf8");
      blob = "2".repeat(40);
      return json({ content: { sha: blob }, commit: { sha: "abcdef1234567890", html_url: "https://github.com/GoodRelax/sample/commit/abcdef1" } });
    }
    if (url.pathname === "/repos/GoodRelax/sample/commits") {
      return json([{ sha: "c".repeat(40), commit: { message: "Add sample", author: { name: "GoodRelax", date: "2026-10-29T00:00:00Z" } }, html_url: "" }]);
    }
    if (url.pathname === "/repos/GoodRelax/sample") return json({ private: false });
    return json({ message: "Not Found" }, 404);
  });
  return seen;
}

/**
 * Open the fake file through the Open GitHub dialog.
 * @param {import("@playwright/test").Page} page
 */
async function openFromGitHub(page) {
  await page.keyboard.press("o");
  const dialog = page.locator("#gitHubOpenDialog");
  await expect(dialog).toBeVisible();
  await page.locator("#gitHubOpenToken").fill(TOKEN);
  await page.locator("#gitHubOpenUrl").fill(FILE_URL);
  await page.locator("#gitHubOpenSubmit").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#gitHubBtn")).toHaveClass(/\bgh-push\b/);
}

// Skipped while GitHub editing is not offered (D40).
test.describe.skip("GitHub editing (SC-28)", () => {
  test("CON-16 (2), INV-93 (0): the token field: GitHub's name, the eye button, no [Saved] (D35, D28, D34)", async ({ page }) => {
    await fakeGitHub(page);
    await page.goto("/");
    await page.keyboard.press("o");
    const token = page.locator("#gitHubOpenToken");
    await expect(token).toBeFocused();
    await expect(page.locator('label[for="gitHubOpenToken"]')).toHaveText("Fine-grained personal access token");
    // the name sits on the line above the field
    const labelBox = await page.locator('label[for="gitHubOpenToken"]').boundingBox();
    const fieldBox = await token.boundingBox();
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(fieldBox.y + 1);
    await expect(page.locator(".gh-saved")).toHaveCount(0);
    await token.fill(TOKEN);
    const eye = page.locator("#gitHubOpenForm .gh-reveal");
    await expect(token).toHaveAttribute("type", "password");
    await eye.click();
    await expect(token).toHaveAttribute("type", "text");
    await expect(eye).toHaveAttribute("aria-pressed", "true");
    await eye.click();
    await expect(token).toHaveAttribute("type", "password");
    // shown, then the dialog is closed and opened again: hidden
    await eye.click();
    await page.locator("#gitHubOpenForm .gh-cancel").click();
    await page.keyboard.press("o");
    await expect(token).toHaveAttribute("type", "password");
  });

  test("CON-16 (1), INV-93: a token typed into the field clears the dialog's error (D37)", async ({ page }) => {
    await fakeGitHub(page);
    await page.goto("/");
    await page.keyboard.press("o");
    await page.locator("#gitHubOpenToken").fill("ghp_classicTokenIsRefused");
    await page.locator("#gitHubOpenUrl").fill(FILE_URL);
    await page.locator("#gitHubOpenSubmit").click();
    const error = page.locator("#gitHubOpenError");
    await expect(error).toBeVisible();
    await page.locator("#gitHubOpenToken").fill(TOKEN);
    await expect(error).toBeHidden();
  });

  test("INV-93..96, PRT-AK01: open, edit and push; the Pushed toast stays 6 s (D36); nothing reaches the real GitHub", async ({ page, externalRequests }) => {
    const seen = await fakeGitHub(page);
    // the page's clock is Playwright's: it runs as usual until paused below,
    // then the toast's 6 s is stepped exactly (no wall-clock wait)
    await page.clock.install();
    await page.goto("/");
    await openFromGitHub(page);
    await expect(page.locator("#preview")).toContainText("from the fake GitHub");
    // edit in the top box, then render
    await page.locator("#editor").evaluate((editor) => {
      editor.value += "\nedited in e2e\n";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#renderLight").click();
    await expect(page.locator("#gitHubBtn")).toBeEnabled();
    await page.locator("#gitHubBtn").click();
    await expect(page.locator("#gitHubPushDialog")).toBeVisible();
    await expect(page.locator("#gitHubPushForm .gh-saved")).toHaveCount(0);
    await page.locator("#gitHubPushToken").fill(TOKEN);
    // the push needs no timer (the faked GitHub answers at once): the toast
    // starts at the paused time, so its life is counted from there
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator("#gitHubPushSubmit").click();
    const toast = page.locator("#toastContainer .toast", { hasText: "Pushed to GitHub (abcdef1)." });
    await expect(toast).toBeVisible();
    await page.clock.runFor(5900); // other toasts are gone after 3 s
    await expect(toast).toBeVisible();
    await page.clock.runFor(200);
    await expect(toast).toHaveCount(0);
    expect(seen).toContain("PUT /repos/GoodRelax/sample/contents/docs/sample.md");
    expect(seen.filter((s) => s.startsWith("GET "))).toHaveLength(3);
    expect(externalRequests).toEqual([]); // the fixture checks this again at teardown
  });

  test("INV-58, 5.20: the primary key + S in a GitHub dialog stops the browser's Save page and saves nothing", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("o");
    await expect(page.locator("#gitHubOpenDialog")).toBeVisible();
    const prevented = await page.locator("#gitHubOpenUrl").evaluate((input) => {
      // the app's own test (utils.isApplePlatform): Cmd on Apple platforms, Ctrl elsewhere
      const platform = navigator.userAgentData?.platform;
      const isMac = platform ? platform === "macOS" : /Mac|iPhone|iPad/.test(navigator.platform);
      const results = [];
      for (const shift of [false, true]) {
        const event = new KeyboardEvent("keydown", { key: shift ? "S" : "s", code: "KeyS", ctrlKey: !isMac, metaKey: isMac, shiftKey: shift, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        results.push(event.defaultPrevented);
      }
      return results;
    });
    expect(prevented).toEqual([true, true]);
    await expect(page.locator("#gitHubOpenDialog")).toBeVisible(); // nothing else happened
  });

  test("INV-100: [Open GitHub] is shown on a PC and not in a frame; o does nothing there", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#gitHubBtn")).toBeVisible();
    await page.route("**/frame-host.html", (route) =>
      route.fulfill({ contentType: "text/html", body: '<!doctype html><iframe src="/" width="1200" height="800"></iframe>' }),
    );
    await page.goto("/frame-host.html");
    const app = page.frameLocator("iframe");
    await expect(app.locator("#renderLight")).toBeVisible();
    await expect(app.locator("#gitHubBtn")).toBeHidden();
    await app.locator("#renderLight").focus();
    await app.locator("#renderLight").press("o");
    await expect(app.locator("#gitHubOpenDialog")).toBeHidden();
  });

  test("INV-100, 5.11: the key hint lists [O] GitHub on a PC (D33)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").evaluate((editor) => {
      editor.value = "# Hint\n";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#renderLight").click();
    await expect(page.locator("#keyHint")).toContainText("[F] Find; [O] GitHub; [L] Light;");
  });
});

test.describe("GitHub editing on a touch device (SC-28)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("INV-100: on a phone or iPad [Open GitHub] is not shown", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => window.matchMedia("(pointer: fine)").matches)).toBe(false);
    await expect(page.locator("#renderLight")).toBeVisible();
    await expect(page.locator("#gitHubBtn")).toBeHidden();
  });
});

test.describe("GitHub editing is not offered in the release (D40)", () => {
  test("PRT-AK12 (1) D40: on a PC [Open GitHub] is hidden, o opens nothing, and nothing goes to api.github.com", async ({ page, externalRequests }) => {
    const seen = await fakeGitHub(page);
    await page.goto("/");
    expect(await page.evaluate(() => window.matchMedia("(pointer: fine)").matches)).toBe(true);
    await expect(page.locator("#renderLight")).toBeVisible();
    await expect(page.locator("#gitHubBtn")).toBeHidden();
    await page.locator("#renderLight").focus();
    await page.keyboard.press("o");
    for (const id of ["gitHubOpenDialog", "gitHubPushDialog", "gitHubReloadDialog", "gitHubDropDialog"]) {
      await expect(page.locator(`#${id}`), id).toBeHidden();
    }
    expect(seen).toEqual([]);
    expect(externalRequests).toEqual([]);
  });

  test("PRT-AK12 (2) D40, 5.11: the key hint on a PC lists no [O] GitHub", async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").evaluate((editor) => {
      editor.value = "# Hint\n";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#renderLight").click();
    await expect(page.locator("#keyHint")).toContainText("[F] Find; [L] Light;");
    await expect(page.locator("#keyHint")).not.toContainText("GitHub");
  });

  test("PRT-AK12 (3), AT-HLP-26 D40: on a PC the help and More details show no GitHub editing", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator("#githubHelpModal, [data-open-github-help]").count()).toBe(0);
    await page.locator("#helpBtn").click();
    for (const lang of ["en", "ja"]) {
      await page.locator(`#helpModal [data-help-lang="${lang}"]`).click();
      const help = page.locator(`#helpModal .help-body[lang="${lang}"]`);
      await expect(help).toBeVisible();
      await help.locator("[data-open-guide]").click();
      const guide = page.locator(`#guideModal .help-body[lang="${lang}"]`);
      await expect(guide).toBeVisible();
      for (const box of [help, guide]) {
        await expect(box).not.toContainText("api.github.com");
        await expect(box).not.toContainText("[Open GitHub]");
        await expect(box).not.toContainText("Push to GitHub");
      }
      await page.keyboard.press("Escape"); // closes More details, the help stays
      await expect(page.locator("#guideModal")).toBeHidden();
    }
  });
});

test.describe("the CSP without api.github.com (D40)", () => {
  test.use({ allowPageProblems: true });

  test("PRT-AK12 (4) D40, CON-12: the page's CSP lets it fetch from the PlantUML server only", async ({ page, pageProblems }) => {
    await page.goto("/");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toMatch(/(^|; )connect-src https:\/\/www\.plantuml\.com(;|$)/);
    expect(csp).not.toContain("api.github.com");
    // the browser refuses a fetch to api.github.com before any test route sees it
    const refused = await page.evaluate(() =>
      fetch("https://api.github.com/zen").then(
        () => false,
        () => true,
      ),
    );
    expect(refused).toBe(true);
    await expect.poll(() => pageProblems.some((p) => p.startsWith("csp: connect-src blocked https://api.github.com"))).toBe(true);
  });
});
