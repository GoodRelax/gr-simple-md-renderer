import { test, expect } from "./fixtures.js";

// Self-tests of the automatic guards in fixtures.js: each one must record
// what it is there to catch. These tests opt out of the teardown checks and
// assert on the lists themselves.

test.describe("guard check", () => {
  test.use({ allowExternalRequests: true, allowPageProblems: true });

  test("pageProblems records a CSP violation (http: image)", async ({ page, pageProblems }) => {
    await page.goto("/");
    // img-src allows https: but not http:, so the CSP blocks this load.
    await page.evaluate(() => {
      const img = document.createElement("img");
      img.src = "http://example.com/e2e-csp-check.png";
      document.body.appendChild(img);
    });
    await expect
      .poll(() => pageProblems.some((p) => p.startsWith("csp: img-src") && p.includes("http://example.com")))
      .toBe(true);
  });

  test("pageProblems records console.error and uncaught errors", async ({ page, pageProblems }) => {
    await page.goto("/");
    await page.evaluate(() => {
      console.error("e2e-console-check");
      setTimeout(() => {
        throw new Error("e2e-pageerror-check");
      }, 0);
    });
    await expect.poll(() => pageProblems).toContain("console.error: e2e-console-check");
    await expect.poll(() => pageProblems.some((p) => p.includes("e2e-pageerror-check"))).toBe(true);
  });

  test("externalRequests records and aborts an external request", async ({ page, externalRequests }) => {
    await page.goto("/");
    const url = "https://example.com/e2e-route-check.png";
    await page.evaluate((src) => {
      const img = document.createElement("img");
      img.src = src;
      document.body.appendChild(img);
    }, url);
    await expect.poll(() => externalRequests).toContain(url);
  });
});
