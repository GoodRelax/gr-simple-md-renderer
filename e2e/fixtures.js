import { test as base, expect } from "@playwright/test";

/**
 * Shared fixtures for the e2e tests. Both guards are automatic: they run for
 * every test, named in its arguments or not, and are set up before any
 * beforeEach hook.
 *
 * - externalRequests: every request whose origin is not the local test
 *   server is aborted before it leaves the browser and recorded here. Nothing
 *   is ever sent to a real external host. At teardown the list must be empty.
 * - pageProblems: console errors, uncaught page errors and CSP violations
 *   (securitypolicyviolation events) seen during the test. At teardown the
 *   list must be empty.
 *
 * A test that checks a guard itself opts out of the teardown check with
 * test.use({ allowExternalRequests: true }) or test.use({ allowPageProblems: true })
 * and asserts on the list on its own.
 */
export const test = base.extend({
  allowExternalRequests: [false, { option: true }],
  allowPageProblems: [false, { option: true }],

  externalRequests: [
    async ({ context, baseURL, allowExternalRequests }, use) => {
      const localOrigin = new URL(baseURL).origin;
      const blocked = [];
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (new URL(url).origin === localOrigin) return route.continue();
        blocked.push(url);
        return route.abort("blockedbyclient");
      });
      await use(blocked);
      if (!allowExternalRequests) expect(blocked, "requests to external hosts").toEqual([]);
    },
    { auto: true },
  ],

  pageProblems: [
    async ({ page, allowPageProblems }, use) => {
      const problems = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      await page.exposeFunction("__e2eReportCspViolation", (text) => problems.push(text));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          window.__e2eReportCspViolation(`csp: ${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      await use(problems);
      if (!allowPageProblems) expect(problems, "console errors, page errors, CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Drop one file onto the page the way a file manager does: a drop event
 * whose DataTransfer carries a File. The drop handler is on document.
 * @param {import("@playwright/test").Page} page
 * @param {{name: string, text: string, type?: string}} file
 */
export async function dropFile(page, { name, text, type = "" }) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, text, type }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type, lastModified: Date.now() }));
      return dt;
    },
    { name, text, type },
  );
  await page.dispatchEvent("#preview", "dragover", { dataTransfer });
  await page.dispatchEvent("#preview", "drop", { dataTransfer });
}

/**
 * Put Markdown into the editor and press [Render Light].
 * @param {import("@playwright/test").Page} page
 * @param {string} markdown
 */
export async function renderMarkdown(page, markdown) {
  await page.locator("#editor").fill(markdown);
  await page.locator("#renderLight").click();
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
}
