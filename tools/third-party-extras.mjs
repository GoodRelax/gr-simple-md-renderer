// The hand-made part of the third-party notices (tools/notices.mjs). Each list
// is checked against the bundle on every build: an unlisted mark, dependency
// or prebuilt dist, or a listed one that no longer applies, fails the build,
// so this file has to follow the dependencies. Text sources (never the
// network):
//   { file, from?, to?, until?, uncomment? }  lines of a file in node_modules
//                                             (to: inclusive, until: exclusive)
//   { saved, from?, to?, until? }             the same, of a file in
//                                             tools/third-party-licenses/
//   { file, legal }                           the legal comment starting so
//   { pending }                               no text yet: a release build
//                                             fails while one is left

/**
 * Packages whose package.json or license files need help. `published` is
 * package.json's license field as it must be for the override to apply: a
 * string, or null when the package has no license field. A different value
 * (an upstream license change) fails the build. Without `texts` the package's
 * own license files are used; `addTexts` are appended.
 */
export const PACKAGE_OVERRIDES = {
  dompurify: {
    published: "(MPL-2.0 OR Apache-2.0)",
    license: "Apache-2.0",
    note: "Apache-2.0 chosen from (MPL-2.0 OR Apache-2.0)",
    // LICENSE is the Apache-2.0 text; the copyright line is in the dist header.
    addTexts: [{ file: "dist/purify.es.mjs", legal: "@license DOMPurify" }],
  },
  fastdom: {
    published: "MIT",
    // No license file: the README's License section holds the MIT text.
    texts: [{ file: "README.md", from: "(The MIT License)" }],
  },
  khroma: {
    published: null,
    // package.json has no license field; the license file is the MIT text.
    license: "MIT",
  },
  rolldown: {
    published: "MIT",
    // THIRD-PARTY-LICENSE holds rollup's and esbuild's MIT texts, in two
    // parts so that the esbuild helper entry shares the second.
    texts: [
      { file: "LICENSE" },
      { file: "THIRD-PARTY-LICENSE", until: "---" },
      { file: "THIRD-PARTY-LICENSE", from: "Copyright (c) 2020 Evan Wallace" },
    ],
  },
  vite: {
    published: "MIT",
    // LICENSE.md goes on with the licenses of Vite's own (Node-side) bundled
    // dependencies, none of which is in the page. Only the core part.
    texts: [{ file: "LICENSE.md", from: "MIT License", until: "# Licenses of bundled dependencies" }],
  },
};

/** Code that the bundler adds to the page (virtual modules). */
export const BUILD_HELPERS = [
  { id: "\0rolldown/runtime.js", package: "rolldown" },
  { id: "\0vite/modulepreload-polyfill.js", package: "vite" },
  { id: "\0vite/preload-helper.js", package: "vite" },
];

const CYTOSCAPE = "cytoscape/dist/cytoscape.esm.mjs";
// The MIT permission and disclaimer, for notices in code that name the
// copyright holder and "MIT" but do not carry the text.
const MIT_TERMS = { file: "katex/LICENSE", from: "Permission is hereby granted" };
const PARSER = "@mermaid-js/parser";
// Babel's class and destructuring helpers, as they appear in each dist.
const BABEL_CLASS = "Cannot call a class as a function";
const BABEL_DESTRUCTURE = "Invalid attempt to destructure non-iterable";

/**
 * Third-party code inside a bundled package's dist. Each entry names where it
 * is (`in`: one place per host package) and the marks that show it there:
 * paths / requires / legal (see marksOf in tools/notices.mjs), contains (a
 * text in the host's bundled files) and declared (a dependency the host
 * declares that is not a module, because its dist carries it). For code found
 * through pnpm path comments, `versions` must be the version(s) they name.
 * `versions` is left out when the version is not known.
 */
