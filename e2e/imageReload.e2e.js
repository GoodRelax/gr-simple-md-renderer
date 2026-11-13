import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// Spec: INV-110, PRT-T05.
// Why: The page CSP lets an http: image through only from the page's own origin, so one loopback server of this test serves both
// Why: Playwright turns the HTTP cache off while a route is set, so this test opens its own context without the route of fixtures.js

const ONE_YEAR = "public, max-age=31536000, immutable";

/**
 * Spec: INV-110. An SVG whose width tells which version the browser shows.
 * @param {number} width
 * @returns {string}
 */
function svgOfWidth(width) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10"><rect width="${width}" height="10" fill="#0969da"/></svg>`;
}

/**
 * Spec: INV-110. The built file at "/" and /pic.svg with a one-year Cache-Control; setWidth replaces
 * the image on the server, and imageRequests lists every request for it.
 * @returns {Promise<{origin: string, imageRequests: string[], setWidth: Function, close: Function}>}
 */
async function imageServer() {
  const html = readFileSync(resolve("output/e2e/index.html"));
  const imageRequests = [];
  let width = 10;
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    if (req.url.startsWith("/pic.svg")) {
      imageRequests.push(req.url);
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": ONE_YEAR, ETag: `"w${width}"` });
      res.end(svgOfWidth(width));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    imageRequests,
    setWidth: (w) => (width = w),
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

/**
 * Spec: INV-110. Save as through a fake save dialog: the file it returns keeps what was written, so a
 * later Reload reads the document from it.
 */
function fakeSaveDialog() {
  window.showSaveFilePicker = async () => {
    let text = "";
    let lastModified = Date.now();
    return {
      kind: "file",
      name: "doc.md",
      async requestPermission() {
        return "granted";
      },
      async queryPermission() {
        return "granted";
      },
      async createWritable() {
        const chunks = [];
        return {
          async write(data) {
            chunks.push(String(data));
          },
          async close() {
            text = chunks.join("");
            lastModified = Date.now();
          },
          async abort() {},
        };
      },
      async getFile() {
        return new File([text], "doc.md", { lastModified });
      },
    };
  };
}

const shownWidth = (page) => page.locator("#preview img").evaluate((img) => (img.complete ? img.naturalWidth : 0));

/**
 * Spec: INV-110, PRT-T05. A context with the HTTP cache on (no route) whose pages reach only server.origin:
 * every other host goes to a closed port on the loopback interface, so nothing leaves the machine. requests and
 * problems (console errors, page errors, CSP violations) are checked at the end, as the fixtures.js guards do.
 * @param {import("@playwright/test").Browser} browser
 * @param {string} origin
 */
async function cachingContext(browser, origin) {
  const context = await browser.newContext({ proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1" } });
  const requests = [];
  const problems = [];
  context.on("request", (request) => requests.push(request.url()));
  context.on("page", (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  });
  await context.exposeFunction("__e2eReportCspViolation", (text) => problems.push(text));
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__e2eReportCspViolation(`csp: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return {
    context,
    check() {
      expect(requests.filter((url) => new URL(url).origin !== origin), "requests to other hosts").toEqual([]);
      expect(problems, "console errors, page errors, CSP violations").toEqual([]);
    },
  };
}

/**
 * Spec: INV-19. Open the page, show the Markdown and give consent to its external image.
 * @param {import("@playwright/test").Page} page
 * @param {string} origin
 * @param {string} markdown
 */
async function showWithConsent(page, origin, markdown) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${origin}/`);
  await renderMarkdown(page, markdown);
  await page.locator("#preview .external-image-placeholder").click();
}

test.describe("INV-110 Reload loads an external image again", () => {
  let server;

  test.beforeEach(async () => {
    server = await imageServer();
  });

  test.afterEach(async () => {
    await server.close();
  });

  /**
   * Spec: INV-110. Save as through the fake dialog (so that Reload has a file to read), then press [Reload] and wait for the render.
   * @param {import("@playwright/test").Page} page
   */
  async function saveAndReload(page) {
    await page.locator("#editBtn").click();
    await page.locator("#paletteSaveAs").click();
    await expect(page.locator("#toastContainer")).toContainText("Saved: doc.md");
    await page.locator("#reloadBtn").click();
    await settled(page);
  }

  test("an image the document already shows is shown in its new version after [Reload]", async ({ browser }) => {
    const markdown = `# Picture\n\n![pic](${server.origin}/pic.svg)\n`;
    const { context, check } = await cachingContext(browser, server.origin);
    try {
      const page = await context.newPage();
      await page.addInitScript(fakeSaveDialog);
      await showWithConsent(page, server.origin, markdown);
      await expect.poll(() => shownWidth(page)).toBe(10);

      server.setWidth(20);
      await saveAndReload(page);
      await expect.poll(() => shownWidth(page)).toBe(20);
      expect(server.imageRequests).toEqual(["/pic.svg", expect.stringMatching(/^\/pic\.svg\?grsmd=\d+$/)]);
      await expect(page.locator("#editor")).toHaveValue(markdown);
      check();
    } finally {
      await context.close();
    }
  });

  test("an image the HTTP cache serves stale without a request (one-year Cache-Control) is shown in its new version after [Reload]", async ({ browser, browserName }) => {
    // Why: Playwright's WebKit on Windows requested the image again for a new document (measured 2026-11-13), so it has no HTTP cache path to check
    test.skip(browserName === "webkit", "WebKit here keeps no HTTP cache across documents");
    const markdown = `# Picture\n\n![pic](${server.origin}/pic.svg)\n`;
    const { context, check } = await cachingContext(browser, server.origin);
    try {
      const first = await context.newPage();
      await showWithConsent(first, server.origin, markdown);
      await expect.poll(() => shownWidth(first)).toBe(10);
      await first.close();

      server.setWidth(20);
      const page = await context.newPage();
      await page.addInitScript(fakeSaveDialog);
      await showWithConsent(page, server.origin, markdown);
      await expect.poll(() => shownWidth(page)).toBe(10);
      expect(server.imageRequests).toEqual(["/pic.svg"]);

      await saveAndReload(page);
      await expect.poll(() => shownWidth(page)).toBe(20);
      expect(server.imageRequests).toEqual(["/pic.svg", expect.stringMatching(/^\/pic\.svg\?grsmd=\d+$/)]);
      check();
    } finally {
      await context.close();
    }
  });
});
