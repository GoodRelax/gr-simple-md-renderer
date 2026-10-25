// Third-party notices for the built single file (spec appendix A.2). The build
// plugin thirdPartyNotices (vite.config.js) collects the packages whose code is
// in the bundle, reads their license texts and writes them into a comment at
// the end of the HTML, plus a short list into the help. The code that other
// tools already bundled into a package's dist (and so never shows up as a
// module) is listed by hand in tools/third-party-extras.mjs; the build checks
// that list three ways (marks in the bundled files, declared dependencies that
// are not modules, and a per-version record of what each prebuilt dist holds),
// so a dependency update cannot add unlisted code silently.
//
// Two stages: readInputs reads every file the notices need (non-pure), then
// noticesOf decides from that snapshot alone (pure). Nothing here touches the
// network.

import { escapeHtml } from "../src/js/utils.js";
import {
  BUILD_HELPERS,
  DIST_RECORDS,
  EMBEDDED,
  IGNORED_DEPENDENCIES,
  IGNORED_MARKS,
  OFL_TEXT,
  PACKAGE_OVERRIDES,
} from "./third-party-extras.mjs";

/** SPDX expressions the bundle may contain. Anything else fails the build. */
export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "(MIT AND Zlib)",
  "OFL-1.1",
  "Zlib",
]);

/** The extras the build uses; tests pass their own. */
export const DEFAULT_EXTRAS = {
  embedded: EMBEDDED,
  ignored: IGNORED_MARKS,
  ignoredDependencies: IGNORED_DEPENDENCIES,
  overrides: PACKAGE_OVERRIDES,
  helpers: BUILD_HELPERS,
  distRecords: DIST_RECORDS,
  ofl: OFL_TEXT,
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const NODE_MODULES = "/node_modules/";
/** The prefix of the app's own virtual modules (vite.config.js, fast startup): its own code. */
export const APP_VIRTUAL = "\0grsmd-";
/** Folders that hold built (compiled or bundled) files rather than sources. */
const PREBUILT_DIRS = ["dist", "build", "bundled", "lib", "esm", "es", "umd", "cjs"];
/** devDependencies that bundle a package's files into one. */
const BUNDLERS = ["browserify", "esbuild", "microbundle", "parcel", "rolldown", "rollup", "tsup", "uglify-js", "vite", "webpack"];
const MARK_KINDS = ["paths", "requires", "legal"];

/**
 * @param {string} text
 * @returns {string}  the text with CR LF and lone CR turned into LF
 * @purity pure
 */
export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The package name at the start of a path's segments ("@scope/name" or "name").
 * @param {string[]} segments
 * @returns {string}
 * @purity pure
 */
export function packageNameOf(segments) {
  return segments[0].startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
}

/**
 * The package a module id belongs to: the last node_modules segment wins, so
 * a nested copy (a/node_modules/b) is its own package.
 * @param {string} id  a resolved module id (absolute path, maybe with ?query)
 * @returns {{root: string, name: string, file: string} | null}  file: the path inside the package
 * @purity pure
 */
export function packageOfModuleId(id) {
  const path = String(id).split("?")[0].replace(/\\/g, "/");
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const name = packageNameOf(path.slice(at + NODE_MODULES.length).split("/"));
  const root = path.slice(0, at + NODE_MODULES.length) + name;
  return { root, name, file: path.slice(root.length + 1) };
}

/**
 * @param {string} fileName
 * @returns {boolean}
 * @purity pure
 */
export function isLicenseFileName(fileName) {
  return LICENSE_FILE.test(fileName);
}

/**
 * True when the module put code (or CSS) into the bundle.
 * @param {string} id
 * @param {number} renderedLength
 * @returns {boolean}
 * @purity pure
 */
export function contributes(id, renderedLength) {
  return renderedLength > 0 || /\.css($|\?)/.test(id);
}

const PATH_COMMENT = /^[ \t]*\/\/ .*?node_modules\/(?:\.pnpm\/([^/\s]+)\/node_modules\/)?((?:@[\w.-]+\/)?[\w.-]+)\//gm;
const BARE_REQUIRE = /\brequire\(\s*["']([^"'./][^"']*)["']\s*\)/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * The first non-empty line of a block comment, without the comment syntax.
 * @param {string} comment
 * @returns {string}
 * @purity pure
 */
function firstLineOf(comment) {
  const lines = comment.replace(/^\/\*[!*]?/, "").replace(/\*\/$/, "").split("\n");
  return lines.map((line) => line.replace(/^\s*\*?\s?/, "").trim()).find((line) => line !== "") ?? "";
}

/**
 * Signs that a bundled file carries code from somewhere else:
 * - paths: bundler path comments (// node_modules/<name>/..., esbuild style)
 * - requires: bare require("<name>") calls (browserify / webpack style)
 * - legal: the first line of each legal comment (/*! ... or one that says
 *   @license or copyright)
 * - versions: "name@version" from pnpm path comments (.pnpm/name@version/)
 * @param {string} source
 * @returns {{paths: string[], requires: string[], legal: string[], versions: string[]}}
 * @purity pure
 */
export function marksOf(source) {
  const paths = new Set();
  const requires = new Set();
  const legal = new Set();
  const versions = new Set();
  for (const m of source.matchAll(PATH_COMMENT)) {
    paths.add(m[2]);
    // .pnpm/<name with "+" for "/">@<version>[_<peer>]
    const pnpm = m[1] ? /^(.+?)@([^_@]+)/.exec(m[1].replace(/\+/g, "/")) : null;
    if (pnpm && pnpm[1] === m[2]) versions.add(`${m[2]}@${pnpm[2]}`);
  }
  for (const m of source.matchAll(BARE_REQUIRE)) requires.add(packageNameOf(m[1].split("/")));
  for (const [comment] of source.matchAll(BLOCK_COMMENT)) {
    if (comment.startsWith("/*!") || /@license|copyright/i.test(comment)) legal.add(firstLineOf(comment));
  }
  return { paths: [...paths], requires: [...requires], legal: [...legal], versions: [...versions] };
}

/**
 * The lines from the first one containing `from` to the first later one
 * containing `to` (inclusive), or up to the line before `until`. Both are
 * optional; a marker that is not found is an error.
 * @param {string} text
 * @param {{from?: string, to?: string, until?: string}} range
 * @returns {string}
 * @purity pure
 */
export function excerptOf(text, { from, to, until } = {}) {
  const lines = normalizeNewlines(text).split("\n");
  let start = 0;
  if (from !== undefined) {
    start = lines.findIndex((line) => line.includes(from));
    if (start < 0) throw new Error(`"${from}" not found`);
  }
  let end = lines.length;
  if (to !== undefined || until !== undefined) {
    const marker = to ?? until;
    const at = lines.findIndex((line, i) => i >= start && line.includes(marker));
    if (at < 0) throw new Error(`"${marker}" not found`);
    end = to !== undefined ? at + 1 : at;
  }
  return lines.slice(start, end).join("\n");
}

/**
 * Remove line-comment and block-comment syntax from each line ("// ", " * ",
 * "/*", "*\/"), keeping the text and its indentation after the marker.
 * @param {string} text
 * @returns {string}
 * @purity pure
 */
export function uncomment(text) {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\/\/ ?/, "")
        .replace(/^\s*\/\*+!? ?/, "")
        .replace(/^\s*\*\/\s*$/, "")
        .replace(/^\s\* ?/, "")
        .replace(/\s*\*\/\s*$/, ""),
    )
    .join("\n");
}

