// The hand-made part of the third-party notices (tools/notices.mjs). Each list
// is checked against the bundle on every build: an unlisted mark or a listed
// one that is no longer found fails the build, so this file has to follow the
// dependencies. Text sources (never the network):
//   { file, from?, to?, until?, uncomment? }  lines of a file in node_modules
//                                             (to: inclusive, until: exclusive)
//   { saved, from?, to?, until? }             the same, of a file in
//                                             tools/third-party-licenses/
//   { file, legal }                           the legal comment starting so
//   { pending }                               no text yet: a release build
//                                             fails while one is left

/**
 * Packages whose package.json or license files need help. `published` must
 * equal package.json's license field (undefined when it has none), so a
 * license change upstream fails the build. Without `texts` the package's own
 * license files are used; `addTexts` are appended.
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
    published: undefined,
    // package.json has no license field; the license file is the MIT text.
    license: "MIT",
  },
  rolldown: {
    published: "MIT",
    texts: [{ file: "LICENSE" }, { file: "THIRD-PARTY-LICENSE" }],
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

/**
 * Third-party code inside a bundled package's dist. `host` is the package
 * whose files carry it; paths / requires / legal / contains are the marks that
 * show it is there (see marksOf in tools/notices.mjs). For code found through
 * pnpm path comments, `version` must be the version(s) they name.
 */
