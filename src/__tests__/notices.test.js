// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_LICENSES,
  POINTER_COMMENT,
  assertCommentSafe,
  checkMarks,
  collectNotices,
  contributes,
  excerptOf,
  fontLicenseOf,
  formatHelpList,
  formatNotices,
  isLicenseFileName,
  legalCommentOf,
  marksOf,
  packageOfModuleId,
  stampNotices,
  uncomment,
  verdictOf,
} from "../../tools/notices.mjs";
import { EMBEDDED, IGNORED_MARKS, OFL_TEXT, PACKAGE_OVERRIDES } from "../../tools/third-party-extras.mjs";
import config, { contentSecurityPolicy, thirdPartyNotices } from "../../vite.config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NM = "/p/node_modules";
const MIT = "MIT License\n\nCopyright (c) 2020 Someone\n\nPermission is hereby granted...";

/** A file system over a {path: content} map; list() gives the names in a folder. */
function fakeFs(files) {
  return {
    readText(path) {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path];
    },
    readBytes(path) {
      return files[path];
    },
    list(dir) {
      const prefix = `${dir}/`;
      return Object.keys(files)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
    },
  };
}

const pkg = (name, version, license) => JSON.stringify({ name, version, license });
const none = { embedded: [], ignored: [], overrides: {}, helpers: [], ofl: { file: "ofl/OFL.txt" } };

/** One bundled package "a" with the given files under its root. */
function run({ files = {}, modules, extras = none }) {
  return collectNotices({
    modules: modules ?? [{ id: `${NM}/a/index.js`, renderedLength: 10 }],
    nodeModules: NM,
    fs: fakeFs({
      [`${NM}/a/package.json`]: pkg("a", "1.0.0", "MIT"),
      [`${NM}/a/LICENSE`]: MIT,
      [`${NM}/a/index.js`]: "export const a = 1;",
      ...files,
    }),
    extras,
  });
}

describe("AT-OSS-01 which packages count (spec A.2)", () => {
  it("takes the package from the last node_modules segment (nested copies are their own)", () => {
    expect(packageOfModuleId("C:\\w\\node_modules\\d3-sankey\\node_modules\\d3-array\\src\\x.js")).toEqual({
      root: "C:/w/node_modules/d3-sankey/node_modules/d3-array",
      name: "d3-array",
    });
    expect(packageOfModuleId("/w/node_modules/@scope/pkg/dist/a.mjs?commonjs")).toEqual({
      root: "/w/node_modules/@scope/pkg",
      name: "@scope/pkg",
    });
    expect(packageOfModuleId("/w/src/js/main.js")).toBeNull();
  });

  it("counts a module with rendered code, and CSS (rendered as 0)", () => {
    expect(contributes("/a.js", 1)).toBe(true);
    expect(contributes("/a.js", 0)).toBe(false);
    expect(contributes("/katex.min.css", 0)).toBe(true);
  });

  it("knows the license file names", () => {
    for (const name of ["LICENSE", "LICENSE.md", "license.txt", "LICENCE", "COPYING", "NOTICE", "license"]) {
      expect(isLicenseFileName(name), name).toBe(true);
    }
    for (const name of ["LICENSE-MPL", "license-update.mjs", "README.md", "THIRD-PARTY-LICENSE"]) {
      expect(isLicenseFileName(name), name).toBe(false);
    }
  });

  it("reads the package's license files, and a NOTICE with them", () => {
    const { entries, problems } = run({ files: { [`${NM}/a/NOTICE`]: "Notice text" } });
    expect(problems).toEqual([]);
    expect(entries).toEqual([{ name: "a", version: "1.0.0", license: "MIT", note: undefined, texts: [MIT, "Notice text"] }]);
  });

  it("skips modules without code, and the app's own files", () => {
    const { entries } = run({
      modules: [
        { id: `${NM}/a/index.js`, renderedLength: 0 },
        { id: "/p/src/js/main.js", renderedLength: 99 },
      ],
    });
    expect(entries).toEqual([]);
  });
});

