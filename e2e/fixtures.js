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
  // The value with one input event, as a paste gives it: locator.fill types
  // a large document in pieces (about 6 s for 21 KB), which leaves the
  // tests little room under load. The app's handler is the same either way.
  await page.locator("#editor").evaluate((editor, text) => {
    editor.focus();
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }, markdown);
  await page.locator("#renderLight").click();
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
}

/**
 * Wait until the render has settled: nothing in the preview changed for
 * quietMs (a full or partial render puts the scroll back or restores its
 * anchor when the DOM is stable, CONFIG.rendering.stabilityDebounce 50 ms
 * after the last change), then a frame. A loaded machine only makes it
 * later; a fixed wait was too short there (review T-1).
 * @param {import("@playwright/test").Page} page
 * @param {number} [quietMs]
 */
export async function settled(page, quietMs = 300) {
  await page.evaluate(
    (quiet) =>
      new Promise((resolve) => {
        const preview = document.querySelector("#preview");
        let last = performance.now();
        const observer = new MutationObserver(() => (last = performance.now()));
        observer.observe(preview, { subtree: true, childList: true, attributes: true, characterData: true });
        const check = () => {
          if (performance.now() - last < quiet) return setTimeout(check, 50);
          observer.disconnect();
          resolve();
        };
        setTimeout(check, 50);
      }),
    quietMs,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
}

/**
 * Run action (a theme switch: d / l), which renders the whole document
 * again, and wait until that render has replaced the blocks and settled: a
 * wait for the new theme class or for an element alone can be met by the
 * old DOM before the render (review CR-4).
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<void>} action
 */
export async function afterFullRender(page, action) {
  await page.evaluate(() => {
    window.__e2eOldBlock = document.querySelector("#preview > .md-block");
  });
  await action();
  await page.waitForFunction(() => !window.__e2eOldBlock || !window.__e2eOldBlock.isConnected);
  await settled(page);
}
