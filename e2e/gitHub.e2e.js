import { test, expect } from "./fixtures.js";

// GitHub editing (SC-27): the token field of the dialogs (owner rulings D28,
// D34, D35, D37), the Pushed toast (D36) and the [O] key hint (D33).
// Every request to api.github.com is answered here by page.route with a fake
// GitHub: nothing reaches the real GitHub (the externalRequests guard checks
// that nothing else leaves the browser either).

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

test.describe("GitHub editing (SC-27)", () => {
  test("the token field: GitHub's name, the eye button, no [Saved] (D35, D28, D34)", async ({ page }) => {
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

  test("a token typed into the field clears the dialog's error (D37)", async ({ page }) => {
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

  test("open, edit and push: the Pushed toast stays 6 s (D36); nothing reaches the real GitHub", async ({ page, externalRequests }) => {
    const seen = await fakeGitHub(page);
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
    await page.locator("#gitHubPushSubmit").click();
    const toast = page.locator("#toastContainer .toast", { hasText: "Pushed to GitHub (abcdef1)." });
    await expect(toast).toBeVisible();
    // other toasts go after 3 s; this one is still there after 4.5 s (a timer is never early)
    await page.waitForTimeout(4500);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 5000 });
    expect(seen).toContain("PUT /repos/GoodRelax/sample/contents/docs/sample.md");
    expect(seen.filter((s) => s.startsWith("GET "))).toHaveLength(3);
    expect(externalRequests).toEqual([]); // the fixture checks this again at teardown
  });

  test("the key hint lists [O] GitHub on a PC (D33)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#editor").evaluate((editor) => {
      editor.value = "# Hint\n";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#renderLight").click();
    await expect(page.locator("#keyHint")).toContainText("[F] Search; [O] GitHub; [L] Light;");
  });
});