/**
 * The legal block comment in `source` whose first line starts with `prefix`,
 * without the comment syntax.
 * @param {string} source
 * @param {string} prefix
 * @returns {string}
 * @purity pure
 */
export function legalCommentOf(source, prefix) {
  for (const [comment] of source.matchAll(BLOCK_COMMENT)) {
    if (firstLineOf(comment).startsWith(prefix)) return uncomment(comment).trim();
  }
  throw new Error(`no legal comment starting with "${prefix}"`);
}

/**
 * The license description (name ID 13, else the copyright, ID 0) of a
 * TrueType font, read from its name table.
 * @param {Uint8Array} bytes
 * @returns {string}
 * @purity pure
 */
export function fontLicenseOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let table = -1;
  for (let i = 0; i < view.getUint16(4); i++) {
    if (tag(12 + i * 16) === "name") table = view.getUint32(12 + i * 16 + 8);
  }
  if (table < 0) throw new Error("no name table");
  const count = view.getUint16(table + 2);
  const strings = table + view.getUint16(table + 4);
  const found = new Map();
  for (let i = 0; i < count; i++) {
    const rec = table + 6 + i * 12;
    const platform = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    if ((nameId !== 13 && nameId !== 0) || found.has(nameId)) continue;
    const length = view.getUint16(rec + 8);
    const at = strings + view.getUint16(rec + 10);
    let text = "";
    if (platform === 1) {
      text = String.fromCharCode(...bytes.subarray(at, at + length));
    } else {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(view.getUint16(at + j));
    }
    found.set(nameId, normalizeNewlines(text).trim());
  }
  const text = found.get(13) ?? found.get(0);
  if (!text) throw new Error("no license or copyright name record");
  return text;
}