describe("AT-OSS-02 the build fails instead of leaving a notice out (INV-75)", () => {
  it("a license outside ALLOWED_LICENSES (GPL), or none", () => {
    expect(run({ files: { [`${NM}/a/package.json`]: pkg("a", "1.0.0", "GPL-3.0-only") } }).problems[0]).toMatch(/GPL-3.0-only.*not allowed/);
    expect(run({ files: { [`${NM}/a/package.json`]: pkg("a", "1.0.0") } }).problems[0]).toMatch(/undefined.*not allowed/);
    for (const copyleft of ["GPL-2.0", "LGPL-3.0", "AGPL-3.0", "MPL-2.0"]) expect(ALLOWED_LICENSES.has(copyleft)).toBe(false);
  });

  it("no license text", () => {
    const fs = fakeFs({ [`${NM}/a/package.json`]: pkg("a", "1.0.0", "MIT"), [`${NM}/a/index.js`]: "" });
    const r = collectNotices({ modules: [{ id: `${NM}/a/index.js`, renderedLength: 1 }], nodeModules: NM, fs, extras: none });
    expect(r.problems[0]).toMatch(/no license text found/);
  });

  it("an override whose package.json license has changed", () => {
    const extras = { ...none, overrides: { a: { published: "(MPL-2.0 OR Apache-2.0)", license: "Apache-2.0" } } };
    expect(run({ extras }).problems[0]).toMatch(/expects "\(MPL-2.0 OR Apache-2.0\)"/);
  });

  it("a virtual module the bundler adds that is not listed", () => {
    const r = run({ modules: [{ id: "\0rolldown/new-helper.js", renderedLength: 5 }] });
    expect(r.problems[0]).toMatch(/not in BUILD_HELPERS/);
  });

  it("third-party code inside a dist that the list does not have (all three marks)", () => {
    const source = [
      "// node_modules/.pnpm/hidden@1.0.0/node_modules/hidden/lib/x.js",
      'var z = require("zlib-copy/lib/deflate.js");',
      "/*! tiny-lib (c) Somebody, MIT */",
    ].join("\n");
    const r = run({ files: { [`${NM}/a/index.js`]: source } });
    expect(r.problems).toEqual([
      'a: unlisted paths mark "hidden" (add it to tools/third-party-extras.mjs)',
      'a: unlisted requires mark "zlib-copy" (add it to tools/third-party-extras.mjs)',
      'a: unlisted legal mark "tiny-lib (c) Somebody, MIT" (add it to tools/third-party-extras.mjs)',
    ]);
  });

  it("a require of another bundled package is not a mark", () => {
    const r = run({
      modules: [
        { id: `${NM}/a/index.js`, renderedLength: 1 },
        { id: `${NM}/b/index.js`, renderedLength: 1 },
      ],
      files: {
        [`${NM}/a/index.js`]: 'module.exports = require("b");',
        [`${NM}/b/package.json`]: pkg("b", "2.0.0", "ISC"),
        [`${NM}/b/LICENSE`]: "ISC text",
        [`${NM}/b/index.js`]: "",
      },
    });
    expect(r.problems).toEqual([]);
  });

  it("a listed entry or ignored mark that is no longer found (stale list)", () => {
    const extras = {
      ...none,
      embedded: [{ name: "gone", license: "MIT", host: "a", paths: ["gone"], texts: [{ pending: "x" }] }],
      ignored: [{ host: "a", legal: ["Old header"], why: "own" }, { host: "zz", contains: ["x"], why: "other" }],
    };
    expect(run({ extras }).problems).toEqual([
      'a (gone): paths mark "gone" is no longer found',
      'a (own): legal mark "Old header" is no longer found',
      "zz (other): the host package is no longer bundled",
    ]);
  });

  it("a listed version that the pnpm path comments contradict (a saved text left behind)", () => {
    const source = "// node_modules/.pnpm/hidden@2.0.0/node_modules/hidden/x.js\nvar x;";
    const extras = { ...none, embedded: [{ name: "hidden", version: "1.0.0", license: "MIT", host: "a", paths: ["hidden"], texts: [{ pending: "x" }] }] };
    expect(run({ files: { [`${NM}/a/index.js`]: source }, extras }).problems).toEqual([
      "a (hidden): the bundled hidden is 2.0.0, the list says 1.0.0",
    ]);
  });

  it("a text that would end the comment", () => {
    const r = run({ files: { [`${NM}/a/LICENSE`]: "MIT --> <script>" } });
    expect(r.problems[0]).toMatch(/"-->" would break the notices comment/);
  });
});

