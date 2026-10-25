import { test, expect, renderMarkdown } from "./fixtures.js";
import { pausedServer, BEFORE_CORE, BEFORE_LIBRARIES } from "./pausedServer.js";
import { CONFIG } from "../src/js/config.js";

const PLANTUML_ORIGIN = new URL(CONFIG.plantuml.serverUrl).origin;

// Fast startup (INV-81, spec 5.17). The core runs right after the markup;
// mermaid, highlight.js, KaTeX and the PlantUML encoder arrive later in the
// same file and run on demand, or when the page is idle. The page's own CSP
// stays in force, and the fixtures fail a test on any CSP violation. The
// page before the libraries (or the core) arrive comes from a server that
// stops there (pausedServer.js), in every browser; network throttling (CDP,
// Chromium) is kept for the timing only.

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

/**
 * Open the page from a server that stops before `cut` (pausedServer.js):
 * every browser, no throttling. Resolves when the receiver (and, unless the
 * cut is before the core, the core) has run.
 */
async function openPaused(page, extraOrigins, cut) {
  const server = await pausedServer(cut);
  extraOrigins.allow(server.origin); // this test's own loopback server only
  await page.goto(server.url, { waitUntil: "commit" });
  if (cut === BEFORE_CORE) await page.waitForFunction(() => window.__grsmdBoot && document.getElementById("editor"));
  else await page.waitForFunction(() => performance.getEntriesByName("grsmd-core-ready").length > 0);
  return server;
}

test("INV-81 (3): before the libraries arrive, TeX, plain code and a Loading box show; when they arrive, all is drawn (PRT-AE05)", async ({ page, extraOrigins }) => {
  test.setTimeout(60000);
  const server = await openPaused(page, extraOrigins, BEFORE_LIBRARIES);
  try {
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
    server.resume();
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
  } finally {
    await server.close();
  }
});

test("INV-81 (5) (review C1): a document's element with a library's data id never runs or stands in for the library", async ({ page, extraOrigins }) => {
  test.setTimeout(60000);
  const server = await openPaused(page, extraOrigins, BEFORE_LIBRARIES);
  try {
    expect(await markAt(page, "grsmd-arrived-katex")).toBeNull();
    await renderMarkdown(
      page,
      [
        'Math $x^2$ here. <span id="grsmd-lib-katex">__grsmdBoot.arrive("hljs")</span>',
        "",
        '<b id="GRSMD-lib-mermaid">alert(1)</b>',
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
    expect(await preview.evaluate((p) => [...p.querySelectorAll("[id]")].filter((e) => /^grsmd-/i.test(e.id)).length)).toBe(0);
    await expect(preview).toContainText('__grsmdBoot.arrive("hljs")');
    server.resume();
    await expect(preview.locator(".katex")).toHaveCount(1, { timeout: 30000 });
    await expect(preview.locator(".mermaid svg")).toHaveCount(1, { timeout: 30000 });
    await expect(preview).toContainText("alert(1)");
    // hljs arrived once (its own note), not from the document's text
    expect(await page.evaluate(() => performance.getEntriesByName("grsmd-arrived-hljs").length)).toBe(1);
    // the fixtures fail the test on any CSP violation or console error
  } finally {
    await server.close();
  }
});

test("INV-81 (4): a file dropped before the core runs does not leave the page, and opens when the core runs (PRT-AE06)", async ({ page, extraOrigins }) => {
  test.setTimeout(60000);
  const server = await openPaused(page, extraOrigins, BEFORE_CORE);
  try {
    expect(await markAt(page, "grsmd-core-ready")).toBeNull();
    const prevented = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# Dropped early\n\nText.\n"], "early.md", { type: "text/markdown" }));
      const event = (type) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "dataTransfer", { value: dt });
        document.body.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return event("dragover") && event("drop");
    });
    expect(prevented).toBe(true);
    server.resume();
    await expect(page.locator("#preview h1")).toHaveText("Dropped early", { timeout: 30000 });
    await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  } finally {
    await server.close();
  }
});

test.describe("PlantUML and the late KaTeX (review N1)", () => {
  // The PlantUML server is never reached: the fixtures abort and record
  // every request to it. A blocked image shows its error (a console line).
  test.use({ allowExternalRequests: true, allowPageProblems: true });

  test("INV-81 (3), INV-23: KaTeX arriving later never sends a diagram a commit added; the consented one is sent", async ({ page, extraOrigins, externalRequests, pageProblems }) => {
    test.setTimeout(60000);
    page.on("dialog", (dialog) => dialog.accept());
    const server = await openPaused(page, extraOrigins, BEFORE_LIBRARIES);
    try {
      await renderMarkdown(page, "```plantuml\n@startuml\nA -> B\n@enduml\n```\n\n- $x$\n");
      const preview = page.locator("#preview");
      await expect(preview.locator(".plantuml-loading")).toHaveCount(1); // allowed, the encoder on its way
      await page.locator("#editBtn").click();
      await page.locator("#preview > .md-block", { hasText: "$x$" }).click();
      const editor = page.locator("textarea.md-block-editor");
      await expect(editor).toBeVisible();
      await editor.evaluate((el) => {
        el.value = "- $x$\n\n  ```plantuml\n  @startuml\n  SECRET -> D\n  @enduml\n  ```";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.keyboard.press("Escape"); // commits (INV-23: the new diagram waits for [Render])
      await expect(preview.locator(".plantuml-pending")).toHaveCount(1);
      server.resume();
      await expect(preview.locator(".katex")).toHaveCount(1, { timeout: 30000 });
      const plantuml = () => [...new Set(externalRequests.filter((url) => new URL(url).origin === PLANTUML_ORIGIN))];
      await expect.poll(() => plantuml().length, { timeout: 30000 }).toBe(1);
      await page.waitForTimeout(500);
      expect(plantuml()).toHaveLength(1); // A -> B only
      // every request stopped on its way out went to the PlantUML server: no other host
      expect(externalRequests.filter((url) => new URL(url).origin !== PLANTUML_ORIGIN)).toEqual([]);
      await expect(preview.locator(".plantuml-pending")).toHaveCount(1);
      expect(pageProblems.filter((p) => p.startsWith("csp"))).toEqual([]);
    } finally {
      await server.close();
    }
  });
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
