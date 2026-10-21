// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast } from "./helpers/contrast.js";

// AT-THM: the color table of spec 5.8.1 (GitHub / Primer colors, both themes)
// and 5.15.2, read from style.css. The look itself is PRT-X16 / PRT-V10; the
// effective colors in a real browser are checked by e2e/theme.e2e.js.

const here = dirname(fileURLToPath(import.meta.url));
const rawCss = readFileSync(resolve(here, "../css/style.css"), "utf8");
const mainJs = readFileSync(resolve(here, "../js/main.js"), "utf8");

/**
 * Split style.css (comments removed) into the rules outside any @media block
 * and the bodies of the "@media screen" blocks.
 */
function split(text) {
  let outside = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const screen = [];
  const other = []; // @media blocks other than screen and print (pointer, ...)
  for (let i = outside.indexOf("@media"); i >= 0; i = outside.indexOf("@media")) {
    const open = outside.indexOf("{", i);
    let depth = 0;
    let j = open;
    for (; j < outside.length; j++) {
      if (outside[j] === "{") depth++;
      if (outside[j] === "}" && --depth === 0) break;
    }
    const query = outside.slice(i, open + 1);
    if (/^@media screen\s*\{/.test(query)) screen.push(outside.slice(open + 1, j));
    else if (!/^@media print\s*\{/.test(query)) other.push(outside.slice(open + 1, j));
    outside = outside.slice(0, i) + outside.slice(j + 1);
  }
  return { outside, screen: screen.join("\n"), other: other.join("\n") };
}

const { outside: outsideCss, screen: screenCss, other: otherMediaCss } = split(rawCss);
// What the screen shows: the rules outside @media plus the screen-only ones.
const css = `${outsideCss}\n${screenCss}`;

/** The bodies of every "@media print { ... }" block, joined (comments removed). */
function printBlocks(text) {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (let i = plain.indexOf("@media print"); i >= 0; i = plain.indexOf("@media print", i + 1)) {
    const open = plain.indexOf("{", i);
    let depth = 0;
    let j = open;
    for (; j < plain.length; j++) {
      if (plain[j] === "{") depth++;
      if (plain[j] === "}" && --depth === 0) break;
    }
    out.push(plain.slice(open + 1, j));
  }
  return out.join("\n");
}

const printCss = printBlocks(rawCss);

/**
 * The declarations for one exact selector, merged over every rule of `source`
 * (top-level rules by default) whose selector list holds it (later rules win,
 * as in the cascade).
 */
function declarations(selector, source = css) {
  const out = {};
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

const value = (selector, property) => declarations(selector)[property];

// Spec 5.8.1, dark column (Primer dark). Screen only (see AT-THM-18).
const DARK = [
  ["body.dark", "background", "#0d1117"],
  ["body.dark", "color", "#f0f6fc"],
  [".dark #preview", "background-color", "#0d1117"],
  [".dark #preview", "color", "#f0f6fc"],
  [".dark #topbar", "background", "#151b23"],
  [".dark #topbar", "border-bottom", "1px solid #3d444d"],
  [".dark #editor", "border-color", "#3d444d"],
  [".dark #editor", "color", "#f0f6fc"],
  [".dark pre", "background", "#151b23"],
  [".dark pre", "border", "1px solid #3d444d"],
  [".dark #preview a", "color", "#4493f8"],
  [".dark #copyright a", "color", "#4493f8"],
  [".dark #preview th", "border-color", "#3d444d"],
  [".dark #preview td", "border-color", "#3d444d"],
  [".dark blockquote", "color", "#9198a1"],
  [".dark blockquote", "border-left-color", "#3d444d"],
  [".dark .modal-content", "background-color", "#151b23"],
  [".dark .modal-content", "color", "#f0f6fc"],
  [".dark .modal-content", "border", "1px solid #3d444d"],
  [".dark .modal-section h3", "border-bottom-color", "#3d444d"],
  [".dark .close-btn", "color", "#9198a1"],
  [".dark .close-btn:hover", "color", "#f0f6fc"],
  [".dark #promptText", "background", "#0d1117"],
  [".dark #promptText", "border", "1px solid #3d444d"],
  [".dark #promptText", "color", "#f0f6fc"],
  [".dark .plantuml-error", "background-color", "#f851491a"],
  [".dark .plantuml-error", "color", "#f85149"],
  [".dark .plantuml-error", "border-color", "#da3633"],
  [".dark .external-image-placeholder", "background-color", "#151b23"],
  [".dark .external-image-placeholder", "color", "#9198a1"],
  [".dark .external-image-placeholder", "border-color", "#656c76"],
  [".dark .plantuml-pending", "background-color", "#151b23"],
  [".dark .plantuml-pending", "color", "#9198a1"],
  [".dark .plantuml-pending", "border-color", "#656c76"],
  [".dark #affordanceText", "color", "#9198a1"],
  [".dark #fileInfo", "background", "#151b23"],
  [".dark #fileInfo", "color", "#9198a1"],
  [".dark #fileInfo", "border-color", "#3d444d"],
  ["body.view-code.dark #fileInfo", "background", "#1A1E2E"],
  ["body.view-code.dark #fileInfo", "border-color", "#3d444d"],
  ["body.dark #keyHint", "background", "#3d444d"],
  ["body.dark #keyHint", "color", "#ffffff"],
  [".dark .toast", "background", "#3d444d"],
  [".dark .toast", "color", "#ffffff"],
  ["body.dark #codeViewBody", "background", "#0d1117"],
  ["body.dark #codeViewBody", "color", "#f0f6fc"],
  ["body.dark .code-line::before", "color", "#9198a1"],
  ["body.dark .code-line:hover", "background", "#151b23"],
  [".dark .diagram-copy-btn", "background", "#212830"],
  [".dark .diagram-copy-btn", "border-color", "#3d444d"],
  [".dark .diagram-copy-btn", "color", "#f0f6fc"],
  [".dark .md-block-editor", "color", "#f0f6fc"],
  [".dark .md-block-editor", "background", "#010409"],
  [".dark .md-block-editor", "border-color", "#1f6feb"],
  [".dark .md-block-editor:focus", "outline-color", "#1f6feb"],
  [".dark .md-invisible-overlay", "background", "#010409"],
  [".dark .grsmd-invisible", "background", "#bb800926"],
  ["body.dark.edit-mode #preview > .md-block:hover", "outline-color", "#656c76"],
  ["body.dark.edit-mode .md-block-hidden", "border-color", "#656c76"],
  ["body.dark.edit-mode .md-block-empty", "border-color", "#656c76"],
  [".dark #preview td.grsmd-cell-editing", "outline-color", "#1f6feb"],
  [".dark #preview th.grsmd-cell-editing", "outline-color", "#1f6feb"],
  [".dark #preview td.grsmd-cell-raw", "background", "#bb800926"],
  [".dark #preview th.grsmd-cell-raw", "background", "#bb800926"],
];

// Spec 5.8.1, light column: owner ruling 2026-10-21 (Primer light for the
// preview and the code view) and G6 (the editing blue).
const LIGHT = [
  ["#preview", "color", "#1f2328"],
  ["#preview a", "color", "#0969da"],
  ["pre", "background", "#f6f8fa"],
  ["blockquote", "color", "#59636e"],
  ["blockquote", "border-left", "4px solid #d1d9e0"],
  ["#preview th", "border", "1px solid #d1d9e0"],
  ["#preview td", "border", "1px solid #d1d9e0"],
  ["#codeViewBody", "background", "#ffffff"],
  ["#codeViewBody", "color", "#1f2328"],
  [".code-line::before", "color", "#59636e"],
  [".md-block-editor", "background", "#fffdf5"],
  [".md-block-editor", "border", "1px solid #0969da"],
  [".md-block-editor:focus", "outline", "2px solid #0969da"],
  [".md-invisible-overlay", "background", "#fffdf5"],
  [".grsmd-invisible", "background", "#fff8c5"],
  ["#preview td.grsmd-cell-editing", "outline", "2px solid #0969da"],
  ["#preview td.grsmd-cell-raw", "background", "#fff8c5"],
];

// Owner ruling 2026-10-21: the light top bar and the #editor grounds (both
// themes, CONFIG.editorColors) do not change.
const UNCHANGED = [
  ["#topbar", "background", "#f0f0f0"],
  ["#topbar", "border-bottom", "1px solid #ccc"],
  ["body.view-markdown #editor", "background", "#FFF8F0"],
  ["body.view-markdown.dark #editor", "background", "#2D2520"],
  ["body.view-code #editor", "background", "#F0F4FF"],
  ["body.view-code.dark #editor", "background", "#1A1E2E"],
  ["#copyright a", "color", "blue"],
  ["#keyHint", "background", "rgba(40, 40, 40, 0.8)"],
  ["#keyHint", "color", "#eeeeee"],
  [".toast", "background", "rgba(50, 50, 50, 0.92)"],
  [".code-line:hover", "background", "rgba(0, 0, 0, 0.03)"],
];

// Spec 5.15.2 (edit palette).
const PRESSED = '.edit-palette-btn[aria-pressed="true"]';
const DISABLED = '.edit-palette-btn[aria-disabled="true"]';
const HOVER = '.edit-palette-btn:hover:not([aria-disabled="true"]):not([aria-pressed="true"])';
const UNSAVED_DOT = ".edit-palette.edit-palette-minimized.edit-palette-unsaved .edit-palette-grip::after";
const PALETTE = [
  [".dark .edit-palette", "background", "#151b23"],
  [".dark .edit-palette", "border-color", "#3d444d"],
  [".dark .edit-palette-popover", "background", "#151b23"],
  [".dark .edit-palette-popover", "border-color", "#3d444d"],
  [".dark .edit-palette-btn", "background", "#212830"],
  [".dark .edit-palette-btn", "border-color", "#3d444d"],
  [".dark .edit-palette-btn", "color", "#f0f6fc"],
  [`.dark ${HOVER}`, "background", "#262c36"],
  [`.dark ${PRESSED}`, "background", "#1f6feb"],
  [`.dark ${PRESSED}`, "color", "#ffffff"],
  [`.dark ${DISABLED}`, "color", "#656c76"],
  [`.dark ${DISABLED}`, "border-color", "#3d444db3"],
  [`.dark ${DISABLED}`, "background", "transparent"],
  [".dark .edit-palette-grip", "color", "#f0f6fc"],
  [".dark .edit-palette-status", "color", "#9198a1"],
  [PRESSED, "background", "#0969da"],
  [PRESSED, "color", "#ffffff"],
  [".edit-palette", "background", "#f6f7f8"],
  [".edit-palette-btn", "border", "1px solid #c4c7cb"],
  [".edit-palette-btn", "color", "#1f2328"],
  [HOVER, "background", "rgba(0, 0, 0, 0.06)"],
  [DISABLED, "color", "#b5b8bc"],
  [DISABLED, "border-color", "#e1e3e6"],
  [".edit-palette-btn", "background", "transparent"],
  [".edit-palette-status", "color", "#57606a"],
  [UNSAVED_DOT, "background", "#0969da"],
  [`.dark ${UNSAVED_DOT}`, "background", "#1f6feb"],
  // The text color swatches are checked in staticChecks.test.js (5.15.2).
];

// Spec 5.8.1, code highlighting: highlight.js classes grouped as in its
// github.css, with Primer 11.10.0 prettylights values [light, dark].
const SYNTAX = [
  ["keyword", [".hljs-doctag", ".hljs-keyword", ".hljs-meta .hljs-keyword", ".hljs-template-tag", ".hljs-template-variable", ".hljs-type", ".hljs-variable.language_"], "#cf222e", "#ff7b72"],
  ["entity", [".hljs-title", ".hljs-title.class_", ".hljs-title.class_.inherited__", ".hljs-title.function_"], "#6639ba", "#d2a8ff"],
  ["constant", [".hljs-attr", ".hljs-attribute", ".hljs-literal", ".hljs-meta", ".hljs-number", ".hljs-operator", ".hljs-variable", ".hljs-selector-attr", ".hljs-selector-class", ".hljs-selector-id"], "#0550ae", "#79c0ff"],
  ["string", [".hljs-regexp", ".hljs-string", ".hljs-meta .hljs-string"], "#0a3069", "#a5d6ff"],
  ["variable", [".hljs-built_in", ".hljs-symbol"], "#953800", "#ffa657"],
  ["comment", [".hljs-comment", ".hljs-code", ".hljs-formula"], "#59636e", "#9198a1"],
  ["entity-tag", [".hljs-name", ".hljs-quote", ".hljs-selector-tag", ".hljs-selector-pseudo"], "#0550ae", "#7ee787"],
  ["storage-modifier-import", [".hljs-subst"], "#1f2328", "#f0f6fc"],
  ["markup-heading", [".hljs-section"], "#0550ae", "#1f6feb"],
  ["markup-list", [".hljs-bullet"], "#3b2300", "#f2cc60"],
  ["markup-italic", [".hljs-emphasis"], "#1f2328", "#f0f6fc"],
  ["markup-bold", [".hljs-strong"], "#1f2328", "#f0f6fc"],
  ["plain text", [".hljs"], "#1f2328", "#f0f6fc"],
];
// [class, light color, light ground, dark color, dark ground]
const DIFF_MARKS = [
  [".hljs-addition", "#116329", "#dafbe1", "#aff5b4", "#033a16"],
  [".hljs-deletion", "#82071e", "#ffebe9", "#ffdcd7", "#67060c"],
];
// Grounds the code text sits on: pre and the code view.
const CODE_GROUNDS = { light: ["#f6f8fa", "#ffffff"], dark: ["#151b23", "#0d1117"] };
// Known limitation (spec 5.8.1): Primer's dark markup-heading on the dark grounds.
const LOW_CONTRAST = { "dark .hljs-section": { "#151b23": 3.74, "#0d1117": 4.08 } };

describe("theme colors in style.css (spec 5.8.1, 5.15.2)", () => {
  it.each(DARK)("AT-THM-01 dark: %s { %s: %s }", (selector, property, expected) => {
    expect(value(selector, property)).toBe(expected);
  });

  it.each(LIGHT)("AT-THM-02 light: %s { %s: %s }", (selector, property, expected) => {
    expect(value(selector, property)).toBe(expected);
  });

  it.each(UNCHANGED)("AT-THM-03 unchanged: %s { %s: %s }", (selector, property, expected) => {
    expect(value(selector, property)).toBe(expected);
  });

  it.each(PALETTE)("AT-THM-04 palette: %s { %s: %s }", (selector, property, expected) => {
    expect(value(selector, property)).toBe(expected);
  });

  it("AT-THM-05 inline code has a ground in both themes, rounded with side padding; no code inside pre", () => {
    const light = declarations("#preview code:not(pre code)");
    expect(light.background).toBe("#818b981f");
    expect(light["border-radius"]).toBe("6px");
    expect(light.padding).toBe("0.2em 0.4em");
    expect(value(".dark #preview code:not(pre code)", "background")).toBe("#656c7633");
    // No other rule gives code a ground (code inside pre keeps the pre's ground).
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(",").map((s) => s.trim());
      if (selectors.some((s) => /(^|[\s>])code\b/.test(s) && !/code:not\(pre code\)$/.test(s))) {
        expect(m[2], m[1]).not.toMatch(/background/);
      }
    }
  });

  it("AT-THM-06 highlighted code has no ground or padding of its own (the pre's shows); only diff marks have a ground", () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.hljs/.test(m[1]) || /\.hljs-(addition|deletion)\b/.test(m[1])) continue;
      expect(m[2], m[1]).not.toMatch(/background|padding/);
    }
  });

  it("AT-THM-07 the Mermaid container has a transparent ground", () => {
    expect(value(".mermaid", "background")).toBe("transparent");
  });

  it("AT-THM-08 the replaced colors are gone (old dark theme, the green editing color)", () => {
    for (const old of ["#1f7a3a", "#6fd08c", "#10301b", "#1b1d1f", "#5a5d62", "#2b2d30", "#45474b", "#66b3ff", "#5a5a5a", "#1e1e1e", "#d4d4d4", "#2b2b2b", "#2d1f1f"]) {
      expect(rawCss.toLowerCase(), old).not.toContain(old);
    }
  });

  it("AT-THM-09 the block editor and its marks layer share the ground in both themes (INV-70)", () => {
    expect(value(".dark .md-invisible-overlay", "background")).toBe(value(".dark .md-block-editor", "background"));
    expect(value(".md-invisible-overlay", "background")).toBe(value(".md-block-editor", "background"));
  });
});

