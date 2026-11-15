// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { parseAst } from "vite";
import { checkPuritySource } from "./helpers/purityCheck.js";
import { listFiles } from "./helpers/listFiles.js";
import {
  COMMENT_ITEMS,
  citedIds,
  collectSpecIds,
  commentLines,
  countByFile,
  countSentences,
  extractComments,
  judgeComment,
  literalRanges,
  lowerBaseline,
  maskRanges,
  planBaseline,
  ratchetFalls,
  ratchetRises,
  segmentsOf,
  specIdExists,
} from "./helpers/commentCheck.js";

// Spec: 5.16.3, AT-CMT-01, AT-CMT-02, AT-CMT-03, AT-CMT-04, AT-CMT-05, AT-CMT-06, AT-CMT-07, AT-CMT-08, AT-CMT-09.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const BASELINE_PATH = resolve(here, "fixtures/commentBaseline.json");
const SPEC_FILES = ["grsmd_gen2_spec_ja.md", "gen2_prerelease_test_spec_ja.md", "grsmd_launcher_spec_en.md"];
const SCOPE_DIRS = ["src", "tools", "e2e"];
// Why: The generated file follows its generator, as in the R7 exclusion table.
const EXCLUDED = new Set(["src/js/fileTypes.js"]);

/**
 * @param {string} src
 * @returns {{line: number, text: string}[]} the comments of one source
 */
function commentsOf(src) {
  return extractComments(maskRanges(src, literalRanges(parseAst(src))));
}

/**
 * Summary: The function shall return the comment violations of one source, with the @purity violations of AT-PUR-01 when the file is product code.
 * @param {string} src
 * @param {ReturnType<typeof collectSpecIds>} known
 * @param {boolean} isProduct true for a file under src/js
 * @returns {{line: number, item: string, reason: string}[]}
 */
function scanSource(src, known, isProduct) {
  const out = [];
  for (const comment of commentsOf(src)) {
    for (const v of judgeComment(comment.text, known)) out.push({ line: comment.line, ...v });
  }
  if (isProduct) {
    for (const v of checkPuritySource(src).violations) out.push({ line: v.line, item: "purity", reason: `${v.name}: ${v.reason}` });
  }
  return out;
}

const known = collectSpecIds(SPEC_FILES.map((name) => readFileSync(resolve(repoRoot, "spec", name), "utf8")));
const KNOWN_FIXTURE = collectSpecIds([
  "| INV-78 | UTF-8 |\n### PRT-U07: y\n#### 5.14.3 z\n**11-c a**\n| AT-PUR | b | c | d | 01-04 |\n",
]);
const items = (text) => judgeComment(text, KNOWN_FIXTURE).map((v) => v.item);