describe("AT-OSS-03 listed embedded code, overrides and pending texts", () => {
  const source = "// node_modules/hidden/x.js\nvar x = 1;\n/*! Hidden 1.0 | Copyright (c) Ann */";
  const embedded = [
    {
      name: "hidden",
      version: "1.0.0",
      license: "(MIT AND Zlib)",
      host: "a",
      paths: ["hidden"],
      legal: ["Hidden 1.0"],
      texts: [{ file: "a/index.js", legal: "Hidden 1.0" }, { pending: "Q1: no text" }],
    },
  ];

  it("adds the entry with its texts, and reports the pending part", () => {
    const r = run({ files: { [`${NM}/a/index.js`]: source }, extras: { ...none, embedded } });
    expect(r.problems).toEqual([]);
    expect(r.pending).toEqual(["hidden (inside a): Q1: no text"]);
    expect(r.entries[1]).toEqual({
      name: "hidden",
      version: "1.0.0",
      license: "(MIT AND Zlib)",
      note: "inside a",
      texts: ["Hidden 1.0 | Copyright (c) Ann"],
    });
  });

  it("a saved text comes from tools/third-party-licenses/ next to node_modules", () => {
    const saved = [{ ...embedded[0], texts: [{ saved: "hidden-1.0.0/LICENSE", from: "Copyright" }] }];
    const r = run({
      files: { [`${NM}/a/index.js`]: source, "/p/tools/third-party-licenses/hidden-1.0.0/LICENSE": "MIT\nCopyright Ann\nterms" },
      extras: { ...none, embedded: saved },
    });
    expect(r.problems).toEqual([]);
    expect(r.entries[1].texts).toEqual(["Copyright Ann\nterms"]);
  });

  it("a pending text fails a release build and warns in any other; a problem always fails", () => {
    const pending = { problems: [], pending: ["x: Q1"] };
    expect(verdictOf(pending, "release")).toEqual({ error: expect.stringContaining("1 text(s) pending"), warning: null });
    expect(verdictOf(pending, "production")).toEqual({ error: null, warning: expect.stringContaining("x: Q1") });
    expect(verdictOf({ problems: ["p"], pending: [] }, "production").error).toContain("p");
    expect(verdictOf({ problems: [], pending: [] }, "release")).toEqual({ error: null, warning: null });
  });

  it("an override can choose a license, name the text and add one", () => {
    const extras = {
      ...none,
      overrides: {
        a: {
          published: "(MPL-2.0 OR Apache-2.0)",
          license: "Apache-2.0",
          note: "chosen",
          texts: [{ file: "README.md", from: "## License", until: "## End" }],
          addTexts: [{ file: "index.js", legal: "Hidden 1.0" }],
        },
      },
      ignored: [{ host: "a", paths: ["hidden"], legal: ["Hidden 1.0"], why: "own" }],
    };
    const r = run({
      files: {
        [`${NM}/a/package.json`]: pkg("a", "1.0.0", "(MPL-2.0 OR Apache-2.0)"),
        [`${NM}/a/README.md`]: "# a\n## License\nApache text\n## End\nmore",
        [`${NM}/a/index.js`]: source,
      },
      extras,
    });
    expect(r.problems).toEqual([]);
    expect(r.entries[0]).toEqual({
      name: "a",
      version: "1.0.0",
      license: "Apache-2.0",
      note: "chosen",
      texts: ["## License\nApache text", "Hidden 1.0 | Copyright (c) Ann"],
    });
  });

  it("the KaTeX fonts entry comes with the KaTeX CSS, from its .ttf name tables", () => {
    const ttf = readFileSync(join(root, "node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf"));
    const r = collectNotices({
      modules: [{ id: `${NM}/katex/dist/katex.min.css`, renderedLength: 0 }],
      nodeModules: NM,
      fs: fakeFs({
        [`${NM}/katex/package.json`]: pkg("katex", "0.18.11", "MIT"),
        [`${NM}/katex/LICENSE`]: MIT,
        [`${NM}/katex/dist/fonts/KaTeX_Main-Regular.ttf`]: new Uint8Array(ttf),
        [`${NM}/katex/dist/fonts/KaTeX_Main-Regular.woff2`]: "",
        [`${NM}/ofl/OFL.txt`]: "SIL OPEN FONT LICENSE Version 1.1",
      }),
      extras: none,
    });
    expect(r.problems).toEqual([]);
    const fonts = r.entries.find((e) => e.name === "KaTeX fonts");
    expect(fonts.license).toBe("OFL-1.1");
    expect(fonts.version).toBe("0.18.11");
    expect(fonts.texts[0]).toContain("with Reserved Font Name KaTeX_Main.");
    expect(fonts.texts[1]).toBe("SIL OPEN FONT LICENSE Version 1.1");
  });
});