/**
 * Throw if the text would end or break the HTML comment it goes into. The
 * text is never changed to fit: a notice must stay as published.
 * @param {string} text
 * @param {string} where  for the message
 * @purity pure
 */
export function assertCommentSafe(text, where) {
  for (const bad of ["-->", "--!>", "<!--"]) {
    if (text.includes(bad)) throw new Error(`${where}: "${bad}" would break the notices comment`);
  }
}

/**
 * @param {{name: string, versions?: string[], license: string}} entry
 * @returns {string}
 * @purity pure
 */
function titleOf(entry) {
  const versions = entry.versions?.length ? ` ${entry.versions.join(", ")}` : "";
  const license = entry.license.startsWith("(") ? entry.license : `(${entry.license})`;
  return `${entry.name}${versions} ${license}`;
}

const RULE = "=".repeat(72);
const THIN = "-".repeat(72);

/**
 * The text of the notices comment: a summary line per entry, then each
 * distinct text (a license file, a copyright header) once, under the titles
 * of all entries that carry it; an entry with several texts is under each.
 * Texts that differ only in white space (line wrapping, indentation) count
 * as one; the first entry's copy is shown.
 * @param {Array<{name: string, versions?: string[], license: string, note?: string, texts: string[]}>} entries
 * @returns {string}
 * @purity pure
 */
export function formatNotices(entries) {
  const sorted = [...entries].sort((a, b) => titleOf(a).localeCompare(titleOf(b), "en"));
  const groups = new Map(); // white-space-free key -> {text, list}
  for (const entry of sorted) {
    for (const part of entry.texts) {
      const text = part.trim();
      const key = text.replace(/\s+/g, " ");
      const group = groups.get(key) ?? { text, list: [] };
      if (!group.list.includes(entry)) group.list.push(entry);
      groups.set(key, group);
    }
  }
  const out = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "GR Simple Markdown (GRSMD) includes the open source software listed below.",
    "Their copyright and license notices follow the list, as published by each",
    "project. Entries that share one license text are shown together.",
    "",
    ...sorted.map((entry) => `  ${titleOf(entry)}${entry.note ? ` -- ${entry.note}` : ""}`),
  ];
  for (const { text, list } of groups.values()) {
    out.push("", RULE, ...list.map(titleOf), THIN, text);
  }
  return out.join("\n");
}

/**
 * The help's short list: "name version (license)" for each entry.
 * @param {Array<{name: string, versions?: string[], license: string}>} entries
 * @returns {string}  HTML text
 * @purity pure
 */
export function formatHelpList(entries) {
  return [...entries]
    .map(titleOf)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map(escapeHtml)
    .join(", ");
}

const LIST_SLOT = /(<p\b[^>]*\bdata-third-party-list\b[^>]*>)([\s\S]*?)(<\/p>)/g;
export const POINTER_COMMENT = "<!-- Third-party notices: see the comment at the end of this file. -->";

/**
 * Write the notices into the built HTML: the list into each of the two help
 * slots (data-third-party-list, one per language), a pointer after
 * <meta charset>, and the full comment on its own lines just before </body>.
 * @param {string} html
 * @param {{notices: string, list: string}} parts
 * @returns {string}
 * @purity pure
 */
export function stampNotices(html, { notices, list }) {
  assertCommentSafe(notices, "notices");
  const slots = [...html.matchAll(LIST_SLOT)];
  if (slots.length !== 2) {
    throw new Error(`the help needs 2 notice list slots (data-third-party-list), found ${slots.length}`);
  }
  for (const [, , inner] of slots) {
    if (inner.trim() !== "") throw new Error("a notice list slot must be empty in the source");
  }
  const charset = /<meta\s+charset\s*=[^>]*>/i;
  if (!charset.test(html)) throw new Error("<meta charset> not found");
  const end = html.lastIndexOf("</body>");
  if (end < 0) throw new Error("</body> not found");
  // Before the indentation of the </body> line, so </body> keeps it.
  const lineStart = html.lastIndexOf("\n", end - 1) + 1;
  const at = html.slice(lineStart, end).trim() === "" ? lineStart : end;
  const withComment = `${html.slice(0, at)}<!--\n${notices}\n-->\n${html.slice(at)}`;
  return withComment
    .replace(LIST_SLOT, (_whole, open, _inner, close) => `${open}${list}${close}`)
    .replace(charset, (tag) => `${tag}\n    ${POINTER_COMMENT}`);
}

