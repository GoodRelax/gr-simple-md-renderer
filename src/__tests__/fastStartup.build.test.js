// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { contentSecurityPolicy, scriptElementsOf, hasExternalImport } from "../../vite.config.js";
import {
  LAZY_LIBRARIES,
  DATA_ID_PREFIX,
  endsAtItsEndTag,
  escapeScriptData,
  classicCore,
  splitFontFaces,
  layoutForFastStartup,
} from "../../tools/fastStartup.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("base64");

/** Run the CSP plugin's generateBundle on one HTML asset; return the new HTML. */
function csp(html) {
  const bundle = { "index.html": { type: "asset", fileName: "index.html", source: html } };
  const ctx = {
    error(msg) {
      throw new Error(msg);
    },
  };
  contentSecurityPolicy.generateBundle.call(ctx, {}, bundle);
  return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(bundle["index.html"].source)[1];
}

// vite-plugin-singlefile's output, in small: the code holds "</head>" and
// "<body>" in strings, as the real core does (DOMPurify).
const SINGLEFILE = [
  "<!doctype html><html><head>",
  '<meta charset="UTF-8" />',
  '<script type="application/ld+json">{"a":1}</script>',
  '<script type="module" crossorigin>const s="<html><head></head><body>";console.log(s)</script>',
  '<style rel="stylesheet" crossorigin>a{color:red}@font-face{font-family:K;src:url(data:font/woff2;base64,AAAA) format("woff2")}b{color:blue}</style>',
  "</head>",
  '<body><div id="app"></div>',
  "</body></html>",
].join("\n");
const PARTS = {
  boot: "window.__grsmdBoot={}",
  libraries: LAZY_LIBRARIES.map(({ name }) => ({ name, code: `__grsmdBoot.provide("${name}",{s:"</script>"})` })),
};

