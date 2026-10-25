import { test, expect, renderMarkdown } from "./fixtures.js";

// Fast startup (INV-81, spec 5.17). The core runs right after the markup;
// mermaid, highlight.js, KaTeX and the PlantUML encoder arrive later in the
// same file and run on demand, or when the page is idle. The page's own CSP
// stays in force, and the fixtures fail a test on any CSP violation.

const RICH = [
  "# Fast $a+b$",
  "",
  "Inline $x^2$ math.",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
].join("\n");

const MBPS = 1e6 / 8; // bytes per second in one Mbps

/** Chromium's network throttling (DevTools), cache off: a first visit. */
async function throttle(page, mbps, latency, { cache = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: !cache });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency,
    downloadThroughput: mbps * MBPS,
    uploadThroughput: mbps * MBPS,
  });
  return cdp;
}

const markAt = (page, name) =>
  page.evaluate((n) => performance.getEntriesByName(n)[0]?.startTime ?? null, name);

test("INV-81 (2): every library runs once the page is idle, with no CSP violation (owner ruling 2026-10-25)", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("grsmd-ran-")).map((m) => m.name)), { timeout: 15000 })
    .toEqual(["grsmd-ran-mermaid", "grsmd-ran-hljs", "grsmd-ran-katex", "grsmd-ran-plantuml"]);
  // their data blocks have gone; the core came before every library
  await expect(page.locator('script[type="text/plain"]')).toHaveCount(0);
  const core = await markAt(page, "grsmd-core-ready");
  const mermaid = await markAt(page, "grsmd-arrived-mermaid");
  expect(core).toBeLessThan(mermaid);
});

test("INV-81 (3): before the libraries arrive, TeX, plain code and a Loading box show; when they arrive, all is drawn (PRT-AE05)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "network throttling (CDP) is Chromium only");
  test.setTimeout(60000);
  await throttle(page, 2, 100);
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForFunction(() => performance.getEntriesByName("grsmd-core-ready").length > 0);
  expect(await markAt(page, "grsmd-arrived-mermaid")).toBeNull();
  await renderMarkdown(page, RICH);
  const preview = page.locator("#preview");
  // the Index lists the heading's math as TeX, as it will after KaTeX (INV-77)
  await page.locator("#indexBtn").click();
  await expect(page.locator("#indexPanel")).toHaveText("Fast a+b");
  await page.locator("#indexBtn").click();
  // a search hit in the heading's block (drawn again when KaTeX comes)
  await page.keyboard.press("f");
  await page.locator("#searchInput").fill("Fast");
  await page.locator("#searchNext").click();
  await expect(preview.locator(".search-hit")).toContainText("Fast");
  await expect(preview.locator(".mermaid.mermaid-loading")).toHaveText("Loading diagram...");
  await expect(preview.locator(".math-pending").first()).toBeVisible();
  await expect(preview.locator(".math-pending").first()).toHaveText("$a+b$");
  await expect(preview.locator(".katex")).toHaveCount(0);
  await expect(preview.locator("code .hljs-keyword")).toHaveCount(0);
  // the rest of the file arrives: each part is drawn as it comes
  await expect(preview.locator(".mermaid svg")).toHaveCount(1, { timeout: 30000 });
  await expect(preview.locator(".katex")).toHaveCount(2, { timeout: 30000 });
  await expect(preview.locator("code .hljs-keyword").first()).toBeVisible({ timeout: 30000 });
  await expect(preview.locator(".math-pending, .mermaid-loading")).toHaveCount(0);
  // the hit's block was drawn again: its mark comes with the next move (spec 5.17.3)
  await expect(preview.locator(".search-hit")).toHaveCount(0);
  await page.locator("#searchNext").click();
  await expect(preview.locator(".search-hit")).toContainText("Fast");
  await page.locator("#searchClose").click();
  await page.locator("#indexBtn").click();
  await expect(page.locator("#indexPanel")).toHaveText("Fast a+b");
});