/**
 * A package's license field as package.json has it: a string, null when there
 * is no field, or invalid when it is in another form (the old {type} object or
 * a "licenses" array), which is never guessed at.
 * @param {object} pkg  package.json
 * @returns {{value: string | null} | {invalid: true}}
 * @purity pure
 */
export function publishedLicenseOf(pkg) {
  if (typeof pkg.license === "string") return { value: pkg.license };
  if (pkg.license === undefined && pkg.licenses === undefined) return { value: null };
  return { invalid: true };
}

/**
 * True when the files the bundle loads from a package are built ones (from a
 * dist-like folder, or anything outside src/ of a package that has a bundler
 * among its devDependencies): such a dist may carry other code, so a person
 * must read it and record what it holds (DIST_RECORDS).
 * @param {object} pkg  package.json
 * @param {string[]} loadedFiles  paths inside the package
 * @returns {boolean}
 * @purity pure
 */
export function needsDistRecord(pkg, loadedFiles) {
  const fromBuiltFolder = loadedFiles.some((f) => f.includes("/") && PREBUILT_DIRS.includes(f.split("/")[0]));
  const bundled = BUNDLERS.some((b) => pkg.devDependencies?.[b] !== undefined);
  return fromBuiltFolder || (bundled && loadedFiles.some((f) => !f.startsWith("src/")));
}

/**
 * The places of the hand-made rules: one per location of an EMBEDDED entry
 * (with the entry's name and versions), and the ignored marks.
 * @param {object[]} embedded
 * @param {object[]} ignored
 * @returns {object[]}
 * @purity pure
 */
function ruleLocationsOf(embedded, ignored) {
  return [
    ...embedded.flatMap((entry) => entry.in.map((place) => ({ ...place, name: entry.name, versions: entry.versions }))),
    ...ignored,
  ];
}

/**
 * @param {string} host
 * @param {"paths"|"requires"|"legal"} kind
 * @param {string} value
 * @param {{host: string, paths?: string[], requires?: string[], legal?: string[]}} rule
 * @returns {boolean}
 * @purity pure
 */
function ruleCovers(host, kind, value, rule) {
  if (rule.host !== host) return false;
  const list = rule[kind] ?? [];
  return kind === "legal" ? list.some((prefix) => value.startsWith(prefix)) : list.includes(value);
}

/**
 * Check the marks found in each bundled package against the hand-made list.
 * Returns the problems: marks no rule covers, and rules (embedded locations
 * and ignored marks) whose marks or `contains` text are no longer found, or
 * whose versions the pnpm path comments contradict.
 * @param {Map<string, {paths: string[], requires: string[], legal: string[], versions?: string[], sources: string[]}>} marksByHost
 *   host package name -> marks and the bundled sources (for `contains`)
 * @param {Set<string>} bundledNames  every bundled package name
 * @param {{embedded: object[], ignored: object[]}} rules
 * @returns {string[]}
 * @purity pure
 */
export function checkMarks(marksByHost, bundledNames, { embedded, ignored }) {
  const problems = [];
  const rules = ruleLocationsOf(embedded, ignored);
  for (const [host, marks] of marksByHost) {
    for (const kind of MARK_KINDS) {
      for (const value of marks[kind]) {
        if (kind === "requires" && bundledNames.has(value)) continue;
        if (rules.some((rule) => ruleCovers(host, kind, value, rule))) continue;
        problems.push(`${host}: unlisted ${kind} mark "${value}" (add it to tools/third-party-extras.mjs)`);
      }
    }
  }
  for (const rule of rules) {
    const marks = marksByHost.get(rule.host);
    const label = rule.name ?? rule.why;
    if (!marks) {
      problems.push(`${rule.host} (${label}): the host package is no longer bundled`);
      continue;
    }
    for (const kind of MARK_KINDS) {
      for (const value of rule[kind] ?? []) {
        const seen = kind === "legal" ? marks.legal.some((v) => v.startsWith(value)) : marks[kind].includes(value);
        if (!seen) problems.push(`${rule.host} (${label}): ${kind} mark "${value}" is no longer found`);
      }
    }
    for (const text of rule.contains ?? []) {
      if (!marks.sources.some((source) => source.includes(text))) {
        problems.push(`${rule.host} (${label}): "${text}" is no longer found`);
      }
    }
    // The version(s) the pnpm path comments name must be the listed ones, so
    // a dependency update cannot leave an old saved text behind.
    if (rule.versions === undefined) continue;
    for (const name of rule.paths ?? []) {
      const seen = (marks.versions ?? []).filter((v) => v.startsWith(`${name}@`)).map((v) => v.slice(name.length + 1));
      if (seen.length && [...seen].sort().join(" ") !== [...rule.versions].sort().join(" ")) {
        problems.push(`${rule.host} (${label}): the bundled ${name} is ${seen.join(", ")}, the list says ${rule.versions.join(", ")}`);
      }
    }
  }
  return problems;
}