describe("code block padding and print (spec 5.8.1, INV-53)", () => {
  it("AT-THM-16 a code block has GitHub's 16px padding (owner ruling 2026-10-22)", () => {
    expect(value("pre", "padding")).toBe("16px");
  });

  it.each([".md-block-editor", ".md-block-editor:focus"])(
    "AT-THM-17 print: %s shows no ground, border or focus ring (the dark rule is screen only)",
    (selector) => {
      const print = declarations(selector, printCss);
      expect(print.background, selector).toBe("none");
      expect(print.border, selector).toBe("none");
      expect(print.outline, selector).toBe("none");
    },
  );
});

describe("print keeps the light colors (spec 5.8.1, owner ruling 2026-10-22)", () => {
  // Every dark rule for what can be printed: the document, the code view,
  // the placeholders, the diagram copy buttons, the block editor and the
  // table cells of unit E (grsmd-cell-*).
  const printable = /#preview|(^|\s)pre\b|blockquote|\.hljs|#codeViewBody|\.code-line|\.plantuml|\.external-image|#affordanceText|\.md-block-editor|\.katex|\.diagram-copy|\.grsmd-cell|^body\.dark$/;
  // Edit-mode outlines and bands are hints on the screen, not printed content.
  const isPrintable = (selector) => printable.test(selector) && !/\.edit-mode\b/.test(selector);
  const darkPrintable = [
    ...DARK.map(([selector]) => selector),
    ...SYNTAX.flatMap(([, selectors]) => selectors.map((sel) => `body.dark ${sel}`)),
    ...DIFF_MARKS.map(([sel]) => `body.dark ${sel}`),
    ".dark .katex",
    ".dark .diagram-copy-btn",
    'body.dark #preview span[style*="#B84F00" i]',
  ].filter(isPrintable);

  it("AT-THM-18 (check of the check) the list covers the page, the preview, code, the code view and the editor", () => {
    for (const sel of ["body.dark", ".dark #preview", ".dark pre", "body.dark .hljs-keyword", "body.dark #codeViewBody", ".dark .md-block-editor"]) {
      expect(darkPrintable).toContain(sel);
    }
  });

  it.each([...new Set(darkPrintable)])("AT-THM-18 %s is inside @media screen only", (selector) => {
    expect(Object.keys(declarations(selector, outsideCss)), "outside @media").toEqual([]);
    expect(Object.keys(declarations(selector, screenCss)).length, "in @media screen").toBeGreaterThan(0);
  });

  it("AT-THM-18 no rule outside @media screen (top level or another @media) uses the dark theme for printable content", () => {
    for (const m of `${outsideCss}\n${otherMediaCss}`.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of m[1].split(",").map((x) => x.trim())) {
        if (/\.dark\b/.test(selector)) expect(isPrintable(selector), selector).toBe(false);
      }
    }
  });
});