export const EMBEDDED = [
  // @mermaid-js/parser bundles its devDependencies with esbuild.
  { name: "langium", versions: ["4.2.1"], license: "MIT", in: [{ host: PARSER, paths: ["langium"] }], texts: [{ saved: "langium-4.2.1/LICENSE" }] },
  { name: "chevrotain", versions: ["11.1.2"], license: "Apache-2.0", in: [{ host: PARSER, paths: ["chevrotain"] }], texts: [{ saved: "chevrotain-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/gast", versions: ["11.1.2"], license: "Apache-2.0", in: [{ host: PARSER, paths: ["@chevrotain/gast"] }], texts: [{ saved: "chevrotain-gast-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/utils", versions: ["11.1.2"], license: "Apache-2.0", in: [{ host: PARSER, paths: ["@chevrotain/utils"] }], texts: [{ saved: "chevrotain-utils-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/regexp-to-ast", versions: ["11.1.2"], license: "Apache-2.0", in: [{ host: PARSER, paths: ["@chevrotain/regexp-to-ast"] }], texts: [{ saved: "chevrotain-regexp-to-ast-11.1.2/LICENSE.txt" }] },
  { name: "chevrotain-allstar", versions: ["0.3.1"], license: "MIT", in: [{ host: PARSER, paths: ["chevrotain-allstar"] }], texts: [{ saved: "chevrotain-allstar-0.3.1/LICENSE" }] },
  {
    name: "vscode-jsonrpc",
    versions: ["8.2.0"],
    license: "MIT",
    in: [{ host: PARSER, paths: ["vscode-jsonrpc"] }],
    texts: [{ saved: "vscode-jsonrpc-8.2.0/License.txt" }, { saved: "vscode-jsonrpc-8.2.0/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-protocol",
    versions: ["3.17.5"],
    license: "MIT",
    in: [{ host: PARSER, paths: ["vscode-languageserver-protocol"] }],
    texts: [{ saved: "vscode-languageserver-protocol-3.17.5/License.txt" }, { saved: "vscode-languageserver-protocol-3.17.5/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-types",
    versions: ["3.17.5"],
    license: "MIT",
    in: [{ host: PARSER, paths: ["vscode-languageserver-types"] }],
    texts: [{ saved: "vscode-languageserver-types-3.17.5/License.txt" }, { saved: "vscode-languageserver-types-3.17.5/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-textdocument",
    versions: ["1.0.12"],
    license: "MIT",
    in: [{ host: PARSER, paths: ["vscode-languageserver-textdocument"] }],
    texts: [{ saved: "vscode-languageserver-textdocument-1.0.12/License.txt" }, { saved: "vscode-languageserver-textdocument-1.0.12/thirdpartynotices.txt" }],
  },
  { name: "vscode-uri", versions: ["3.1.0"], license: "MIT", in: [{ host: PARSER, paths: ["vscode-uri"] }], texts: [{ saved: "vscode-uri-3.1.0/LICENSE.md" }] },
  {
    name: "lodash-es",
    versions: ["4.17.23", "4.18.1"],
    license: "MIT",
    in: [{ host: PARSER, paths: ["lodash-es"], legal: ["Bundled license information:"] }],
    // The LICENSE of 4.17.23 and 4.18.1 is the same file (byte for byte).
    texts: [{ file: "lodash-es/LICENSE" }],
  },
  // mermaid bundles js-yaml with esbuild.
  { name: "js-yaml", versions: ["4.3.0"], license: "MIT", in: [{ host: "mermaid", paths: ["js-yaml"] }], texts: [{ saved: "js-yaml-4.3.0/LICENSE" }] },
  // plantuml-encoder is a browserify bundle that includes pako's deflate.
  {
    name: "pako",
    versions: ["1.0.10"],
    license: "(MIT AND Zlib)",
    in: [{ host: "plantuml-encoder", requires: ["pako"] }],
    texts: [
      { saved: "pako-1.0.10/LICENSE" },
      {
        file: "plantuml-encoder/dist/plantuml-encoder.js",
        from: "// (C) 1995-2013 Jean-loup Gailly and Mark Adler",
        to: "// 3. This notice may not be removed",
        uncomment: true,
      },
    ],
  },
  // roughjs's bundled/rough.esm.js (rollup + terser) carries its four
  // dependencies; it has no imports. The versions are the installed ones: the
  // version roughjs bundled is not known (spec A.2).
  { name: "path-data-parser", versions: ["0.1.0"], license: "MIT", in: [{ host: "roughjs", declared: ["path-data-parser"], contains: ["A:7,a:7,C:6"] }], texts: [{ file: "path-data-parser/LICENSE" }] },
  { name: "points-on-curve", versions: ["0.2.0"], license: "MIT", in: [{ host: "roughjs", declared: ["points-on-curve"] }], texts: [{ file: "points-on-curve/LICENSE" }] },
  { name: "points-on-path", versions: ["0.2.1"], license: "MIT", in: [{ host: "roughjs", declared: ["points-on-path"] }], texts: [{ file: "points-on-path/LICENSE" }] },
  { name: "hachure-fill", versions: ["0.5.2"], license: "MIT", in: [{ host: "roughjs", declared: ["hachure-fill"] }], texts: [{ file: "hachure-fill/LICENSE" }] },
  // cytoscape's rollup bundle includes these.
  { name: "lodash (debounce and others)", license: "MIT", in: [{ host: "cytoscape", contains: ["__lodash_hash_undefined__"] }], texts: [{ file: "lodash-es/LICENSE" }] },
  // heap's LICENSE has no copyright line; it is shown as published.
  { name: "heap", versions: ["0.2.7"], license: "MIT", in: [{ host: "cytoscape", contains: ["nlargest = function(array, n, cmp)"] }], texts: [{ saved: "heap-0.2.7/LICENSE" }] },
  {
    name: "jQuery event object (adapted)",
    license: "MIT",
    in: [{ host: "cytoscape", legal: ["Event object based on jQuery events"] }],
    // The jQuery version it was adapted from is not known; jQuery 3.7.1's LICENSE.
    texts: [{ file: CYTOSCAPE, legal: "Event object based on jQuery events" }, { saved: "jquery-3.7.1/LICENSE.txt" }],
  },
  {
    name: "Embeddable Minimum Strictly-Compliant Promises/A+ 1.1.1 Thenable",
    license: "MIT",
    in: [{ host: "cytoscape", legal: ["Embeddable Minimum Strictly-Compliant Promises/A+"] }],
    texts: [{ file: CYTOSCAPE, legal: "Embeddable Minimum Strictly-Compliant Promises/A+" }, MIT_TERMS],
  },
  {
    name: "Bezier curve function generator",
    license: "MIT",
    in: [{ host: "cytoscape", legal: ["Bezier curve function generator."] }],
    texts: [{ file: CYTOSCAPE, legal: "Bezier curve function generator." }, MIT_TERMS],
  },
  {
    name: "Runge-Kutta spring physics function generator",
    license: "MIT",
    in: [{ host: "cytoscape", legal: ["Runge-Kutta spring physics function generator."] }],
    texts: [{ file: CYTOSCAPE, legal: "Runge-Kutta spring physics function generator." }, MIT_TERMS],
  },
  // cytoscape's WebGL renderer carries gl-matrix (its devDependency,
  // ^3.4.3). The version it bundled is not known (spec A.2); the LICENSE is
  // gl-matrix 3.4.4's.
  {
    name: "gl-matrix",
    license: "MIT",
    in: [{ host: "cytoscape", contains: ["@module glMatrix"] }],
    texts: [{ saved: "gl-matrix-3.4.4/LICENSE.md" }],
  },
  // @upsetjs/venn.js's rollup bundle carries fmin 0.0.4 (its devDependency,
  // with a yarn patch of venn.js's own).
  {
    name: "fmin",
    versions: ["0.0.4"],
    license: "BSD-3-Clause",
    in: [{ host: "@upsetjs/venn.js", contains: ["nonZeroDelta"] }],
    texts: [{ saved: "fmin-0.0.4/LICENSE" }],
  },
  // Helpers that other tools put into a dist (ruling Q2 and Q-C).
  {
    name: "Babel helpers",
    license: "MIT",
    in: [
      { host: "dompurify", legal: ["regenerator-runtime -- Copyright"], contains: [BABEL_DESTRUCTURE] },
      { host: "cytoscape", contains: [BABEL_CLASS, BABEL_DESTRUCTURE] },
      { host: "cytoscape-fcose", contains: [BABEL_CLASS, BABEL_DESTRUCTURE] },
      { host: "layout-base", contains: [BABEL_CLASS] },
    ],
    texts: [{ file: "dompurify/dist/purify.es.mjs", legal: "regenerator-runtime" }, { saved: "babel-helpers-7.29.10/LICENSE" }],
  },
  {
    name: "webpack runtime",
    license: "MIT",
    // The dists were built with webpack 2 (^2.6.1: layout-base, cose-base 1,
    // cytoscape-cose-bilkent) and 5 (^5.36.1 / ^5.37.0: cose-base 2,
    // cytoscape-fcose); the exact versions are not known (spec A.2). The two
    // LICENSE files differ only in line endings.
    in: ["layout-base", "cose-base", "cytoscape-cose-bilkent", "cytoscape-fcose"].map((host) => ({ host, contains: ["__webpack_require__"] })),
    texts: [{ saved: "webpack-2.7.0/LICENSE" }, { saved: "webpack-5.112.2/LICENSE" }],
  },
  {
    name: "browserify prelude (browser-pack)",
    license: "MIT",
    in: [{ host: "plantuml-encoder", contains: ['"function"==typeof require&&require'] }],
    // browserify ^16.x uses browser-pack ^6.0.1; the exact version is not
    // known. Its LICENSE has no copyright line; it is shown as published.
    texts: [{ saved: "browser-pack-6.1.0/LICENSE" }],
  },
  {
    name: "esbuild runtime helpers",
    license: "MIT",
    in: [PARSER, "mermaid"].map((host) => ({ host, contains: ["var __defProp = Object.defineProperty"] })),
    texts: [{ file: "rolldown/THIRD-PARTY-LICENSE", from: "Copyright (c) 2020 Evan Wallace" }],
  },
  {
    name: "@rollup/plugin-commonjs helpers",
    license: "MIT",
    // In mermaid they come with its bundled js-yaml dist (built with
    // @rollup/plugin-commonjs 29.0.3); cytoscape's devDependency is ^28.0.2,
    // the exact version is not known (spec A.2). The two LICENSE files are
    // the same bytes.
    in: ["cytoscape", "mermaid"].map((host) => ({ host, contains: ["getDefaultExportFromCjs"] })),
    texts: [{ saved: "rollup-plugin-commonjs-28.0.9/LICENSE" }, { saved: "rollup-plugin-commonjs-29.0.3/LICENSE" }],
  },
  // layout-base 2.x (under cytoscape-fcose) adopts an SVD from JamaJS and
  // carries the Apache-2.0 text with it. That copy differs from the current
  // Apache-2.0 text only in the appendix's placeholder brackets ({} for []),
  // so the license part is the Apache-2.0 text already in the notices.
  {
    name: "JamaJS singular value decomposition (adapted)",
    license: "Apache-2.0",
    in: [{ host: "layout-base", legal: ["Apache License"] }],
    texts: [
      {
        file: "cytoscape-fcose/node_modules/layout-base/layout-base.js",
        from: "Below singular value decomposition (svd) code",
        to: "let is used instead of var",
        uncomment: true,
      },
      { file: "dompurify/LICENSE" },
    ],
  },
];

/** Marks that are not third-party code, with the reason. */
export const IGNORED_MARKS = [
  { host: "marked", legal: ["marked v"], why: "marked's own header (its LICENSE is included)" },
  { host: "mermaid", legal: ["Check if previously processed", "Wait for document loaded"], why: "code comments in /*! form, not notices" },
  { host: "dompurify", legal: ["@license DOMPurify"], why: "DOMPurify's own header (included through PACKAGE_OVERRIDES)" },
  { host: "lodash-es", legal: ["@license"], why: "lodash-es's own header (its LICENSE is included)" },
  { host: "lodash-es", requires: ["util"], why: "the Node.js built-in, required only under Node" },
  { host: "@mermaid-js/parser", requires: ["util"], why: "the Node.js built-in, required only under Node" },
  { host: "cytoscape", legal: ["Copyright (c) 2016-"], why: "cytoscape's own header (its LICENSE is included)" },
  { host: "cytoscape", requires: ["cytoscape-foo"], why: "an example in a doc comment" },
  {
    host: "layout-base",
    legal: ["This class maintains a list of static geometry", "A classic Quicksort algorithm"],
    why: "layout-base's own notices (Copyright: i-Vis Research Group; its LICENSE is included)",
  },
];

/**
 * Dependencies that a bundled package declares but that are not modules of
 * the bundle, and are not inside its dist either, with the reason.
 */
export const IGNORED_DEPENDENCIES = [
  { host: "mermaid", dependency: "@types/d3", why: "type definitions only" },
  { host: PARSER, dependency: "@chevrotain/types", why: "type definitions only" },
  { host: "@iconify/utils", dependency: "@iconify/types", why: "type definitions only" },
  { host: "@iconify/utils", dependency: "@antfu/install-pkg", why: "used by its Node-only icon loader, not by the bundled modules" },
  { host: "@iconify/utils", dependency: "import-meta-resolve", why: "used by its Node-only icon loader, not by the bundled modules" },
  { host: "katex", dependency: "commander", why: "the katex command line tool only" },
  { host: "d3-dsv", dependency: "commander", why: "its command line tools only" },
  { host: "d3-dsv", dependency: "iconv-lite", why: "its command line tools only" },
  { host: "d3-dsv", dependency: "rw", why: "its command line tools only" },
  { host: "d3-delaunay", dependency: "delaunator", why: "only d3-delaunay's index (a re-export) is bundled; the code that uses delaunator is not reached" },
  { host: "fastdom", dependency: "strictdom", why: "only fastdom-strict.js uses it, which is not bundled" },
];

/**
 * What each prebuilt dist in the bundle holds besides its own code, by
 * package@version, as read by a person (2026-10-25): the names of its EMBEDDED
 * entries, or [] for none. A new version needs a new record, so each update
 * of such a package means reading its dist again.
 */
export const DIST_RECORDS = {
  "@braintree/sanitize-url@7.1.2": [],
  "@iconify/utils@3.1.4": [],
  "@mermaid-js/parser@1.2.1": [
    "langium",
    "chevrotain",
    "@chevrotain/gast",
    "@chevrotain/utils",
    "@chevrotain/regexp-to-ast",
    "chevrotain-allstar",
    "vscode-jsonrpc",
    "vscode-languageserver-protocol",
    "vscode-languageserver-types",
    "vscode-languageserver-textdocument",
    "vscode-uri",
    "lodash-es",
    "esbuild runtime helpers",
  ],
  "@upsetjs/venn.js@2.0.0": ["fmin"],
  "cose-base@1.0.3": ["webpack runtime"],
  "cose-base@2.2.0": ["webpack runtime"],
  "cytoscape@3.34.0": [
    "lodash (debounce and others)",
    "heap",
    "jQuery event object (adapted)",
    "Embeddable Minimum Strictly-Compliant Promises/A+ 1.1.1 Thenable",
    "Bezier curve function generator",
    "Runge-Kutta spring physics function generator",
    "gl-matrix",
    "Babel helpers",
    "@rollup/plugin-commonjs helpers",
  ],
  "cytoscape-cose-bilkent@4.1.0": ["webpack runtime"],
  "cytoscape-fcose@2.2.0": ["Babel helpers", "webpack runtime"],
  "dayjs@1.11.21": [],
  "dompurify@3.4.16": ["Babel helpers"],
  "es-toolkit@1.49.0": [],
  "fastdom@1.0.12": [],
  "highlight.js@11.12.0": [],
  "katex@0.16.47": [],
  "katex@0.18.11": [],
  "khroma@2.1.0": [],
  "layout-base@1.0.2": ["Babel helpers", "webpack runtime"],
  "layout-base@2.0.1": ["Babel helpers", "webpack runtime", "JamaJS singular value decomposition (adapted)"],
  "marked@16.4.2": [],
  "marked@18.1.0": [],
  "marked-katex-extension@5.1.13": [],
  "mermaid@11.17.2": ["js-yaml", "esbuild runtime helpers", "@rollup/plugin-commonjs helpers"],
  "plantuml-encoder@1.4.0": ["pako", "browserify prelude (browser-pack)"],
  "roughjs@4.6.6": ["path-data-parser", "points-on-curve", "points-on-path", "hachure-fill"],
  "ts-dedent@2.3.0": [],
  "uuid@14.0.1": [],
};

/**
 * The SIL Open Font License 1.1 text for the KaTeX fonts: the license part of
 * a font package's LICENSE (nothing of that font is bundled).
 */
export const OFL_TEXT = { saved: "fontsource-inter-5.3.0/LICENSE", from: "SIL OPEN FONT LICENSE Version 1.1" };
