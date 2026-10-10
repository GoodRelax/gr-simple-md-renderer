import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { checkPuritySource } from "./helpers/purityCheck.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcJs = resolve(here, "../js");

function listJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listJs(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

describe("@purity tags (CON-15, R7.6, spec 5.16.2)", () => {
  it("AT-PUR-01 every function and method in src/js has exactly one valid @purity tag", () => {
    let total = 0;
    let tagged = 0;
    const violations = [];
    for (const file of listJs(srcJs)) {
      const r = checkPuritySource(readFileSync(file, "utf8"));
      total += r.total;
      tagged += r.tagged;
      const rel = relative(srcJs, file).replace(/\\/g, "/");
      for (const v of r.violations) violations.push(`${rel}:${v.line} ${v.name}: ${v.reason}`);
    }
    const pct = total === 0 ? 100 : (tagged / total) * 100;
    console.log(`purity_tag_coverage_pct=${pct.toFixed(1)} (${tagged}/${total})`);
    expect(violations).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  describe("AT-PUR-02 checker self-test", () => {
    const tag = (v) => `/**\n * Doc.\n * @purity ${v}\n */\n`;

    it.each([
      ["function declaration", `${tag("pure")}function f() { return 1; }`],
      ["exported function", `${tag("pure")}export function f() { return 1; }`],
      ["block arrow in const", `${tag("non-pure")}const f = () => { g(); };`],
      ["inline callback, comment on the line before", `${tag("non-pure")}el.on("x", (e) => { g(e); });`],
      ["inline callback, comment right before", `el.on("x", /** @purity non-pure */ (e) => { g(e); });`],
      ["class members", `class A {\n${tag("non-pure")}constructor() { this.a = 1; }\n${tag("semi-pure-b")}get v() { return this.a; }\n${tag("non-pure")}set v(x) { this.a = x; }\n${tag("pure")}static s() { return 1; }\n}`],
      ["object method", `const o = {\n${tag("pure")}m() { return 1; },\n};`],
    ])("passes: %s", (_name, src) => {
      const r = checkPuritySource(src);
      expect(r.violations).toEqual([]);
      expect(r.tagged).toBe(r.total);
      expect(r.total).toBeGreaterThan(0);
    });

    it("does not count single-expression arrows", () => {
      expect(checkPuritySource("const f = (x) => x + 1;").total).toBe(0);
    });

    it("counts block arrows, getters, setters and constructors", () => {
      const src = "class A { constructor() {} get a() { return 1; } set a(v) {} }\nconst f = () => {};";
      const r = checkPuritySource(src);
      expect(r.total).toBe(4);
      expect(r.violations).toHaveLength(4);
    });

    it.each([
      ["missing tag", "/** Doc only. */\nfunction f() {}", "0 @purity tags"],
      ["two tags", "/**\n * @purity pure\n * @purity non-pure\n */\nfunction f() {}", "2 @purity tags"],
      ["invalid value", "/** @purity semi-pure */\nfunction f() {}", 'invalid value "semi-pure"'],
      ["no JSDoc", "function f() {}", "no JSDoc"],
      ["plain block comment", "/* @purity pure */\nfunction f() {}", "no JSDoc"],
      ["comment belongs to an earlier statement", "/** @purity pure */\nconst a = 1;\nfunction f() {}", "no JSDoc"],
      ["outer method tag does not cover an inner callback", `${tag("non-pure")}function f() { el.on("x", () => { g(); }); }`, "no JSDoc"],
    ])("reports: %s", (_name, src, reason) => {
      const r = checkPuritySource(src);
      expect(r.violations.map((v) => v.reason)).toContain(reason);
    });
  });

  it.each([
    ["semi-pure-ab", false],
    ["semi-pure-a", true],
    ["semi-pure-b", true],
    ["semi-pure-", false],
    ["non-pure", true],
    ["impure", false],
  ])("AT-PUR-03 compares the value as a whole token: %s -> %s", (value, ok) => {
    const r = checkPuritySource(`/** @purity ${value} */\nfunction f() {}`);
    expect(r.violations.length === 0).toBe(ok);
  });
});