/**
 * Check (a) of M1: a dependency a bundled package declares, but that is not a
 * module of the bundle, is either inside the package's dist (an EMBEDDED
 * location with `declared`) or listed with its reason (IGNORED_DEPENDENCIES).
 * Both lists must still apply.
 * @param {Array<{name: string, version: string, pkg: object}>} packages  the bundled packages
 * @param {Set<string>} moduleNames  the names of all packages that have a module in the bundle
 * @param {{embedded: object[], ignoredDependencies: object[]}} rules
 * @returns {string[]}
 * @purity pure
 */
export function checkDeclaredDependencies(packages, moduleNames, { embedded, ignoredDependencies }) {
  const problems = [];
  const declaredInside = embedded.flatMap((entry) =>
    entry.in.flatMap((place) => (place.declared ?? []).map((dependency) => ({ host: place.host, dependency, label: entry.name }))),
  );
  const rules = [...declaredInside, ...ignoredDependencies.map((rule) => ({ ...rule, label: rule.why }))];
  const missing = (p) => Object.keys(p.pkg.dependencies ?? {}).filter((d) => !moduleNames.has(d));
  for (const p of packages) {
    for (const dependency of missing(p)) {
      if (rules.some((rule) => rule.host === p.name && rule.dependency === dependency)) continue;
      problems.push(
        `${p.name}@${p.version}: declares the dependency "${dependency}", which is not a module of the bundle; ` +
          "list it in tools/third-party-extras.mjs (EMBEDDED with declared, or IGNORED_DEPENDENCIES with the reason)",
      );
    }
  }
  for (const rule of rules) {
    if (!packages.some((p) => p.name === rule.host && missing(p).includes(rule.dependency))) {
      problems.push(`${rule.host} (${rule.label}): the dependency "${rule.dependency}" is no longer declared and missing`);
    }
  }
  return problems;
}

/**
 * Check (b) of M1: every bundled package whose dist is prebuilt (or that an
 * EMBEDDED entry names as a host) has a record for its exact version, and the
 * records of a package name list exactly the EMBEDDED entries inside it.
 * @param {Array<{name: string, version: string, pkg: object, loadedFiles: string[]}>} packages
 * @param {{embedded: object[], distRecords: Object<string, string[]>}} rules
 * @returns {string[]}
 * @purity pure
 */
export function checkDistRecords(packages, { embedded, distRecords }) {
  const problems = [];
  const keyOf = (p) => `${p.name}@${p.version}`;
  const hosts = new Set(embedded.flatMap((entry) => entry.in.map((place) => place.host)));
  for (const p of packages) {
    if (keyOf(p) in distRecords) continue;
    if (needsDistRecord(p.pkg, p.loadedFiles) || hosts.has(p.name)) {
      problems.push(`${keyOf(p)}: its dist is prebuilt; read it and record what it bundles in DIST_RECORDS (tools/third-party-extras.mjs)`);
    }
  }
  const bundledKeys = new Set(packages.map(keyOf));
  for (const key of Object.keys(distRecords)) {
    if (!bundledKeys.has(key)) problems.push(`${key}: DIST_RECORDS has a record for a version that is not bundled`);
  }
  const names = new Set([...packages.map((p) => p.name), ...hosts]);
  for (const name of names) {
    const recorded = new Set(packages.filter((p) => p.name === name).flatMap((p) => distRecords[keyOf(p)] ?? []));
    const listed = new Set(embedded.filter((entry) => entry.in.some((place) => place.host === name)).map((entry) => entry.name));
    for (const inside of recorded) {
      if (!listed.has(inside)) problems.push(`${name}: DIST_RECORDS says it bundles "${inside}", but EMBEDDED has no such entry inside it`);
    }
    for (const inside of listed) {
      if (!recorded.has(inside)) problems.push(`${name}: EMBEDDED lists "${inside}" inside it, but DIST_RECORDS does not`);
    }
  }
  return problems;
}

/**
 * What the build does with the outcome: any problem is an error; a pending
 * text is an error in a release build and a warning in any other.
 * @param {{problems: string[], pending: string[]}} outcome
 * @param {string} mode  Vite's mode ("release" for npm run build:release)
 * @returns {{error: string | null, warning: string | null}}
 * @purity pure
 */