describe("print hides the transient screen messages (spec 5.8.1)", () => {
  it.each(["#keyHint", "#toastContainer"])("AT-THM-19 print: %s is hidden (over the inline display)", (selector) => {
    expect(declarations(selector, printCss).display).toBe("none !important");
  });

  it("AT-THM-20 print: .grsmd-invisible drops the mark (no ground, no shadow; !important beats the dark rule) but keeps the character in the layout (INV-70)", () => {
    const print = declarations(".grsmd-invisible", printCss);
    expect(print.background).toBe("none !important");
    expect(print["box-shadow"]).toBe("none !important");
    expect(print.display).toBeUndefined();
  });
});

describe("code highlighting colors (spec 5.8.1, owner ruling 2026-10-22: Primer prettylights)", () => {
  it("AT-THM-10 main.js imports no highlight.js theme CSS", () => {
    expect(mainJs).not.toMatch(/highlight\.js\/styles\//);
    expect(mainJs).not.toMatch(/vs2015|github(-dark)?\.css/);
  });

  const rows = SYNTAX.flatMap(([group, selectors, light, dark]) =>
    selectors.flatMap((sel) => [
      [group, sel, sel, light],
      [group, sel, `body.dark ${sel}`, dark],
    ]),
  );
  it.each(rows)("AT-THM-14 %s: %s -> { color } (as %s)", (_group, _class, selector, expected) => {
    expect(value(selector, "color")).toBe(expected);
  });

  it.each(DIFF_MARKS)("AT-THM-14 diff mark %s: color and ground in both themes", (sel, lc, lb, dc, db) => {
    expect(declarations(sel)).toMatchObject({ color: lc, "background-color": lb });
    expect(declarations(`body.dark ${sel}`)).toMatchObject({ color: dc, "background-color": db });
  });

  it("AT-THM-14 the non-color declarations of github.css are kept (italic, bold)", () => {
    expect(value(".hljs-emphasis", "font-style")).toBe("italic");
    expect(value(".hljs-strong", "font-weight")).toBe("bold");
    expect(value(".hljs-section", "font-weight")).toBe("bold");
  });

  const pairs = [
    ...SYNTAX.flatMap(([, selectors, light, dark]) =>
      selectors.flatMap((sel) => [
        ...CODE_GROUNDS.light.map((g) => [`light ${sel}`, light, g]),
        ...CODE_GROUNDS.dark.map((g) => [`dark ${sel}`, dark, g]),
      ]),
    ),
    ...DIFF_MARKS.flatMap(([sel, lc, lb, dc, db]) => [
      [`light ${sel}`, lc, lb],
      [`dark ${sel}`, dc, db],
    ]),
  ];
  it.each(pairs)("AT-THM-15 %s %s on %s: contrast 4.5 or more (known limitation listed)", (name, color, ground) => {
    const known = LOW_CONTRAST[name]?.[ground];
    if (known !== undefined) {
      expect(contrast(color, ground)).toBeCloseTo(known, 2);
    } else {
      expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