describe("AT-OSS-04 the text helpers", () => {
  it("marksOf finds esbuild path comments, bare requires and legal comments only", () => {
    const source = [
      "// ../../node_modules/.pnpm/langium@4.2.1/node_modules/langium/lib/index.js",
      "var s = 'node_modules/not-a-comment/x';",
      "var p = require('pako/lib/deflate.js'); var q = require('./local');",
      "/*! Bezier. Copyright G. MIT */",
      "/**\n * @license\n * Lodash\n */",
      "/* an ordinary comment */",
    ].join("\n");
    expect(marksOf(source)).toEqual({
      paths: ["langium"],
      requires: ["pako"],
      legal: ["Bezier. Copyright G. MIT", "@license"],
      versions: ["langium@4.2.1"],
    });
  });

  it("marksOf reads scoped and peer-suffixed pnpm versions", () => {
    const source = [
      "// node_modules/.pnpm/@chevrotain+gast@11.1.2/node_modules/@chevrotain/gast/lib/a.js",
      "// node_modules/.pnpm/chevrotain-allstar@0.3.1_chevrotain@11.1.2/node_modules/chevrotain-allstar/lib/b.js",
    ].join("\n");
    expect(marksOf(source).versions).toEqual(["@chevrotain/gast@11.1.2", "chevrotain-allstar@0.3.1"]);
  });

  it("excerptOf and uncomment take lines out of a commented source", () => {
    const text = "a\n// (C) 1995 X\n//\n// 3. This notice may not be removed\nb";
    const part = excerptOf(text, { from: "(C) 1995", to: "3. This notice" });
    expect(uncomment(part)).toBe("(C) 1995 X\n\n3. This notice may not be removed");
    expect(excerptOf("x\ny\nz", { until: "z" })).toBe("x\ny");
    expect(() => excerptOf("x", { from: "nope" })).toThrow(/not found/);
  });

  it("legalCommentOf returns the comment without its syntax", () => {
    expect(legalCommentOf("x /*!\nEvent object, MIT license\n\nhttps://a/\n*/ y", "Event object")).toBe(
      "Event object, MIT license\n\nhttps://a/",
    );
    expect(() => legalCommentOf("/* none */", "Event")).toThrow(/no legal comment/);
  });

  it("fontLicenseOf reads the OFL statement of a KaTeX font", () => {
    const ttf = readFileSync(join(root, "node_modules/katex/dist/fonts/KaTeX_AMS-Regular.ttf"));
    const text = fontLicenseOf(new Uint8Array(ttf));
    expect(text).toContain("Copyright (c) 2009-2010, Design Science, Inc.");
    expect(text).toContain("SIL Open Font License, Version 1.1");
  });

  it("assertCommentSafe refuses what would end or open a comment", () => {
    for (const bad of ["a --> b", "a --!> b", "a <!-- b"]) expect(() => assertCommentSafe(bad, "t")).toThrow();
    expect(() => assertCommentSafe("a -- b ->", "t")).not.toThrow();
  });
});

