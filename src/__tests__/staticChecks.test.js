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
  "classes/DocumentLifecycle.js",
  "classes/BlockEditController.js",
  "classes/EditPalette.js",
  "classes/MarkdownTable.js",
  "classes/InlineRuns.js",
  "classes/InvisibleCharOverlay.js",
  "classes/TableCellEditor.js",
  "classes/ClipboardLink.js",
  "textTransforms.js",
  "textWidth.js",
];

const ENTITY_FILES = [
  "classes/MarkdownBlockModel.js",
  "classes/BlockDiff.js",
  "classes/MarkdownTextOps.js",
  "classes/DocumentSession.js",
  "classes/MarkdownTable.js",
  "classes/InlineRuns.js",
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

  it("AT-STA-17 DocumentLifecycle (UseCase) imports no config and uses no window / document; UIController keeps no file access (INV-55)", () => {
    const { identifiers, imports } = scan(resolve(jsDir, "classes/DocumentLifecycle.js"));
    expect(imports.filter((i) => i.includes("config"))).toEqual([]);
    expect(identifiers.has("window")).toBe(false);
    expect(identifiers.has("document")).toBe(false);
    const ui = scan(resolve(jsDir, "classes/UIController.js"));
    for (const name of ["fileAccess", "DocumentSession", "DocumentLocation", "SaveDocument", "SaveDocumentAs"]) {
      expect(ui.identifiers.has(name), name).toBe(false);
    }
  });

  it("AT-STA-07 only TableCellEditor.js makes rendered output editable, with plaintext-only or true (OS-13, INV-62)", () => {
    for (const f of FILES) {
      const src = stripComments(read(f));
      if (rel(f).endsWith("TableCellEditor.js")) {
        const values = [...src.matchAll(/\bcontentEditable\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
        expect(values.length).toBeGreaterThan(0);
        for (const v of values) expect(['"plaintext-only"', '"true"']).toContain(v);
        continue;
      }
      expect(src, rel(f)).not.toMatch(/\bcontentEditable\s*=/);
      expect(src, rel(f)).not.toMatch(/["']contenteditable["']/i);
    }
  });

  it("AT-STA-15 the check below finds prose and skips code, console.* and errors", () => {
    const found = (src) => proseLiterals(src).map((p) => p.text);
    expect(found('el.title = "Copy SVG";')).toEqual(["Copy SVG"]);
    expect(found('t("This format cannot be applied here.");')).toEqual(["This format cannot be applied here."]);
    expect(found("const s = `${n} lines`;")).toEqual([]);
    expect(found("const s = `Updated: ${when}`;")).toEqual(["Updated: X"]);
    expect(found('x.label = `Bold (${mod}+B)`;')).toEqual(["Bold (X+B)"]);
    expect(found('btn.textContent = "Copied!";')).toEqual(["Copied!"]);
    expect(found('console.error("SVG copy failed:", err);')).toEqual([]);
    expect(found('throw new Error("Bad state.");')).toEqual([]);
    expect(found('reject(new TypeError("Not a file."));')).toEqual([]);
    expect(found('q("code.language-plantuml, code.language-puml");')).toEqual([]);
    expect(found('const a = \'fill="none" stroke="currentColor"\';')).toEqual([]);
    expect(found('const a = \'<svg viewBox="0 0 24 24"><path d="M4 6h16"/></svg>\';')).toEqual([]);
    expect(found('const h = `<pre style="color:red;">Parse Error: ${m}</pre>`;')).toEqual(['<pre style="color:red;">Parse Error: X</pre>']);
    expect(found('const d = "5.0,3.0,f.0,nw.1,3.";')).toEqual([]);
    expect(found('if (e.key === "ArrowUp") go(" ");')).toEqual([]);
    expect(found('import x from "./A b.js";')).toEqual([]);
    // one word put where the user sees it (strict review L3)
    expect(found('btn.textContent = "Failed";')).toEqual(["Failed"]);
    expect(found('tab.innerText = "Markdown";')).toEqual(["Markdown"]);
    expect(found('img.alt = "Diagram";')).toEqual(["Diagram"]);
    expect(found('b.setAttribute("aria-label", "Bold");')).toEqual(["Bold"]);
    expect(found('b.setAttribute("title", `${mod}+B`);')).toEqual(["X+B"]);
    expect(found('showToast("Saved", 3000);')).toEqual(["Saved"]);
    expect(found('window.confirm("Sure");')).toEqual(["Sure"]);
    expect(found('alert("Oops");')).toEqual(["Oops"]);
    expect(found('el.textContent = "";')).toEqual([]);
    expect(found('el.textContent = "\\u00a0";')).toEqual([]);
    expect(found('el.textContent = label;')).toEqual([]);
    expect(found('el.setAttribute("data-kind", "table");')).toEqual([]);
  });

  it("AT-STA-15 no user-visible English text in src/js outside config.js (R15: all UI strings in CONFIG)", () => {
    const left = [];
    for (const f of FILES) {
      if (rel(f) === "config.js") continue;
      for (const { text, line } of proseLiterals(read(f))) left.push(`${rel(f)}:${line} ${JSON.stringify(text)}`);
    }
    expect(left).toEqual([]);
  });
});

/**
 * String and template literals of a JS source that read like UI text: the
 * text (HTML tags removed, a template's ${...} read as "X") ends a sentence
 * (a word of 2+ letters, then . ? !, as in "Copied!" or "... here."), or
 * holds a space and starts like a word (uppercase, then lowercase, as in
 * "Copy SVG"). Code-like strings (selectors, attribute lists, SVG markup,
 * key names, packed data) do neither. Also, whatever its form (one word
 * too), a literal with a letter put where the user sees it: assigned to
 * textContent / innerText / title / alt / placeholder / label, set as the
 * aria-label / title / alt / placeholder attribute, or passed to
 * showToast / alert / confirm (strict review L3). Skipped: console.* calls,
 * thrown or constructed errors (developer text) and import / export
 * sources. Comments are not literals, so they never match.
 * @param {string} src
 * @returns {{text: string, line: number}[]}
 */
function proseLiterals(src) {
  const out = [];
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;
  const isProse = (text) => {
    const t = text.replace(/<[^>]*>/g, " ").trim();
    if (/[A-Za-z]{2}[.?!]$/.test(t)) return true;
    return /\s/.test(t) && /^[A-Z][a-z]/.test(t);
  };
  const isErrorCtor = (node) => node.callee?.type === "Identifier" && /Error$/.test(node.callee.name);
  const textOf = (node) => {
    if (node?.type === "Literal" && typeof node.value === "string") return node.value;
    if (node?.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("X");
    return null;
  };
  const SHOWN_PROPS = new Set(["textContent", "innerText", "title", "alt", "placeholder", "label"]);
  const SHOWN_ATTRS = new Set(["aria-label", "title", "alt", "placeholder"]);
  const SHOWING_CALLS = new Set(["showToast", "alert", "confirm"]);
  const calleeName = (callee) => (callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" ? callee.property.name : null);
  // the literal a node puts where the user sees it, or null
  const shownLiteral = (node) => {
    if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression" && SHOWN_PROPS.has(node.left.property.name)) return node.right;
    if (node.type !== "CallExpression") return null;
    const name = calleeName(node.callee);
    if (name === "setAttribute" && SHOWN_ATTRS.has(textOf(node.arguments[0]))) return node.arguments[1];
    return SHOWING_CALLS.has(name) ? node.arguments[0] : null;
  };
  const seen = new Set(); // literals already reported by the sink rule
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ThrowStatement") return;
    if (node.type === "ExportNamedDeclaration" && node.source) return;
    if (node.type === "ImportExpression") return;
    if (node.type === "NewExpression" && isErrorCtor(node)) return;
    if (node.type === "CallExpression" && (isErrorCtor(node) || (node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier" && node.callee.object.name === "console"))) return;
    const shown = shownLiteral(node);
    const shownText = shown ? textOf(shown) : null;
    if (shownText !== null && /[A-Za-z]/.test(shownText) && !isProse(shownText)) {
      out.push({ text: shownText, line: lineOf(shown.start) });
      seen.add(shown);
    }
    if (node.type === "Literal" && typeof node.value === "string" && !seen.has(node) && isProse(node.value)) {
      out.push({ text: node.value, line: lineOf(node.start) });
    }
    if (node.type === "TemplateLiteral" && !seen.has(node)) {
      const text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("X");
      if (isProse(text)) out.push({ text, line: lineOf(node.start) });
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && typeof value.type === "string") visit(value);
    }
  };
  visit(parseAst(src));
  return out;
}

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
    for (const sel of [".edit-palette", ".edit-palette-popover", "#preview > .md-block-hidden"]) {
      expect(print, sel).toContain(sel);
    }
    expect(ruleBody(print, ".edit-palette")).toMatch(/display:\s*none/);
    expect(ruleBody(print, "#preview > .md-block-hidden")).toMatch(/display:\s*none/);
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
    expect(ruleBody(css, "#preview > .md-block-hidden")).toMatch(/display:\s*none/);
    expect(ruleBody(css, "#preview > .md-block-empty")).toMatch(/display:\s*none/);
    expect(ruleBody(css, "body.edit-mode #preview > .md-block-hidden")).toMatch(/display:\s*block/);
    expect(ruleBody(css, "body.edit-mode #preview > .md-block-empty")).toMatch(/display:\s*block/);
  });

  it("AT-STA-14 the app's classes hide or style only the renderer's own elements (release test N2) and the band's cursor wins (N3)", () => {
    // a document's own class="grsmd-table-tab" / "md-block-hidden" / "md-block-empty"
    // sits inside a block wrapper, never as a child of #preview or of a table block
    for (const cls of ["grsmd-table-tab", "md-block-hidden", "md-block-empty"]) {
      for (const m of css.matchAll(/([^{}]+)\{/g)) {
        for (const selector of m[1].split(",").map((x) => x.trim())) {
          if (!selector.includes(`.${cls}`)) continue;
          const scoped = cls === "grsmd-table-tab" ? "#preview > .md-block-table > .grsmd-table-tab" : `#preview > .${cls}`;
          const hover = `#preview > .md-block.${cls}:not(.md-block-editing):hover`;
          expect(selector.includes(scoped) || selector.includes(hover), selector).toBe(true);
        }
      }
    }
    expect(ruleBody(css, "body.edit-mode #preview > .md-block.md-block-hidden:not(.md-block-editing):hover")).toMatch(/cursor:\s*pointer/);
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

  it("AT-STA-12 no url() in the editing rules, selectors and declarations both (CSP, no external fetch; review T-5)", () => {
    /** The rules (innermost: inside @media too) whose selector names an editing class, with url() in the body. */
    const withUrl = (text) => {
      const out = [];
      for (const m of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim();
        if (/edit-palette|md-block|md-invisible|grsmd-|plantuml-pending/.test(selector) && /url\(/i.test(m[2])) out.push(selector);
      }
      return out;
    };
    // the check sees a declaration on its own line and a rule inside @media
    expect(withUrl(".grsmd-cell-raw {\n  background: url(x.png);\n}")).toEqual([".grsmd-cell-raw"]);
    expect(withUrl("@media screen {\n  .dark .edit-palette {\n    background-image: URL(x);\n  }\n}")).toEqual([".dark .edit-palette"]);
    expect(withUrl(".other {\n  background: url(x.png);\n}")).toEqual([]);
    expect(withUrl(css)).toEqual([]);
  });
});

describe("style.css: toasts (R11)", () => {
  it("AT-STA-16 a toast wraps inside the screen; the container is never wider than the screen", () => {
    const toast = ruleBody(css, ".toast");
    expect(toast).not.toMatch(/white-space:\s*nowrap/);
    expect(toast).toMatch(/white-space:\s*normal/);
    expect(toast).toMatch(/max-width:\s*calc\(100vw - 32px\)/);
    expect(toast).toMatch(/text-align:\s*center/);
    // the screen rule (the print rule only hides it)
    const container = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].trim() === "#toastContainer" && /position:\s*fixed/.test(m[2]))
      .map((m) => m[2]);
    expect(container).toHaveLength(1);
    expect(container[0]).toMatch(/max-width:\s*calc\(100vw - 32px\)/);
  });
});

describe("style.css: the marks layer has the block editor's text box (INV-70)", () => {
  /** The declarations of a rule as {property: value}. */
  function declarations(selector) {
    const body = ruleBody(css, selector);
    expect(body, selector).not.toBe(null);
    const out = {};
    for (const m of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  }

  it("AT-STA-08 the same font, size, line height, padding, border width and radius, box, wrapping and tab size", () => {
    const editor = declarations(".md-block-editor");
    const layer = declarations(".md-invisible-overlay");
    for (const key of ["font-family", "font-size", "line-height", "padding", "border-radius", "box-sizing", "white-space", "overflow-wrap", "tab-size"]) {
      expect(layer[key], key).toBe(editor[key]);
    }
    expect(layer.border.split(/\s+/)[0]).toBe(editor.border.split(/\s+/)[0]);
    expect(layer.border).toMatch(/transparent$/);
  });

  it("AT-STA-09 the layer has the editor's ground (light and dark); the overlaid editor is transparent", () => {
    expect(declarations(".md-invisible-overlay").background).toBe(declarations(".md-block-editor").background);
    expect(declarations(".dark .md-invisible-overlay").background).toBe(declarations(".dark .md-block-editor").background);
    expect(declarations(".md-block-editor.md-block-editor-overlaid").background).toBe("transparent");
  });

  it("AT-STA-10 print hides the layer (INV-53)", () => {
    expect(ruleBody(printBlocks(css), ".md-invisible-overlay")).toMatch(/display:\s*none/);
  });
});

describe("style.css: table cells (INV-62, INV-53)", () => {
  it("AT-STA-11 the open cell keeps its spaces (pre-wrap); print hides the tab, the cell frame and the raw ground", () => {
    expect(ruleBody(css, "#preview td.grsmd-cell-editing")).toMatch(/white-space:\s*pre-wrap/);
    const print = printBlocks(css);
    expect(ruleBody(print, "#preview > .md-block-table > .grsmd-table-tab")).toMatch(/display:\s*none/);
    expect(ruleBody(print, "#preview td.grsmd-cell-editing")).toMatch(/outline:\s*none/);
    expect(ruleBody(print, "#preview td.grsmd-cell-raw")).toMatch(/background:\s*none/);
  });
});
