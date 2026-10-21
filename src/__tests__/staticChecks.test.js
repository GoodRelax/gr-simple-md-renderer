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
  "classes/MarkdownTable.js",
  "textTransforms.js",
  "textWidth.js",
];

const ENTITY_FILES = [
  "classes/MarkdownBlockModel.js",
  "classes/BlockDiff.js",
  "classes/MarkdownTextOps.js",
  "classes/DocumentSession.js",
  "classes/MarkdownTable.js",
  "textTransforms.js",
  "textWidth.js",
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

// ---- style.css (AT-PAL-27 and the editing rules; the look itself is PRT-V) ----

const css = readFileSync(resolve(here, "../css/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of every "@media print { ... }" block, joined. */
function printBlocks(text) {
  const out = [];
  let i = text.indexOf("@media print");
  while (i >= 0) {
    const open = text.indexOf("{", i);
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      if (text[j] === "}" && --depth === 0) break;
    }
    out.push(text.slice(open + 1, j));
    i = text.indexOf("@media print", j);
  }
  return out.join("\n");
}

/** The declarations of the first rule whose selector list has exactly this selector. */
function ruleBody(text, selector) {
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return m[2];
  }
  return null;
}

describe("style.css for in-place editing", () => {
  it("AT-PAL-27 @media print hides the palette, the popover, the hidden-block bands and the editor frame", () => {
    const print = printBlocks(css);
    for (const sel of [".edit-palette", ".edit-palette-popover", ".md-block-hidden"]) {
      expect(print, sel).toContain(sel);
    }
    expect(ruleBody(print, ".edit-palette")).toMatch(/display:\s*none/);
    expect(ruleBody(print, ".md-block-hidden")).toMatch(/display:\s*none/);
    expect(ruleBody(print, ".md-block-editor")).toMatch(/border:\s*none/);
  });

  it("the block editor is border-box and full width; no inner scroll bar (INV-40)", () => {
    const body = ruleBody(css, ".md-block-editor");
    expect(body).toMatch(/box-sizing:\s*border-box/);
    expect(body).toMatch(/width:\s*100%/);
    expect(body).toMatch(/overflow-y:\s*hidden/);
    expect(body).toMatch(/font-family:[^;]*monospace;/);
  });

  it("bands and the empty block show only in edit mode (INV-41, INV-49)", () => {
    expect(ruleBody(css, ".md-block-hidden")).toMatch(/display:\s*none/);
    expect(ruleBody(css, ".md-block-empty")).toMatch(/display:\s*none/);
    expect(css).toMatch(/body\.edit-mode \.md-block-hidden/);
    expect(css).toMatch(/body\.edit-mode \.md-block-empty/);
  });

  it("palette, popover and pending-box classes exist for light and dark (5.15.2)", () => {
    for (const sel of [".edit-palette", ".edit-palette-btn", ".edit-palette-popover", ".edit-palette-grip", ".edit-palette-status", ".plantuml-pending"]) {
      expect(css, sel).toContain(sel);
      expect(css, `.dark ${sel}`).toContain(`.dark ${sel}`);
    }
  });

  it("the palette is a 7-column grid with no separators; minimized and swatch rules exist (5.15.1, INV-68)", () => {
    expect(css).not.toContain("edit-palette-sep");
    expect(ruleBody(css, ".edit-palette-row")).toMatch(/grid-template-columns:\s*repeat\(7, 28px\)/);
    expect(css).toMatch(/\.edit-palette\.edit-palette-minimized\.edit-palette-unsaved \.edit-palette-grip::after/);
    // Minimized: everything but the grip is hidden (the other buttons, the second row, the status).
    const hiding = ruleBody(css, ".edit-palette.edit-palette-minimized .edit-palette-row > :not(.edit-palette-grip)");
    expect(hiding).toMatch(/display:\s*none/);
    expect(ruleBody(css, ".edit-palette.edit-palette-minimized .edit-palette-row + .edit-palette-row")).toBe(hiding);
    expect(ruleBody(css, ".edit-palette.edit-palette-minimized .edit-palette-status")).toBe(hiding);
    expect(ruleBody(css, ".edit-palette-status")).toMatch(/max-width:\s*220px/);
    expect(css).toMatch(/\.edit-palette-btn\[aria-disabled="true"\]/);
    expect(css).not.toMatch(/edit-palette-btn:disabled|edit-palette-btn:focus-visible/);
    for (const [color, light, dark] of [["red", "#B84F00", "#E0661A"], ["blue", "#0072B2", "#56B4E9"], ["green", "#007A58", "#009E73"]]) {
      const sel = `.edit-palette-swatch-${color}:not([aria-disabled="true"])`;
      expect(ruleBody(css, sel), sel).toContain(`color: ${light};`);
      expect(ruleBody(css, `.dark ${sel}`), sel).toContain(`color: ${dark};`);
    }
  });

  it("the block editor and #editor use the full-width monospace system fonts (5.14.13, INV-61); no @font-face", () => {
    const stack = /font-family:\s*"BIZ UDGothic", "MS Gothic", "Osaka-Mono", "Noto Sans Mono CJK JP", monospace;/;
    expect(ruleBody(css, "#editor")).toMatch(stack);
    expect(ruleBody(css, ".md-block-editor")).toMatch(stack);
    expect(css).not.toMatch(/@font-face/);
    const bec = readFileSync(resolve(jsDir, "classes/BlockEditController.js"), "utf8");
    expect(bec).not.toMatch(/fontFamily/); // the CSS decides the editor font
  });

  it("no url() in the editing rules (CSP, no external fetch)", () => {
    const editing = css.split("\n").filter((line) => /edit-palette|md-block|plantuml-pending/.test(line)).join("\n");
    expect(editing).not.toMatch(/url\(/);
  });
});