export function verdictOf({ problems, pending }, mode) {
  if (problems.length) return { error: `third-party notices:\n  ${problems.join("\n  ")}`, warning: null };
  if (!pending.length) return { error: null, warning: null };
  const message = `third-party notices: ${pending.length} text(s) pending:\n  ${pending.join("\n  ")}`;
  return mode === "release" ? { error: message, warning: null } : { error: null, warning: message };
}

/**
 * tools/third-party-licenses/ (texts saved from npm tarballs) of the project
 * whose node_modules is `base`.
 * @param {string} base  the node_modules folder, with "/"
 * @returns {string}
 * @purity pure
 */
function savedDirOf(base) {
  return `${base.slice(0, base.lastIndexOf("/"))}/tools/third-party-licenses`;
}

/**
 * The file a text source reads: { saved } from tools/third-party-licenses/,
 * { file } from `dir`; null for { pending }.
 * @param {string} dir
 * @param {object} part
 * @param {string} base  the node_modules folder
 * @returns {string | null}
 * @purity pure
 */
function partPathOf(dir, part, base) {
  if (part.pending) return null;
  return part.saved ? `${savedDirOf(base)}/${part.saved}` : `${dir}/${part.file}`;
}

/**
 * The bundle's packages from its modules: the contributing ones by root (with
 * the files loaded from each), every name that has a module at all, the
 * bundler's helper packages, and the roots whose KaTeX CSS is in.
 * @param {Array<{id: string, renderedLength: number}>} modules
 * @param {object[]} helpers  BUILD_HELPERS
 * @returns {{roots: Map<string, {name: string, files: string[]}>, moduleNames: Set<string>, helperPackages: Set<string>, katexCssRoots: Set<string>, unknownVirtual: string[]}}
 * @purity pure
 */
function bundleOf(modules, helpers) {
  const roots = new Map();
  const moduleNames = new Set();
  const helperPackages = new Set();
  const katexCssRoots = new Set();
  const unknownVirtual = [];
  for (const { id, renderedLength } of modules) {
    if (id.startsWith(APP_VIRTUAL)) continue; // the app's own code
    if (id.startsWith("\0")) {
      if (!contributes(id, renderedLength)) continue;
      const helper = helpers.find((h) => h.id === id);
      if (helper) helperPackages.add(helper.package);
      else unknownVirtual.push(id);
      continue;
    }
    const pkg = packageOfModuleId(id);
    if (!pkg) continue; // the app's own code
    moduleNames.add(pkg.name);
    if (!contributes(id, renderedLength)) continue;
    const root = roots.get(pkg.root) ?? { name: pkg.name, files: [] };
    if (!root.files.includes(pkg.file)) root.files.push(pkg.file);
    roots.set(pkg.root, root);
    if (pkg.name === "katex" && /^dist\/katex(\.min)?\.css$/.test(pkg.file)) katexCssRoots.add(pkg.root);
  }
  return { roots, moduleNames, helperPackages, katexCssRoots, unknownVirtual };
}

/**
 * Stage 1 (collection): read every file the notices need, before deciding
 * anything. A file that cannot be read is stored as null; stage 2 reports it.
 * @param {{
 *   modules: Array<{id: string, renderedLength: number}>,
 *   nodeModules: string,
 *   fs: {readText(path: string): string, readBytes(path: string): Uint8Array, list(dir: string): string[]},
 *   extras?: object,
 * }} input
 * @returns {{modules: object[], base: string, files: Map<string, string|null>, dirs: Map<string, string[]|null>, bytes: Map<string, Uint8Array|null>}}
 * @purity non-pure
 */