describe("the startup layout (INV-81 (1), spec 5.17.1)", () => {
  it("AT-FAST-29 order O2: CSS without fonts in head; markup; receiver; core; mermaid, hljs, KaTeX, fonts, PlantUML", () => {
    const html = layoutForFastStartup(SINGLEFILE, PARTS);
    const at = (text) => {
      const i = html.indexOf(text);
      expect(i, text).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      at("<style>a{color:red}b{color:blue}</style>"),
      at("</head>"),
      at('<div id="app">'),
      at("<script>window.__grsmdBoot={}</script>"),
      at('<script>(()=>{"use strict";'),
      at(`<script type="text/plain" id="${DATA_ID_PREFIX}mermaid">`),
      at('<script>__grsmdBoot.arrive("mermaid")</script>'),
      at(`id="${DATA_ID_PREFIX}hljs"`),
      at(`id="${DATA_ID_PREFIX}katex"`),
      at("<style>@font-face{font-family:K"),
      at(`id="${DATA_ID_PREFIX}plantuml"`),
      at('<script>__grsmdBoot.arrive("plantuml")</script>'),
      at("</body>"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain("crossorigin");
    // the data's own "</script" is escaped
    expect(html).toContain('{s:"<\\/script>"}');
  });

  it("AT-FAST-30 a file that is not singlefile's layout fails", () => {
    expect(() => layoutForFastStartup("<html><body></body></html>", PARTS)).toThrow(/unexpected layout/);
    const scriptInBody = SINGLEFILE.replace('<script type="module" crossorigin>', "</head><body><script type=\"module\">");
    expect(() => layoutForFastStartup(scriptInBody, PARTS)).toThrow();
  });

  it("AT-FAST-31 the core runs as a classic script in strict mode; import.meta fails the build", () => {
    expect(classicCore("a()")).toBe('(()=>{"use strict";\na()\n})();');
    expect(() => classicCore("console.log(import.meta.url)")).toThrow(/import\.meta/);
  });

  it("AT-FAST-32 the KaTeX @font-face rules are split off; the rest of the CSS stays as it was", () => {
    expect(splitFontFaces("a{x:1}@font-face{src:url(a)}@font-face {src:url(b)}c{y:2}")).toEqual({
      css: "a{x:1}c{y:2}",
      fonts: "@font-face{src:url(a)}@font-face {src:url(b)}",
    });
  });
});

describe("a script's text in the HTML (INV-81 (1))", () => {
  it.each([
    ["plain code", "a<b", true],
    ['"<!--" alone', "x=/<!--(?:-?>)/", true],
    ['"<!--" then "<script"', 's="<!--";t="<script>"', false],
    ['"<!--", "<script" and "-->"', 's="<!--<script>-->"', true],
    ['"<!-->" closes at once', 's="<!-->";t="<script>"', true],
    ['"<SCRIPT/" (any case, "/")', 's="<!--<SCRIPT/"', false],
    ['"<scriptx" is no tag', 's="<!--<scriptx>"', true],
  ])("AT-FAST-33 %s", (_name, text, ends) => {
    expect(endsAtItsEndTag(text)).toBe(ends);
  });

  it("AT-FAST-34 every \"</script\" (any case) is written \"<\\/script\"; text that would not end fails the build", () => {
    expect(escapeScriptData('a="</script>";b="</SCRIPT "', "x")).toBe('a="<\\/script>";b="<\\/SCRIPT "');
    expect(() => escapeScriptData('s="<!--<script>"', "lib")).toThrow(/lib: its text would not end/);
  });

  it("AT-FAST-35 scriptElementsOf skips comments and takes a script's text whole, \"<!--\" in it included", () => {
    const html = '<!-- <script>no()</script> --><script>x="<!--"</script><script type="text/plain" id="a">y</script>';
    expect(scriptElementsOf(html)).toEqual([
      ["", 'x="<!--"'],
      [' type="text/plain" id="a"', "y"],
    ]);
  });
});

describe("the CSP of the laid-out file (INV-20, INV-81 (1))", () => {
  it("AT-FAST-36 every script is hashed: receiver, core, arrival notes and each library's data; JSON-LD and comments are not", () => {
    const html = layoutForFastStartup(SINGLEFILE, PARTS);
    const policy = csp(html);
    const scripts = scriptElementsOf(html).filter(([attrs]) => !attrs.includes("ld+json"));
    expect(scripts).toHaveLength(2 + 2 * LAZY_LIBRARIES.length);
    for (const [, text] of scripts) expect(policy).toContain(`'sha256-${sha(text)}'`);
    expect(policy).not.toContain(sha('{"a":1}'));
    expect(policy).not.toMatch(/unsafe-eval|strict-dynamic|script-src[^;]*unsafe-inline/);
  });

  it("AT-FAST-37 a text/plain script that is not a library's data block fails the build", () => {
    const html = layoutForFastStartup(SINGLEFILE, PARTS).replace(`id="${DATA_ID_PREFIX}hljs"`, 'id="other"');
    expect(() => csp(html)).toThrow(/not a library's data block/);
  });

  it("AT-FAST-38 the external import check sees the libraries' code too", () => {
    expect(hasExternalImport('import("https://cdn.example/x.js")')).toBe(true);
    expect(hasExternalImport("x.cdnjs.y")).toBe(true);
    expect(hasExternalImport('import a from "./a.js"')).toBe(false);
  });
});

describe("AT-FAST-39 the real build (INV-81)", () => {
  let html;
  let viteGzip;
  beforeAll(async () => {
    const outDir = mkdtempSync(join(tmpdir(), "grsmd-fast-"));
    try {
      await build({
        configFile: join(root, "vite.config.js"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });
      html = readFileSync(join(outDir, "index.html"), "utf8");
      viteGzip = gzipSync(html).length;
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 180_000);

  it("has the data blocks in O2 order, each hashed in the CSP, and no module script", () => {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
    const scripts = scriptElementsOf(html);
    const data = scripts.filter(([attrs]) => attrs.includes("text/plain"));
    expect(data.map(([attrs]) => /id="([^"]*)"/.exec(attrs)[1])).toEqual(LAZY_LIBRARIES.map((l) => `${DATA_ID_PREFIX}${l.name}`));
    for (const [attrs, text] of scripts) {
      if (attrs.includes("ld+json")) continue;
      expect(policy, attrs).toContain(`'sha256-${sha(text)}'`);
      expect(endsAtItsEndTag(text)).toBe(true);
    }
    expect(html).not.toMatch(/<script type="module"/);
  });

  it("puts the CSP first, and the core before any library; the core is small", () => {
    const cspAt = html.indexOf('http-equiv="Content-Security-Policy"');
    const firstScript = html.search(/<script\b/);
    expect(cspAt).toBeLessThan(firstScript);
    const coreEnd = html.indexOf("</script>", html.indexOf('<script>(()=>{"use strict";')) + 9;
    expect(coreEnd).toBeLessThan(html.indexOf(`id="${DATA_ID_PREFIX}mermaid"`));
    // the third-party notices (a long comment) come after everything
    expect(html.indexOf("THIRD-PARTY SOFTWARE NOTICES")).toBeGreaterThan(html.indexOf('__grsmdBoot.arrive("plantuml")'));
    const usable = gzipSync(html.slice(0, coreEnd)).length;
    console.log(`fast_startup_usable_prefix_gzip=${usable} total_gzip=${viteGzip}`);
    // the libraries are not in the core: what comes before them is a small part
    expect(usable).toBeLessThan(viteGzip / 5);
  });
});
