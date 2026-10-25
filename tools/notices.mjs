// Third-party notices for the built single file (spec appendix A.2). The build
// plugin thirdPartyNotices (vite.config.js) collects the packages whose code is
// in the bundle, reads their license texts from node_modules and writes them
// into a comment at the end of the HTML, plus a short list into the help. The
// code that other tools already bundled into a package's dist (and so never
// shows up as a module) is listed by hand in tools/third-party-extras.mjs;
// the marks found in the bundled files must match that list, so a dependency
// update cannot add unlisted code silently. Nothing here touches the network.

import { EMBEDDED, IGNORED_MARKS, PACKAGE_OVERRIDES, BUILD_HELPERS, OFL_TEXT } from "./third-party-extras.mjs";

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

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const NODE_MODULES = "/node_modules/";

/**
 * The package a module id belongs to: the last node_modules segment wins, so
 * a nested copy (a/node_modules/b) is its own package.
 * @param {string} id  a resolved module id (absolute path, maybe with ?query)
 * @returns {{root: string, name: string} | null}
 * @purity pure
 */
export function packageOfModuleId(id) {
  const path = String(id).split("?")[0].replace(/\\/g, "/");
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const parts = path.slice(at + NODE_MODULES.length).split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return { root: path.slice(0, at + NODE_MODULES.length) + name, name };
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
  for (const m of source.matchAll(BARE_REQUIRE)) {
    const parts = m[1].split("/");
    requires.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
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
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
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
    found.set(nameId, text.replace(/\r\n?/g, "\n").trim());
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
 * @param {{name: string, version?: string, license: string}} entry
 * @returns {string}
 * @purity pure
 */
function titleOf(entry) {
  const version = entry.version ? ` ${entry.version}` : "";
  const license = entry.license.startsWith("(") ? entry.license : `(${entry.license})`;
  return `${entry.name}${version} ${license}`;
}

const RULE = "=".repeat(72);
const THIN = "-".repeat(72);

/**
 * The text of the notices comment: a summary line per entry, then each
 * distinct text (a license file, a copyright header) once, under the titles
 * of all entries that carry it; an entry with several texts is under each.
 * Texts that differ only in white space (line wrapping, indentation) count
 * as one; the first entry's copy is shown.
 * @param {Array<{name: string, version?: string, license: string, note?: string, texts: string[]}>} entries
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
 * @param {string} text
 * @returns {string}
 * @purity pure
 */
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The help's short list: "name version (license)" for each entry.
 * @param {Array<{name: string, version?: string, license: string}>} entries
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
 * <meta charset>, and the full comment just before </body>.
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
  const withComment = `${html.slice(0, end)}<!--\n${notices}\n-->\n${html.slice(end)}`;
  return withComment
    .replace(LIST_SLOT, (_whole, open, _inner, close) => `${open}${list}${close}`)
    .replace(charset, (tag) => `${tag}\n    ${POINTER_COMMENT}`);
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
 * Returns the problems: marks no rule covers, and rules (embedded entries and
 * ignored marks) whose marks or `contains` text are no longer found.
 * @param {Map<string, {paths: string[], requires: string[], legal: string[], versions?: string[], sources: string[]}>} marksByHost
 *   host package name -> marks and the bundled sources (for `contains`)
 * @param {Set<string>} bundledNames  every bundled package name
 * @param {{embedded: object[], ignored: object[]}} rules
 * @returns {string[]}
 * @purity pure
 */
export function checkMarks(marksByHost, bundledNames, { embedded, ignored }) {
  const problems = [];
  const rules = [...embedded, ...ignored];
  for (const [host, marks] of marksByHost) {
    for (const kind of ["paths", "requires", "legal"]) {
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
    for (const kind of ["paths", "requires", "legal"]) {
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
    if (rule.version === undefined) continue;
    for (const name of rule.paths ?? []) {
      const seen = (marks.versions ?? []).filter((v) => v.startsWith(`${name}@`)).map((v) => v.slice(name.length + 1));
      const listed = rule.version.split(", ");
      if (seen.length && seen.sort().join(", ") !== listed.sort().join(", ")) {
        problems.push(`${rule.host} (${label}): the bundled ${name} is ${seen.join(", ")}, the list says ${rule.version}`);
      }
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
 * Collect the notice entries for the bundled modules. File access comes in
 * through `fs` so the tests can run on fixtures.
 * @param {{
 *   modules: Array<{id: string, renderedLength: number}>,
 *   nodeModules: string,
 *   fs: {readText(path: string): string, readBytes(path: string): Uint8Array, list(dir: string): string[]},
 *   extras?: {embedded: object[], ignored: object[], overrides: object, helpers: object[]},
 * }} input
 * @returns {{entries: object[], pending: string[], problems: string[]}}
 * @purity non-pure
 */
export function collectNotices({ modules, nodeModules, fs, extras }) {
  const { embedded, ignored, overrides, helpers } = extras ?? {
    embedded: EMBEDDED,
    ignored: IGNORED_MARKS,
    overrides: PACKAGE_OVERRIDES,
    helpers: BUILD_HELPERS,
  };
  const base = nodeModules.replace(/\\/g, "/").replace(/\/$/, "");
  const problems = [];
  const pending = [];
  const roots = new Map(); // root -> name
  const helperPackages = new Set();
  const marksByHost = new Map();
  const sourcesSeen = new Set();
  let katexCssRoot = null;

  for (const { id, renderedLength } of modules) {
    if (!contributes(id, renderedLength)) continue;
    if (id.startsWith("\0")) {
      const helper = helpers.find((h) => h.id === id);
      if (helper) helperPackages.add(helper.package);
      else problems.push(`virtual module ${JSON.stringify(id)} is not in BUILD_HELPERS`);
      continue;
    }
    const pkg = packageOfModuleId(id);
    if (!pkg) continue; // the app's own code
    roots.set(pkg.root, pkg.name);
    if (pkg.name === "katex" && /\/katex(\.min)?\.css($|\?)/.test(id)) katexCssRoot = pkg.root;
    const file = id.split("?")[0];
    if (sourcesSeen.has(file) || /\.css$/.test(file)) continue;
    sourcesSeen.add(file);
    const source = fs.readText(file);
    const found = marksOf(source);
    const marks = marksByHost.get(pkg.name) ?? { paths: [], requires: [], legal: [], versions: [], sources: [] };
    for (const kind of ["paths", "requires", "legal", "versions"]) {
      for (const value of found[kind]) if (!marks[kind].includes(value)) marks[kind].push(value);
    }
    marks.sources.push(source);
    marksByHost.set(pkg.name, marks);
  }
  for (const name of helperPackages) roots.set(`${base}/${name}`, name);

  // tools/third-party-licenses/ (texts saved from npm tarballs) is next to node_modules' project.
  const savedDir = `${base.slice(0, base.lastIndexOf("/"))}/tools/third-party-licenses`;
  const textOf = (dir, part, where) => {
    if (part.pending) {
      pending.push(`${where}: ${part.pending}`);
      return null;
    }
    const raw = fs.readText(part.saved ? `${savedDir}/${part.saved}` : `${dir}/${part.file}`);
    let text = part.legal ? legalCommentOf(raw, part.legal) : excerptOf(raw, part);
    if (part.uncomment) text = uncomment(text);
    return text.replace(/\r\n?/g, "\n").trim();
  };

  const entries = [];
  const bundledNames = new Set(roots.values());
  for (const [root, name] of [...roots].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pkg = JSON.parse(fs.readText(`${root}/package.json`));
    const where = `${name}@${pkg.version}`;
    const published = typeof pkg.license === "string" ? pkg.license : undefined;
    const override = overrides[name];
    if (override && override.published !== published) {
      problems.push(`${where}: package.json says license ${JSON.stringify(published)}, the override in tools/third-party-extras.mjs expects ${JSON.stringify(override.published)}`);
      continue;
    }
    const license = override?.license ?? published;
    if (!ALLOWED_LICENSES.has(license)) {
      problems.push(`${where}: license ${JSON.stringify(license)} is not allowed (ALLOWED_LICENSES in tools/notices.mjs)`);
      continue;
    }
    let texts;
    try {
      texts = override?.texts
        ? override.texts.map((part) => textOf(root, part, where))
        : fs
            .list(root)
            .filter(isLicenseFileName)
            .sort()
            .map((file) => fs.readText(`${root}/${file}`).replace(/\r\n?/g, "\n").trim());
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
    entries.push({ name, version: pkg.version, license, note: override?.note, texts });
  }

  problems.push(...checkMarks(marksByHost, bundledNames, { embedded, ignored }));
  for (const item of embedded) {
    if (!bundledNames.has(item.host)) continue;
    if (!ALLOWED_LICENSES.has(item.license)) {
      problems.push(`${item.name} (inside ${item.host}): license ${JSON.stringify(item.license)} is not allowed`);
      continue;
    }
    const where = `${item.name} (inside ${item.host})`;
    let texts;
    try {
      texts = item.texts.map((part) => textOf(base, part, where)).filter((t) => t !== null && t !== "");
    } catch (error) {
      problems.push(`${where}: ${error.message}`);
      continue;
    }
    entries.push({ name: item.name, version: item.version, license: item.license, note: `inside ${item.host}`, texts });
  }

  if (katexCssRoot) {
    const katex = JSON.parse(fs.readText(`${katexCssRoot}/package.json`));
    const fontDir = `${katexCssRoot}/dist/fonts`;
    // One notice per font family (each names its Reserved Font Name).
    const fonts = fs.list(fontDir).filter((f) => f.endsWith(".ttf")).sort();
    const notices = [...new Set(fonts.map((f) => fontLicenseOf(fs.readBytes(`${fontDir}/${f}`))))];
    if (notices.length === 0) problems.push(`KaTeX fonts: no .ttf in ${fontDir} to read the font notices from`);
    const ofl = textOf(base, extras?.ofl ?? OFL_TEXT, `KaTeX fonts ${katex.version}`);
    entries.push({
      name: "KaTeX fonts",
      version: katex.version,
      license: "OFL-1.1",
      note: "the woff2 fonts in the KaTeX CSS",
      texts: [notices.join("\n\n"), ...(ofl ? [ofl] : [])],
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