export function readInputs({ modules, nodeModules, fs, extras = DEFAULT_EXTRAS }) {
  const base = nodeModules.replace(/\\/g, "/").replace(/\/$/, "");
  const files = new Map();
  const dirs = new Map();
  const bytes = new Map();
  /**
   * @param {() => any} read
   * @returns {any}  what read() returns, or null when it throws
   * @purity non-pure
   */
  const attempt = (read) => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  const text = (path) => path === null || files.has(path) || files.set(path, attempt(() => fs.readText(path)));
  const dir = (path) => dirs.has(path) || dirs.set(path, attempt(() => fs.list(path)));
  const binary = (path) => bytes.has(path) || bytes.set(path, attempt(() => fs.readBytes(path)));

  const { roots, helperPackages, katexCssRoots } = bundleOf(modules, extras.helpers);
  for (const { id, renderedLength } of modules) {
    const pkg = packageOfModuleId(id);
    // Keyed by the "/" path that stage 2 looks up (ids use "\" on Windows).
    if (pkg && contributes(id, renderedLength) && !pkg.file.endsWith(".css")) text(`${pkg.root}/${pkg.file}`);
  }
  const packageRoots = [...roots.keys(), ...[...helperPackages].map((name) => `${base}/${name}`)];
  for (const root of packageRoots) {
    const name = root.slice(root.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    text(`${root}/package.json`);
    dir(root);
    for (const file of (dirs.get(root) ?? []).filter(isLicenseFileName)) text(`${root}/${file}`);
    const override = extras.overrides[name];
    for (const part of [...(override?.texts ?? []), ...(override?.addTexts ?? [])]) text(partPathOf(root, part, base));
  }
  for (const entry of extras.embedded) for (const part of entry.texts) text(partPathOf(base, part, base));
  text(partPathOf(base, extras.ofl, base));
  for (const root of katexCssRoots) {
    text(`${root}/package.json`);
    dir(`${root}/dist/fonts`);
    for (const file of (dirs.get(`${root}/dist/fonts`) ?? []).filter((f) => f.endsWith(".ttf"))) binary(`${root}/dist/fonts/${file}`);
  }
  return { modules, base, files, dirs, bytes };
}

/**
 * Stage 2 (processing): the notice entries, the pending texts and the
 * problems, from the snapshot of stage 1 alone.
 * @param {{modules: object[], base: string, files: Map, dirs: Map, bytes: Map}} snapshot
 * @param {object} [extras]
 * @returns {{entries: object[], pending: string[], problems: string[]}}
 * @purity pure
 */
export function noticesOf(snapshot, extras = DEFAULT_EXTRAS) {
  const { modules, base, files, dirs, bytes } = snapshot;
  const { embedded, ignored, ignoredDependencies, overrides, helpers, distRecords, ofl } = extras;
  const problems = [];
  const pending = [];
  /**
   * @param {string} path
   * @returns {string}  the snapshot's text of the file; throws when it was not read
   * @purity pure
   */
  const readText = (path) => {
    const value = files.get(path);
    if (value === undefined || value === null) throw new Error(`cannot read ${path}`);
    return value;
  };
  const listDir = (path) => dirs.get(path) ?? [];

  const { roots, moduleNames, helperPackages, katexCssRoots, unknownVirtual } = bundleOf(modules, helpers);
  for (const id of unknownVirtual) problems.push(`virtual module ${JSON.stringify(id)} is not in BUILD_HELPERS`);

  const marksByHost = new Map();
  for (const [root, { name, files: loaded }] of roots) {
    const marks = marksByHost.get(name) ?? { paths: [], requires: [], legal: [], versions: [], sources: [] };
    for (const file of loaded.filter((f) => !f.endsWith(".css"))) {
      const source = files.get(`${root}/${file}`);
      if (typeof source !== "string") continue;
      const found = marksOf(source);
      for (const kind of [...MARK_KINDS, "versions"]) {
        for (const value of found[kind]) if (!marks[kind].includes(value)) marks[kind].push(value);
      }
      marks.sources.push(source);
    }
    marksByHost.set(name, marks);
  }

  /**
   * The text of one source part, or null (and a pending note) for { pending }.
   * @param {string} dir
   * @param {object} part
   * @param {string} where
   * @returns {string | null}
   * @purity pure
   */
  const textOf = (dir, part, where) => {
    if (part.pending) {
      pending.push(`${where}: ${part.pending}`);
      return null;
    }
    const raw = readText(partPathOf(dir, part, base));
    let text = part.legal ? legalCommentOf(raw, part.legal) : excerptOf(raw, part);
    if (part.uncomment) text = uncomment(text);
    return normalizeNewlines(text).trim();
  };

  const entries = [];
  const packages = []; // the bundled packages, for the dependency and dist checks
  const packageRoots = [
    ...[...roots].map(([root, { name, files: loaded }]) => ({ root, name, loaded, helper: false })),
    ...[...helperPackages].map((name) => ({ root: `${base}/${name}`, name, loaded: [], helper: true })),
  ].sort((a, b) => a.root.localeCompare(b.root));
  for (const { root, name, loaded, helper } of packageRoots) {
    let pkg;
    try {
      pkg = JSON.parse(readText(`${root}/package.json`));
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    const where = `${name}@${pkg.version}`;
    if (!helper) packages.push({ name, version: pkg.version, pkg, loadedFiles: loaded });
    const published = publishedLicenseOf(pkg);
    if (published.invalid) {
      problems.push(`${where}: package.json's license is not a string (old form); write an override in tools/third-party-extras.mjs`);
      continue;
    }
    const override = overrides[name];
    if (override && override.published !== published.value) {
      problems.push(`${where}: package.json says license ${JSON.stringify(published.value)}, the override in tools/third-party-extras.mjs expects ${JSON.stringify(override.published)}`);
      continue;
    }
    const license = override?.license ?? published.value;
    if (!ALLOWED_LICENSES.has(license)) {
      problems.push(`${where}: license ${JSON.stringify(license)} is not allowed (ALLOWED_LICENSES in tools/notices.mjs)`);
      continue;
    }
    let texts;
    try {
      texts = override?.texts
        ? override.texts.map((part) => textOf(root, part, where))
        : listDir(root)
            .filter(isLicenseFileName)
            .sort()
            .map((file) => normalizeNewlines(readText(`${root}/${file}`)).trim());
      for (const part of override?.addTexts ?? []) texts.push(textOf(root, part, where));
    } catch (error) {
      problems.push(`${where}: ${error.message}`);
      continue;
    }
    texts = texts.filter((t) => t !== null && t !== "");
    if (texts.length === 0 && !pending.some((p) => p.startsWith(`${where}:`))) {
      problems.push(`${where}: no license text found (add an override to tools/third-party-extras.mjs)`);
      continue;
    }
    entries.push({ name, versions: [pkg.version], license, note: override?.note, texts });
  }

  const bundledNames = new Set([...roots.values()].map((r) => r.name));
  problems.push(...checkMarks(marksByHost, bundledNames, { embedded, ignored }));
  problems.push(...checkDeclaredDependencies(packages, moduleNames, { embedded, ignoredDependencies }));
  problems.push(...checkDistRecords(packages, { embedded, distRecords }));

  for (const item of embedded) {
    const hosts = item.in.map((place) => place.host).filter((host) => bundledNames.has(host));
    if (hosts.length === 0) continue;
    const where = `${item.name} (inside ${hosts.join(", ")})`;
    if (!ALLOWED_LICENSES.has(item.license)) {
      problems.push(`${where}: license ${JSON.stringify(item.license)} is not allowed`);
      continue;
    }
    let texts;
    try {
      texts = item.texts.map((part) => textOf(base, part, where)).filter((t) => t !== null && t !== "");
    } catch (error) {
      problems.push(`${where}: ${error.message}`);
      continue;
    }
    entries.push({ name: item.name, versions: item.versions, license: item.license, note: `inside ${hosts.join(", ")}`, texts });
  }

  for (const root of katexCssRoots) {
    let katex;
    try {
      katex = JSON.parse(readText(`${root}/package.json`));
    } catch (error) {
      problems.push(`KaTeX fonts: ${error.message}`);
      continue;
    }
    // One notice per font family (each names its Reserved Font Name).
    const fontDir = `${root}/dist/fonts`;
    const fonts = listDir(fontDir).filter((f) => f.endsWith(".ttf")).sort();
    const notices = [];
    for (const font of fonts) {
      const data = bytes.get(`${fontDir}/${font}`);
      if (!data) {
        problems.push(`KaTeX fonts: cannot read ${fontDir}/${font}`);
        continue;
      }
      const notice = fontLicenseOf(data);
      if (!notices.includes(notice)) notices.push(notice);
    }
    if (notices.length === 0) problems.push(`KaTeX fonts: no .ttf in ${fontDir} to read the font notices from`);
    let oflText = null;
    try {
      oflText = textOf(base, ofl, `KaTeX fonts ${katex.version}`);
    } catch (error) {
      problems.push(`KaTeX fonts: ${error.message}`);
    }
    entries.push({
      name: "KaTeX fonts",
      versions: [katex.version],
      license: "OFL-1.1",
      note: "the woff2 fonts in the KaTeX CSS",
      texts: [notices.join("\n\n"), ...(oflText ? [oflText] : [])],
    });
  }

  for (const entry of entries) {
    for (const text of entry.texts) {
      try {
        assertCommentSafe(text, titleOf(entry));
      } catch (error) {
        problems.push(error.message);
      }
    }
  }
  return { entries, pending, problems };
}

/**
 * Both stages in one call (the build and the tests).
 * @param {{modules: object[], nodeModules: string, fs: object, extras?: object}} input
 * @returns {{entries: object[], pending: string[], problems: string[]}}
 * @purity non-pure
 */
export function collectNotices(input) {
  return noticesOf(readInputs(input), input.extras ?? DEFAULT_EXTRAS);
}
