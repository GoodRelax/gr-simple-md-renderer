import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { checkPuritySource } from "./helpers/purityCheck.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcJs = resolve(here, "../js");
const repoRoot = resolve(here, "../..");
const selfRel = relative(repoRoot, fileURLToPath(import.meta.url)).replace(/\\/g, "/");

// AT-PUR-03: the renamed values pass; the old values and near misses fail.
const AT_PUR_03_CASES = [
  ["semi-pure-immutable", true],
  ["semi-pure-mutable", true],
  ["semi-pure-a", false],
  ["semi-pure-b", false],
  ["semi-pure-ab", false],
  ["semi-pure-", false],
  ["semi-pure-immutable-x", false],
  ["pure", true],
  ["non-pure", true],
  ["impure", false],
];

// AT-PUR-04: an old value is "semi-pure-" + "a" or "b" as a whole token.
const OLD_VALUE = /semi-pure-[ab](?![a-z-])/;
// Stage A keeps the upstream standard copy as is; stage B replaces it and drops this entry.
const AT_PUR_04_EXCLUDED = ["spec/upstream_review_standards_ja.md"];

/**
 * List the paths git tracks, relative to the repository root, with "/" separators.
 */
function listTracked() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

/**
 * Blank the AT-PUR-03 table in this file's text, so its old values do not count.
 * The table's newlines stay, so later line numbers stay true.
 * @param {string} text
 */
function withoutAtPur03Table(text) {
  const begin = text.indexOf("const AT_PUR_03_CASES = [");
  const end = text.indexOf("];", begin);
  if (begin < 0 || end < 0) return text;
  const table = text.slice(begin, end + 2).replace(/[^\n]/g, "");
  return text.slice(0, begin) + table + text.slice(end + 2);
}

/**
 * Return the 1-based line numbers that hold an old value.
 * @param {string} text
 * @param {boolean} isSelf true for this file (its AT-PUR-03 table does not count)
 */
function oldValueLines(text, isSelf) {
  const body = isSelf ? withoutAtPur03Table(text) : text;
  const lines = [];
  body.split("\n").forEach((line, i) => {
    if (OLD_VALUE.test(line)) lines.push(i + 1);
  });
  return lines;
}

function listJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listJs(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

describe("@purity tags (CON-15, R7 `@purity` Tag, spec 5.16.2)", () => {
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
      ["class members", `class A {\n${tag("non-pure")}constructor() { this.a = 1; }\n${tag("semi-pure-mutable")}get v() { return this.a; }\n${tag("non-pure")}set v(x) { this.a = x; }\n${tag("pure")}static s() { return 1; }\n}`],
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

  it.each(AT_PUR_03_CASES)("AT-PUR-03 compares the value as a whole token: %s -> %s", (value, ok) => {
    const r = checkPuritySource(`/** @purity ${value} */\nfunction f() {}`);
    expect(r.violations.length === 0).toBe(ok);
  });

  it("AT-PUR-04 no tracked text file holds an old purity value", () => {
    const hits = [];
    for (const rel of listTracked()) {
      if (AT_PUR_04_EXCLUDED.includes(rel)) continue;
      const bytes = readFileSync(join(repoRoot, rel));
      if (bytes.includes(0)) continue;
      for (const line of oldValueLines(bytes.toString("latin1"), rel === selfRel)) hits.push(`${rel}:${line}`);
    }
    expect(hits).toEqual([]);
  });

  it("AT-PUR-04 reports an old value after the AT-PUR-03 table at its real line", () => {
    const old = "semi-pure-" + "a";
    const text = [
      "// line 1",
      "const AT_PUR_03_CASES = [",
      `  ["${old}", false],`,
      '  ["pure", true],',
      "];",
      `/** @purity ${old} */`,
    ].join("\r\n");
    expect(oldValueLines(text, true)).toEqual([6]);
    expect(oldValueLines(text, false)).toEqual([3, 6]);
  });
});