describe("AT-OSS-05 the notices comment and the help list", () => {
  const entries = [
    { name: "d3-b", version: "3.0.0", license: "ISC", texts: ["ISC\n  text"] },
    { name: "d3-a", version: "3.0.1", license: "ISC", texts: ["ISC text"] },
    { name: "pako", version: "1.0.10", license: "(MIT AND Zlib)", note: "inside x", texts: ["Zlib text", "ISC text"] },
  ];

  it("lists every entry, then each text once under all entries that carry it (white space aside)", () => {
    const text = formatNotices(entries);
    expect(text).toMatch(/^THIRD-PARTY SOFTWARE NOTICES\n/);
    expect(text).toContain("  d3-a 3.0.1 (ISC)\n  d3-b 3.0.0 (ISC)\n  pako 1.0.10 (MIT AND Zlib) -- inside x");
    const groups = text.split(`\n\n${"=".repeat(72)}\n`).slice(1);
    expect(groups).toEqual([
      `d3-a 3.0.1 (ISC)\nd3-b 3.0.0 (ISC)\npako 1.0.10 (MIT AND Zlib)\n${"-".repeat(72)}\nISC text`,
      `pako 1.0.10 (MIT AND Zlib)\n${"-".repeat(72)}\nZlib text`,
    ]);
  });

  it("the help list is sorted, comma-separated and escaped", () => {
    expect(formatHelpList([...entries, { name: "<x>", license: "MIT" }])).toBe(
      "&lt;x&gt; (MIT), d3-a 3.0.1 (ISC), d3-b 3.0.0 (ISC), pako 1.0.10 (MIT AND Zlib)",
    );
  });

  const page =
    '<!doctype html><html><head>\n<meta charset="UTF-8" />\n<script type="module">go()</script></head><body>' +
    '<p class="help-licenses" data-third-party-list></p><p data-third-party-list></p>\n</body>\n</html>';

  it("stampNotices fills both slots, adds the pointer and puts the comment just before </body>", () => {
    const html = stampNotices(page, { notices: "NOTICES", list: "a 1 (MIT)" });
    expect(html.match(/data-third-party-list>a 1 \(MIT\)<\/p>/g)).toHaveLength(2);
    expect(html).toContain(`<meta charset="UTF-8" />\n    ${POINTER_COMMENT}`);
    expect(html.endsWith("<!--\nNOTICES\n-->\n</body>\n</html>")).toBe(true);
  });

  it("stampNotices needs exactly two empty slots and safe text", () => {
    expect(() => stampNotices(page.replace("<p data-third-party-list></p>", ""), { notices: "", list: "" })).toThrow(/found 1/);
    expect(() => stampNotices(page.replace("<p data-third-party-list></p>", "<p data-third-party-list>x</p>"), { notices: "", list: "" })).toThrow(/empty/);
    expect(() => stampNotices(page, { notices: "a-->b", list: "" })).toThrow(/would break/);
  });

  it("the notices do not change the CSP hash (comment and text only)", () => {
    const cspOf = (html) => {
      const bundle = { "index.html": { type: "asset", fileName: "index.html", source: html } };
      contentSecurityPolicy.generateBundle.call({ error: (m) => { throw new Error(m); } }, {}, bundle);
      return /content="([^"]*)"/.exec(bundle["index.html"].source)[1];
    };
    const stamped = stampNotices(page, { notices: "x <script>evil()</script> y", list: "<b>" });
    const sha = createHash("sha256").update("go()", "utf8").digest("base64");
    expect(cspOf(stamped)).toBe(cspOf(page));
    expect(cspOf(stamped)).toContain(`'sha256-${sha}'`);
  });
});