export const EMBEDDED = [
  // @mermaid-js/parser bundles its devDependencies with esbuild.
  { name: "langium", version: "4.2.1", license: "MIT", host: PARSER, paths: ["langium"], texts: [{ saved: "langium-4.2.1/LICENSE" }] },
  { name: "chevrotain", version: "11.1.2", license: "Apache-2.0", host: PARSER, paths: ["chevrotain"], texts: [{ saved: "chevrotain-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/gast", version: "11.1.2", license: "Apache-2.0", host: PARSER, paths: ["@chevrotain/gast"], texts: [{ saved: "chevrotain-gast-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/utils", version: "11.1.2", license: "Apache-2.0", host: PARSER, paths: ["@chevrotain/utils"], texts: [{ saved: "chevrotain-utils-11.1.2/LICENSE.txt" }] },
  { name: "@chevrotain/regexp-to-ast", version: "11.1.2", license: "Apache-2.0", host: PARSER, paths: ["@chevrotain/regexp-to-ast"], texts: [{ saved: "chevrotain-regexp-to-ast-11.1.2/LICENSE.txt" }] },
  { name: "chevrotain-allstar", version: "0.3.1", license: "MIT", host: PARSER, paths: ["chevrotain-allstar"], texts: [{ saved: "chevrotain-allstar-0.3.1/LICENSE" }] },
  {
    name: "vscode-jsonrpc",
    version: "8.2.0",
    license: "MIT",
    host: PARSER,
    paths: ["vscode-jsonrpc"],
    texts: [{ saved: "vscode-jsonrpc-8.2.0/License.txt" }, { saved: "vscode-jsonrpc-8.2.0/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-protocol",
    version: "3.17.5",
    license: "MIT",
    host: PARSER,
    paths: ["vscode-languageserver-protocol"],
    texts: [{ saved: "vscode-languageserver-protocol-3.17.5/License.txt" }, { saved: "vscode-languageserver-protocol-3.17.5/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-types",
    version: "3.17.5",
    license: "MIT",
    host: PARSER,
    paths: ["vscode-languageserver-types"],
    texts: [{ saved: "vscode-languageserver-types-3.17.5/License.txt" }, { saved: "vscode-languageserver-types-3.17.5/thirdpartynotices.txt" }],
  },
  {
    name: "vscode-languageserver-textdocument",
    version: "1.0.12",
    license: "MIT",
    host: PARSER,
    paths: ["vscode-languageserver-textdocument"],
    texts: [{ saved: "vscode-languageserver-textdocument-1.0.12/License.txt" }, { saved: "vscode-languageserver-textdocument-1.0.12/thirdpartynotices.txt" }],
  },
  { name: "vscode-uri", version: "3.1.0", license: "MIT", host: PARSER, paths: ["vscode-uri"], texts: [{ saved: "vscode-uri-3.1.0/LICENSE.md" }] },
  {
    name: "lodash-es",
    version: "4.17.23, 4.18.1",
    license: "MIT",
    host: PARSER,
    paths: ["lodash-es"],
    legal: ["Bundled license information:"],
    // The LICENSE of 4.17.23 and 4.18.1 is the same file (byte for byte).
    texts: [{ file: "lodash-es/LICENSE" }],
  },
  // mermaid bundles js-yaml with esbuild.
  { name: "js-yaml", version: "4.3.0", license: "MIT", host: "mermaid", paths: ["js-yaml"], texts: [{ saved: "js-yaml-4.3.0/LICENSE" }] },
  // plantuml-encoder is a browserify bundle that includes pako's deflate.
  {
    name: "pako",
    version: "1.0.10",
    license: "(MIT AND Zlib)",
    host: "plantuml-encoder",
    requires: ["pako"],
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
  // cytoscape's rollup bundle includes these.
  { name: "lodash (debounce and others)", license: "MIT", host: "cytoscape", contains: ["__lodash_hash_undefined__"], texts: [{ file: "lodash-es/LICENSE" }] },
  // heap's LICENSE has no copyright line; it is shown as published.
  { name: "heap", version: "0.2.7", license: "MIT", host: "cytoscape", contains: ["nlargest = function(array, n, cmp)"], texts: [{ saved: "heap-0.2.7/LICENSE" }] },
  {
    name: "jQuery event object (adapted)",
    license: "MIT",
    host: "cytoscape",
    legal: ["Event object based on jQuery events"],
    // The jQuery version it was adapted from is not known; jQuery 3.7.1's LICENSE.
    texts: [{ file: CYTOSCAPE, legal: "Event object based on jQuery events" }, { saved: "jquery-3.7.1/LICENSE.txt" }],
  },
  {
    name: "Embeddable Minimum Strictly-Compliant Promises/A+ 1.1.1 Thenable",
    license: "MIT",
    host: "cytoscape",
    legal: ["Embeddable Minimum Strictly-Compliant Promises/A+"],
    texts: [{ file: CYTOSCAPE, legal: "Embeddable Minimum Strictly-Compliant Promises/A+" }, MIT_TERMS],
  },
  {
    name: "Bezier curve function generator",
    license: "MIT",
    host: "cytoscape",
    legal: ["Bezier curve function generator."],
    texts: [{ file: CYTOSCAPE, legal: "Bezier curve function generator." }, MIT_TERMS],
  },
  {
    name: "Runge-Kutta spring physics function generator",
    license: "MIT",
    host: "cytoscape",
    legal: ["Runge-Kutta spring physics function generator."],
    texts: [{ file: CYTOSCAPE, legal: "Runge-Kutta spring physics function generator." }, MIT_TERMS],
  },
  // DOMPurify's rollup bundle carries Babel's helpers with this notice.
  {
    name: "Babel helpers",
    license: "MIT",
    host: "dompurify",
    legal: ["regenerator-runtime -- Copyright"],
    texts: [{ file: "dompurify/dist/purify.es.mjs", legal: "regenerator-runtime" }, { saved: "babel-helpers-7.29.10/LICENSE" }],
  },
  // layout-base 2.x (under cytoscape-fcose) adopts an SVD from JamaJS and
  // carries the Apache-2.0 text with it. That copy differs from the current
  // Apache-2.0 text only in the appendix's placeholder brackets ({} for []),
  // so the license part is the Apache-2.0 text already in the notices.
  {
    name: "JamaJS singular value decomposition (adapted)",
    license: "Apache-2.0",
    host: "layout-base",
    legal: ["Apache License"],
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
 * The SIL Open Font License 1.1 text for the KaTeX fonts: the license part of
 * a font package's LICENSE (nothing of that font is bundled).
 */
export const OFL_TEXT = { saved: "fontsource-inter-5.3.0/LICENSE", from: "SIL OPEN FONT LICENSE Version 1.1" };