test("INV-81 (5) (review C1): a document's element with a library's data id never runs or stands in for the library", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "network throttling (CDP) is Chromium only");
  test.setTimeout(60000);
  const cdp = await throttle(page, 0.3, 100);
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForFunction(() => performance.getEntriesByName("grsmd-core-ready").length > 0);
  expect(await markAt(page, "grsmd-arrived-katex")).toBeNull();
  await renderMarkdown(
    page,
    [
      'Math $x^2$ here. <span id="grsmd-lib-katex">__grsmdBoot.arrive("hljs")</span>',
      "",
      '<b id="grsmd-lib-mermaid">alert(1)</b>',
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
    ].join("\n"),
  );
  const preview = page.locator("#preview");
  await expect(preview.locator(".math-pending")).toHaveCount(1);
  // the document's ids are dropped when sanitized; its text stays
  await expect(preview.locator('[id^="grsmd-"]')).toHaveCount(0);
  await expect(preview).toContainText('__grsmdBoot.arrive("hljs")');
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expect(preview.locator(".katex")).toHaveCount(1, { timeout: 30000 });
  await expect(preview.locator(".mermaid svg")).toHaveCount(1, { timeout: 30000 });
  await expect(preview).toContainText("alert(1)");
  // hljs arrived once (its own note), not from the document's text
  expect(await page.evaluate(() => performance.getEntriesByName("grsmd-arrived-hljs").length)).toBe(1);
  // the fixtures fail the test on any CSP violation or console error
});

test("INV-81 (4): a file dropped before the core runs does not leave the page, and opens when the core runs (PRT-AE06)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "network throttling (CDP) is Chromium only");
  test.setTimeout(60000);
  const cdp = await throttle(page, 0.2, 100);
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForFunction(() => window.__grsmdBoot && document.getElementById("editor"));
  expect(await markAt(page, "grsmd-core-ready")).toBeNull();
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["# Dropped early\n\nText.\n"], "early.md", { type: "text/markdown" }));
    const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
    const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(over);
    document.body.dispatchEvent(drop);
    return over.defaultPrevented && drop.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expect(page.locator("#preview h1")).toHaveText("Dropped early", { timeout: 30000 });
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
});

test("INV-81 (3): math, code and Mermaid render as before once the libraries are in (theme switch and Reload included)", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, RICH);
  const preview = page.locator("#preview");
  await expect(preview.locator(".mermaid svg")).toHaveCount(1);
  await expect(preview.locator(".katex")).toHaveCount(2);
  await expect(preview.locator("code .hljs-keyword").first()).toBeVisible();
  await page.locator("#renderDark").click();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await expect(preview.locator(".mermaid svg")).toHaveCount(1);
  await expect(preview.locator(".katex")).toHaveCount(2);
  await expect(preview.locator(".math-pending, .mermaid-loading")).toHaveCount(0);
});

// Timing depends on the machine and the network model: only with
// GRSMD_PERF=1, as the other timing checks. The goal (owner decision
// 2026-10-21): usable within 1 s on 4 Mbps with a 100 ms round trip, and a
// new tab (N) fast too. "Usable" is the core's mark: from then on a drop or
// a paste is handled.
const USABLE_BUDGET_MS = 1000;
test("INV-81 (PRT-AE04, PRT-AE07): usable within 1 s on 4 Mbps / RTT 100 ms, first visit and a new tab (4x slower CPU)", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium", "measured in Chrome (CDP throttling)");
  test.skip(process.env.GRSMD_PERF !== "1", "timing: GRSMD_PERF=1 only");
  test.setTimeout(120000);
  const cold = [];
  for (let i = 0; i < 3; i++) {
    const p = i === 0 ? page : await context.newPage();
    await throttle(p, 4, 100);
    await p.goto("/", { waitUntil: "commit" });
    await p.waitForFunction(() => performance.getEntriesByName("grsmd-core-ready").length > 0, null, { timeout: 30000 });
    cold.push(await markAt(p, "grsmd-core-ready"));
    await p.waitForLoadState("load");
    if (p !== page) await p.close();
  }
  // a new tab: the file is in the HTTP cache (revalidated), the CPU 4x slower
  const warm = [];
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    const cdp = await throttle(p, 4, 100, { cache: true });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await p.goto("/", { waitUntil: "commit" });
    await p.waitForFunction(() => performance.getEntriesByName("grsmd-core-ready").length > 0, null, { timeout: 30000 });
    warm.push(await markAt(p, "grsmd-core-ready"));
    await p.close();
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[1];
  console.log(`usable_ms cold=${cold.map(Math.round).join(",")} (median ${Math.round(median(cold))}) newtab_cpu4=${warm.map(Math.round).join(",")} (median ${Math.round(median(warm))})`);
  expect(median(cold)).toBeLessThan(USABLE_BUDGET_MS);
  expect(median(warm)).toBeLessThan(USABLE_BUDGET_MS);
});