describe("AT-OSS-06 the plugin and the hand-made list", () => {
  it("is build-only and runs after singlefile, before the CSP", () => {
    const plugin = thirdPartyNotices();
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
    const names = config.plugins.flat().map((p) => p.name);
    expect(names.indexOf("third-party-notices")).toBeGreaterThan(names.indexOf("vite:singlefile"));
    expect(names.indexOf("third-party-notices")).toBeLessThan(names.indexOf("content-security-policy"));
  });

  it("every listed license is allowed and every listed file is in node_modules", () => {
    const parts = [
      ...EMBEDDED.flatMap((e) => e.texts.map((t) => ({ ...t, base: "node_modules" }))),
      ...Object.entries(PACKAGE_OVERRIDES).flatMap(([name, o]) =>
        [...(o.texts ?? []), ...(o.addTexts ?? [])].map((t) => ({ ...t, base: `node_modules/${name}` })),
      ),
      { ...OFL_TEXT, base: "node_modules" },
    ];
    for (const e of EMBEDDED) expect(ALLOWED_LICENSES.has(e.license), e.name).toBe(true);
    for (const o of Object.values(PACKAGE_OVERRIDES)) expect(ALLOWED_LICENSES.has(o.license ?? o.published)).toBe(true);
    for (const part of parts.filter((p) => p.file)) {
      expect(existsSync(join(root, part.base, part.file)), part.file).toBe(true);
    }
    for (const part of parts.filter((p) => p.saved)) {
      expect(existsSync(join(root, "tools/third-party-licenses", part.saved)), part.saved).toBe(true);
    }
    // Q1 is answered: no text is pending any more
    expect(parts.filter((p) => p.pending)).toEqual([]);
  });

  it("every saved file is used, and the saved folder says where each came from", () => {
    const saved = new Set(EMBEDDED.flatMap((e) => e.texts.filter((t) => t.saved).map((t) => t.saved)));
    saved.add(OFL_TEXT.saved);
    const readme = readFileSync(join(root, "tools/third-party-licenses/README.md"), "utf8");
    for (const path of saved) expect(readme, path).toContain(`\`${path.split("/")[0]}\``);
    const folders = new Set([...saved].map((p) => p.split("/")[0]));
    for (const folder of readme.match(/`[a-z0-9.@-]+-\d[\w.-]*`/g).map((s) => s.slice(1, -1))) {
      expect(folders.has(folder), folder).toBe(true);
    }
  });

  it("every rule says where its code is, and every ignored mark says why", () => {
    for (const e of EMBEDDED) {
      expect(e.host, e.name).toBeTruthy();
      expect([...(e.paths ?? []), ...(e.requires ?? []), ...(e.legal ?? []), ...(e.contains ?? [])].length, e.name).toBeGreaterThan(0);
    }
    for (const i of IGNORED_MARKS) expect(i.why).toBeTruthy();
  });

  it("checkMarks reports nothing when every mark is covered", () => {
    const marks = new Map([["h", { paths: ["x"], requires: ["y"], legal: ["Z header"], sources: ["has Q"] }]]);
    const rules = { embedded: [{ name: "x", host: "h", paths: ["x"], contains: ["Q"] }], ignored: [{ host: "h", requires: ["y"], legal: ["Z"], why: "w" }] };
    expect(checkMarks(marks, new Set(["h"]), rules)).toEqual([]);
  });
});
