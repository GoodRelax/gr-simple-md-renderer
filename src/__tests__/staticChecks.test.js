import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import { parseAst } from "vite";

// AT-STA: static checks over src/js (test design 3.18). No new dependency:
// the AST comes from vite's parseAst, like the @purity checker.

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(here, "../js");

function listJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) return listJs(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

const FILES = listJs(jsDir);
const rel = (f) => relative(jsDir, f).replace(/\\/g, "/");
const read = (f) => readFileSync(f, "utf8");

/** Source without comments (strings and regex literals stay). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object" && typeof value.type === "string") walk(value, visit);
  }
}

/** Identifier names, member expressions "a.b" and import sources of a file. */
function scan(file) {
  const ast = parseAst(read(file));
  const identifiers = new Set();
  const members = new Set();
  const imports = [];
  walk(ast, (node) => {
    if (node.type === "Identifier") identifiers.add(node.name);
    if (node.type === "ImportDeclaration") imports.push(node.source.value);
    if (node.type === "MemberExpression" && node.object.type === "Identifier" && node.property.type === "Identifier") {
      members.add(`${node.object.name}.${node.property.name}`);
    }
  });
  return { identifiers, members, imports };
}

const NEW_FILES = [
  "classes/DocumentSession.js",
  "classes/DocumentLocation.js",
  "classes/MarkdownBlockModel.js",
  "classes/BlockDiff.js",
  "classes/MarkdownTextOps.js",
  "classes/MarkdownFileAccess.js",
  "classes/SaveDocument.js",
  "classes/SaveDocumentAs.js",
  "classes/BlockEditController.js",
  "classes/EditPalette.js",
  "textTransforms.js",
];

const ENTITY_FILES = [
  "classes/MarkdownBlockModel.js",
  "classes/BlockDiff.js",
  "classes/MarkdownTextOps.js",
  "classes/DocumentSession.js",
  "textTransforms.js",
];

describe("AT-STA static checks of src/js", () => {
  it("covers the new files", () => {
    const names = FILES.map(rel);
    for (const f of NEW_FILES) expect(names, f).toContain(f);
  });

  it("AT-STA-01 no storage API at all (CON-13)", () => {
    const pattern = /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie|\bcaches\.|navigator\.storage/;
    for (const f of FILES) expect(stripComments(read(f)), rel(f)).not.toMatch(pattern);
  });

  it("AT-STA-02 fetch( only in DiagramCopyController.js (2); no XMLHttpRequest / sendBeacon / WebSocket / EventSource (CON-14)", () => {
    const counts = {};
    for (const f of FILES) {
      const src = stripComments(read(f));
      const n = (src.match(/\bfetch\(/g) || []).length;
      if (n) counts[rel(f)] = n;
      expect(src, rel(f)).not.toMatch(/\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b/);
    }
    expect(counts).toEqual({ "classes/DiagramCopyController.js": 2 });
  });

  it("AT-STA-03 every file is ASCII only (CON-06)", () => {
    for (const f of FILES) {
      const bytes = readFileSync(f);
      expect(bytes.some((b) => b > 0x7f), rel(f)).toBe(false);
    }
  });

  it("AT-STA-04 no inline event handler in HTML strings, no setAttribute('on...') (INV-20)", () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
      expect(src, rel(f)).not.toMatch(/setAttribute\(\s*["']on[a-z]/i);
    }
  });

  it("AT-STA-05 the pure entities import no config and use no window / document / Date.now / Math.random", () => {
    for (const name of ENTITY_FILES) {
      const { identifiers, members, imports } = scan(resolve(jsDir, name));
      expect(imports.filter((i) => i.includes("config")), name).toEqual([]);
      expect(identifiers.has("window"), name).toBe(false);
      expect(identifiers.has("document"), name).toBe(false);
      expect(members.has("Date.now"), name).toBe(false);
      expect(members.has("Math.random"), name).toBe(false);
    }
  });

  it("AT-STA-06 no _mdFileHandle / readMarkdownFile in src/js; no fileHandle in the entities (INV-55)", () => {
    for (const f of FILES) {
      const { identifiers } = scan(f);
      expect(identifiers.has("_mdFileHandle"), rel(f)).toBe(false);
      expect(identifiers.has("readMarkdownFile"), rel(f)).toBe(false);
    }
    for (const name of ENTITY_FILES) {
      expect(scan(resolve(jsDir, name)).identifiers.has("fileHandle"), name).toBe(false);
    }
  });

  it("AT-STA-07 src/js never makes rendered output editable (OS-13)", () => {
    for (const f of FILES) {
      const src = stripComments(read(f));
      expect(src, rel(f)).not.toMatch(/\bcontentEditable\s*=/);
      expect(src, rel(f)).not.toMatch(/["']contenteditable["']/i);
    }
  });
});
