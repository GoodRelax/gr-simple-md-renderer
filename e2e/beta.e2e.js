import { test, expect, renderMarkdown, settled } from "./fixtures.js";

// The beta build (INV-82, spec 5.18): grsmd-beta.html next to index.html.
// npm run build:e2e makes it from that index.html with tools/buildBeta.mjs,
// as npm run build:beta does. It differs from production only in its robots
// meta ("noindex"); it has no BETA mark and the same help (owner's ruling
// 2026-10-26), and it runs the same as production under the same CSP. Every
// test also checks (fixtures) that no request leaves for an external host and
// that nothing is logged as an error or a CSP violation.

const BETA = "/grsmd-beta.html";
const PRODUCTION_ROBOTS = '<meta name="robots" content="index, follow" />';
const BETA_ROBOTS = '<meta name="robots" content="noindex" />';
const LIBRARIES = ["mermaid", "hljs", "katex", "plantuml"];

// No Mermaid here: its SVG carries ids made per render, so two pages never
// give the same HTML for it. Mermaid is checked on its own below.
const SAME_MARKDOWN = [
  "# Beta heading",
  "",
  "Inline math $x^2 + y^2$ and a table:",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "$$",
  "\\int_0^1 x\\,dx",
  "$$",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
].join("\n");

async function allLibrariesRan(page) {
  await page.waitForFunction(
    (names) => names.every((name) => performance.getEntriesByName(`grsmd-ran-${name}`).length > 0),
    LIBRARIES,
  );
}

test("INV-82, PRT-AF01: the beta file is the production file with noindex, byte for byte otherwise", async ({ request }) => {
  const production = await (await request.get("/")).text();
  const beta = await (await request.get(BETA)).text();
  expect(production.split(PRODUCTION_ROBOTS)).toHaveLength(2);
  expect(beta).toBe(production.replace(PRODUCTION_ROBOTS, BETA_ROBOTS));
});

test("INV-82 (4), PRT-AF02: the beta has noindex, the production CSP and help, and no BETA mark", async ({ page }) => {
  await page.goto("/");
  const productionCsp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  const productionVersion = await page.locator("#helpModal .help-body[lang='en'] .help-version").textContent();

  await page.goto(BETA);
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/\bview-initial\b/);
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveCount(1);
  await expect(robots).toHaveAttribute("content", "noindex");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toBe(productionCsp);
  expect(csp).not.toContain("unsafe-eval");
  await expect(page.locator("#helpModal .help-body[lang='en'] .help-version")).toHaveText(productionVersion);
  expect(await page.locator("body").innerText()).not.toMatch(/\bBETA\b/i);
  // the on-demand libraries run from their data blocks under the CSP
  await allLibrariesRan(page);
});

test("INV-82, PRT-AF02: the beta renders Markdown, math, code and Mermaid as production does", async ({ page }) => {
  const renderedHtml = async (path) => {
    await page.goto(path);
    await allLibrariesRan(page);
    await renderMarkdown(page, SAME_MARKDOWN);
    await expect(page.locator("#preview .katex").first()).toBeVisible();
    await expect(page.locator("#preview code.hljs").first()).toBeVisible();
    await settled(page);
    return page.locator("#preview").innerHTML();
  };
  const production = await renderedHtml("/");
  const beta = await renderedHtml(BETA);
  expect(beta).toBe(production);

  await renderMarkdown(page, "```mermaid\nflowchart LR\n  A --> B\n```\n");
  await expect(page.locator("#preview .mermaid svg").first()).toBeVisible();
});
