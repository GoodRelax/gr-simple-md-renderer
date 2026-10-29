// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { contentSecurityPolicy, buildCsp } from "../../vite.config.js";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("base64");

/** Run the plugin's generateBundle on one HTML asset; return the new HTML. */
function run(html) {
  const bundle = { "index.html": { type: "asset", fileName: "index.html", source: html } };
  const ctx = {
    error(msg) {
      throw new Error(msg);
    },
  };
  contentSecurityPolicy.generateBundle.call(ctx, {}, bundle);
  return bundle["index.html"].source;
}

function cspOf(html) {
  return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
}

describe("AT-CSP-01 content-security-policy build plugin (INV-20)", () => {
  const page = (script) =>
    '<!doctype html><html><head>\n<!-- <script src="//cdn.example/x.js"></script> -->\n' +
    '<meta charset="UTF-8" />\n<script type="application/ld+json">{"a":1}</script>\n' +
    `<script type="module" crossorigin>${script}</script>\n</head><body></body></html>`;

  it("is build-only", () => {
    expect(contentSecurityPolicy.apply).toBe("build");
  });

  it("hashes the inlined module script only (not JSON-LD, not comments)", () => {
    const code = 'console.log("hi")';
    const csp = cspOf(run(page(code)));
    expect(csp).toContain(`script-src 'sha256-${sha(code)}'`);
    expect(csp).not.toContain(sha('{"a":1}'));
    expect(csp.match(/'sha256-/g).length).toBe(1);
  });

  it("hashes with CR LF normalized to LF, like the HTML parser", () => {
    const csp = cspOf(run(page("a();\r\nb();")));
    expect(csp).toContain(`'sha256-${sha("a();\nb();")}'`);
  });

  it("places the meta right after <meta charset>, before any script", () => {
    const html = run(page("x()"));
    const csp = html.indexOf("Content-Security-Policy");
    expect(csp).toBeGreaterThan(html.indexOf("<meta charset"));
    expect(csp).toBeLessThan(html.indexOf("<script type="));
  });

  it("fails the build on <script src> (INV-06, INV-07)", () => {
    expect(() =>
      run('<html><head><meta charset="UTF-8"><script src="a.js"></script></head></html>'),
    ).toThrow(/script src/);
  });

  it("has the expected directives", () => {
    const csp = buildCsp(["AAA="]);
    expect(csp).toContain("default-src 'none'");
    // exactly the two origins (SC-28): nothing else can be fetched
    expect(csp).toMatch(/(^|; )connect-src https:\/\/www\.plantuml\.com https:\/\/api\.github\.com(;|$)/);
    expect(csp).toContain("img-src 'self' data: blob: https://www.plantuml.com https:");
    expect(csp).toContain("font-src data:");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  });
});