describe("Comment lint (R3 Comments, spec 5.16.3)", () => {
  describe("AT-CMT-01 R3 Comments (kinds): a comment starts with a kind", () => {
    it.each([
      ["Why", "// Why: The API allows 10 calls per second."],
      ["Spec", "// Spec: INV-78."],
      ["Section", "// Section: rendering"],
      ["Consistency", "// Consistency: the document"],
      ["JSDoc with tags only", "/**\n * Spec: INV-78.\n * @param {number} pos\n * @purity non-pure\n */"],
      ["JSDoc that starts with a tag", "/** @type {number} */"],
      ["JSDoc typedef", "/** @typedef {object} Foo */"],
      ["JSDoc template", "/**\n * @template T\n * @param {T} value\n */"],
      ["continuation lines", "// Why: The first line\n// goes on here."],
      ["tool directive", "// @vitest-environment node"],
      ["tool directive and a kind on the next line", "// @vitest-environment node\n// Why: The test reads files."],
      ["empty line comment", "//"],
      ["empty block comment", "/**/"],
      ["empty JSDoc", "/** */"],
    ])("passes: %s", (_name, text) => {
      expect(items(text)).not.toContain("kind");
    });

    it.each([
      ["plain sentence", "// add tax"],
      ["lower-case kind", "// why: no reason"],
      ["kind without colon", "// Spec INV-78"],
      ["JSDoc description first", "/**\n * Doc.\n * @purity pure\n */"],
      ["unlisted JSDoc tag", "/** @see Foo */"],
      ["tag-like prefix of a kind", "/** @types {number} */"],
      ["hyphen after a tag", "// @type-ish thing"],
      ["hyphen after @purity", "/** @purity-x pure */"],
      ["hyphen after a tool directive", "// @vitest-environment-x node"],
      ["tool directive and plain words on the next line", "// @vitest-environment node\n// plain words"],
      ["section rule", "// ---- regular expressions ----"],
    ])("reports: %s", (_name, text) => {
      expect(items(text)).toContain("kind");
    });
  });

  describe("AT-CMT-02 R3 Comments (kinds): a comment is English, read as ASCII", () => {
    // Why: The test file stays ASCII (AT-STA-20), so the code builds the e-acute character.
    const eAcute = String.fromCharCode(0xe9);

    it("passes an ASCII comment", () => {
      expect(items("// Why: plain ASCII text.")).not.toContain("english");
    });

    it("reports a character outside ASCII", () => {
      expect(items(`// Why: caf${eAcute} text.`)).toContain("english");
    });

    it("reports a character outside ASCII on the line after a tool directive", () => {
      expect(items(`// @vitest-environment node\n// Why: caf${eAcute}.`)).toContain("english");
    });
  });

  describe("AT-CMT-03 R3 Comments (Spec): every cited ID exists in the three spec files", () => {
    it("collects spec IDs, section numbers and AT families, and no other hyphenated words", () => {
      expect([...KNOWN_FIXTURE.ids].sort()).toEqual(["AT-PUR", "INV-78", "PRT-U07"]);
      expect([...KNOWN_FIXTURE.sections].sort()).toEqual(["11-c", "5.14.3"]);
      expect([...KNOWN_FIXTURE.atFamilies]).toEqual(["AT-PUR"]);
    });

    it("reads spec IDs and section numbers but not versions, code spans or other hyphenated words", () => {
      expect(citedIds("INV-78, 5.14.3 and 11-c; v2.51 `FS-99` UTF-8 SHA-256 XINV-1.")).toEqual(["INV-78", "5.14.3", "11-c"]);
    });

    it("accepts an AT ID whose family the AT table lists", () => {
      expect(specIdExists("AT-PUR-03", KNOWN_FIXTURE)).toBe(true);
      expect(specIdExists("AT-XYZ-03", KNOWN_FIXTURE)).toBe(false);
    });

    it.each([
      ["requirement ID", "// Spec: INV-78."],
      ["test spec ID", "// Spec: PRT-U07."],
      ["section numbers", "// Spec: 5.14.3 and 11-c."],
      ["AT ID by family", "// Spec: AT-PUR-04."],
    ])("passes: %s", (_name, text) => {
      expect(items(text)).not.toContain("spec-id");
    });

    it.each([
      ["unknown ID", "// Spec: INV-9999."],
      ["unknown section", "// Spec: 9.99.9."],
      ["no ID", "// Spec: the search panel."],
      ["a word the spec holds but no spec ID", "// Spec: UTF-8."],
      ["other hyphenated words", "// Spec: SHA-256, BSD-3-Clause."],
      ["a ruling mark", "// Spec: D40."],
    ])("reports: %s", (_name, text) => {
      expect(items(text)).toContain("spec-id");
    });

    it("finds the IDs that the comments cite today in the real spec files", () => {
      expect(specIdExists("INV-78", known)).toBe(true);
      expect(specIdExists("PRT-U07", known)).toBe(true);
      expect(specIdExists("AT-PUR-01", known)).toBe(true);
      expect(specIdExists("5.16.2", known)).toBe(true);
      expect(specIdExists("11-c", known)).toBe(true);
      expect(specIdExists("UTF-8", known)).toBe(false);
    });
  });

  describe("AT-CMT-04 R3 Comments (Summary): at most 3 sentences, and 2 or more need Temporary", () => {
    it("counts sentences without breaking at dots inside words, numbers, code, quotes or e.g.", () => {
      expect(countSentences("When x is 1.5, f shall read main.js, e.g. a file.")).toBe(1);
      expect(countSentences("When a, f shall b. If c, then f shall d! Is e?")).toBe(3);
      expect(countSentences("f shall return `a. b. c.` here")).toBe(1);
      expect(countSentences('f shall accept nested marks ("- > $$", "1. - $$").')).toBe(1);
    });

    it.each([
      ["one sentence", "// Summary: When the file exists, f shall return it."],
      ["three sentences with Temporary", "// Summary: When a, f shall b.\n// If c, then f shall d.\n// If e, then f shall g.\n// Temporary: The summary is long. Until: The spec holds it."],
    ])("passes: %s", (_name, text) => {
      expect(items(text)).not.toContain("summary");
    });

    it.each([
      ["two sentences without Temporary", "// Summary: When a, f shall b. If c, then f shall d."],
      ["four sentences", "// Summary: A. B. C. D.\n// Temporary: Long. Until: Split."],
    ])("reports: %s", (_name, text) => {
      expect(items(text)).toContain("summary");
    });
  });

  describe("AT-CMT-05 R3 Comments (Temporary): Temporary holds Until:", () => {
    it("passes a Temporary with Until:", () => {
      expect(items("// Temporary: The cache is off. Until: The spec defines it.")).not.toContain("temporary");
    });

    it.each([
      ["no Until", "// Temporary: The cache is off."],
      ["empty Until", "// Temporary: The cache is off. Until:"],
    ])("reports: %s", (_name, text) => {
      expect(items(text)).toContain("temporary");
    });
  });

  describe("AT-CMT-06 R7 `@purity` Tag: the lint reuses the AT-PUR-01 checker for src/js", () => {
    it("passes a tagged function in product code", () => {
      const src = "/**\n * Spec: INV-78.\n * @purity pure\n */\nexport function f() { return 1; }\n";
      expect(scanSource(src, KNOWN_FIXTURE, true)).toEqual([]);
    });

    it("reports a function without a tag in product code, and not in test code", () => {
      const src = "/** Spec: INV-78. */\nexport function f() { return 1; }\n";
      expect(scanSource(src, KNOWN_FIXTURE, true).map((v) => v.item)).toEqual(["purity"]);
      expect(scanSource(src, KNOWN_FIXTURE, false)).toEqual([]);
    });
  });

  describe("AT-CMT-07 the extractor masks literals and joins adjacent // lines", () => {
    it("skips // and /* inside strings, templates and regex literals", () => {
      const src = 'const a = "x // y";\nconst b = `p /* q ${a} r`;\nconst c = /\\/\\/*/g;\n';
      expect(commentsOf(src)).toEqual([]);
    });

    it("keeps a comment inside a template expression", () => {
      const src = "const a = `p ${/* Why: here */ 1} q`;\n";
      expect(commentsOf(src)).toEqual([{ line: 1, text: "/* Why: here */" }]);
    });

    it("skips the hashbang line, also when it holds //", () => {
      const src = "#!/usr/bin/env -S node --x=//y\n// Why: here\nexport const a = 1;\n";
      expect(commentsOf(src)).toEqual([{ line: 2, text: "// Why: here" }]);
      expect(extractComments("#!/usr/bin/env node //x")).toEqual([]);
    });

    it("joins own-line // comments on adjacent lines and keeps line numbers", () => {
      const src = "/**\n * Spec: INV-78.\n */\nconst a = 1; // Why: trailing\n// Why: one\n//   two\n\n// Why: three\n";
      expect(commentsOf(src)).toEqual([
        { line: 1, text: "/**\n * Spec: INV-78.\n */" },
        { line: 4, text: "// Why: trailing" },
        { line: 5, text: "// Why: one\n//   two" },
        { line: 8, text: "// Why: three" },
      ]);
    });

    it("reads the body lines and kind segments of a comment", () => {
      expect(commentLines("/**\n * Spec: INV-78.\n * @purity pure\n */")).toEqual(["Spec: INV-78.", "@purity pure"]);
      expect(commentLines("/**/")).toEqual([]);
      expect(segmentsOf(["Lead text", "Why: a", "b"])).toEqual({ lead: "Lead text", segments: [{ kind: "Why", text: "a b" }] });
      expect(segmentsOf(["Spec: INV-78. @purity pure"]).segments.map((s) => s.kind)).toEqual(["Spec", "@purity"]);
    });
  });

  describe("AT-CMT-08 the ratchet fails a rise and a fall, and its update only lowers", () => {
    const baseline = { "a.js": { kind: 3 }, "b.js": { "spec-id": 1 } };

    it("passes equal counts", () => {
      expect(ratchetRises(baseline, { "a.js": { kind: 3 }, "b.js": { "spec-id": 1 } })).toEqual([]);
      expect(ratchetFalls(baseline, { "a.js": { kind: 3 }, "b.js": { "spec-id": 1 } })).toEqual([]);
    });

    it("reports a rise, a new item in a known file, and any violation in a new file", () => {
      expect(ratchetRises(baseline, { "a.js": { kind: 4, summary: 1 }, "new.js": { kind: 1 } })).toEqual([
        { file: "a.js", item: "kind", base: 3, now: 4 },
        { file: "a.js", item: "summary", base: 0, now: 1 },
        { file: "new.js", item: "kind", base: 0, now: 1 },
      ]);
    });

    it("reports a fall, also for a file with no violations left or a file that is gone", () => {
      expect(ratchetFalls(baseline, { "a.js": { kind: 2 } })).toEqual([
        { file: "a.js", item: "kind", base: 3, now: 2 },
        { file: "b.js", item: "spec-id", base: 1, now: 0 },
      ]);
    });

    it("lowers the counts and never raises them", () => {
      expect(lowerBaseline(baseline, { "a.js": { kind: 5 }, "b.js": { "spec-id": 0 }, "new.js": { kind: 2 } })).toEqual({ "a.js": { kind: 3 } });
      expect(lowerBaseline(baseline, { "a.js": { kind: 1 } })).toEqual({ "a.js": { kind: 1 } });
    });

    it("update lowers an existing JSON and refuses to run without one", () => {
      expect(planBaseline("update", baseline, { "a.js": { kind: 1 } })).toEqual({ write: { "a.js": { kind: 1 } }, error: null });
      expect(planBaseline("update", null, { "a.js": { kind: 1 } }).write).toBeNull();
      expect(planBaseline("update", null, { "a.js": { kind: 1 } }).error).toMatch(/create/);
    });

    it("create writes the current counts only when no JSON exists", () => {
      expect(planBaseline("create", null, { "b.js": { kind: 2 }, "a.js": { kind: 1, summary: 0 } })).toEqual({ write: { "a.js": { kind: 1 }, "b.js": { kind: 2 } }, error: null });
      expect(planBaseline("create", baseline, { "a.js": { kind: 9 } }).write).toBeNull();
      expect(planBaseline("create", baseline, { "a.js": { kind: 9 } }).error).toMatch(/update/);
    });

    it("writes nothing without a mode", () => {
      expect(planBaseline(undefined, baseline, { "a.js": { kind: 9 } })).toEqual({ write: null, error: null });
    });

    it("counts violations per file and item", () => {
      expect(countByFile([{ file: "a.js", item: "kind" }, { file: "a.js", item: "kind" }, { file: "b.js", item: "english" }])).toEqual({
        "a.js": { kind: 2 },
        "b.js": { english: 1 },
      });
    });
  });

  it("AT-CMT-09 every file in src, tools and e2e has exactly the ratchet counts of the baseline JSON", () => {
    const files = SCOPE_DIRS.flatMap((dir) => listFiles(resolve(repoRoot, dir), /\.m?js$/))
      .map((full) => relative(repoRoot, full).replace(/\\/g, "/"))
      .filter((file) => !EXCLUDED.has(file));
    expect(files.length).toBeGreaterThan(200);
    const violations = [];
    for (const file of files) {
      const src = readFileSync(resolve(repoRoot, file), "utf8");
      for (const v of scanSource(src, known, file.startsWith("src/js/"))) violations.push({ file, ...v });
    }
    const current = countByFile(violations);
    let baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
    const plan = planBaseline(process.env.GRSMD_COMMENT_BASELINE, baseline, current);
    expect(plan.error).toBeNull();
    if (plan.write) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(plan.write, null, 2)}\n`);
      baseline = plan.write;
    }
    const totals = Object.fromEntries(COMMENT_ITEMS.map(({ key }) => [key, violations.filter((v) => v.item === key).length]));
    console.log(`comment_violations ${JSON.stringify(totals)} files=${files.length}`);
    expect(baseline, "the baseline JSON exists; create it with GRSMD_COMMENT_BASELINE=create").not.toBeNull();
    const rises = ratchetRises(baseline, current).map(({ file, item, base, now }) => {
      const where = violations.filter((v) => v.file === file && v.item === item).map((v) => `${v.line} ${v.reason}`);
      return `${file} ${item}: ${base} -> ${now} (${where.join("; ")})`;
    });
    expect(rises, "a count rose above the baseline JSON; fix the new comments").toEqual([]);
    const falls = ratchetFalls(baseline, current).map(({ file, item, base, now }) => `${file} ${item}: ${base} -> ${now}`);
    expect(falls, "a count fell below the baseline JSON; run this test with GRSMD_COMMENT_BASELINE=update").toEqual([]);
  });
});
