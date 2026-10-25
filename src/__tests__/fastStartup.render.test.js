import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});

import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { lazyMath, MATH_PENDING_CLASS } from "../js/lazyMath.js";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MermaidRenderer from "../js/classes/MermaidRenderer.js";
import PlantUMLRenderer from "../js/classes/PlantUMLRenderer.js";
import SourceFileRenderer from "../js/classes/SourceFileRenderer.js";
import ScrollMemento from "../js/classes/ScrollMemento.js";
import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import { CONFIG } from "../js/config.js";
import { deferred } from "./helpers/fakeFs.js";

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

const DOC = [
  "# Title $a+b$",
  "",
  "Inline $x^2$ math.",
  "",
  "$$",
  "\\int_0^1 f",
  "$$",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
].join("\n");

/** mermaid stand-in: draws an <svg> into each node it is given. */
function fakeMermaid() {
  const drawn = [];
  return {
    drawn,
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }) => {
      for (const node of nodes) {
        drawn.push(node.textContent);
        node.innerHTML = "<svg></svg>";
      }
    }),
  };
}

/** LibraryLoader stand-in: data arrives when the test says, a library runs on first use. */
function fakeLibraries(libs) {
  const arrived = new Set();
  const ran = [];
  const waits = new Map();
  const loader = {
    ran,
    arrive(name) {
      arrived.add(name);
      waits.get(name)?.resolve();
    },
    loadIfArrived(name) {
      if (!arrived.has(name)) return null;
      if (!ran.includes(name)) ran.push(name);
      return libs[name];
    },
    get(name) {
      if (!waits.has(name)) waits.set(name, deferred());
      if (arrived.has(name)) waits.get(name).resolve();
      return waits.get(name).promise.then(() => {
        if (libs[name] instanceof Error) throw libs[name];
        return loader.loadIfArrived(name);
      });
    },
  };
  return loader;
}

/** The render side as main.js composes it, with on-demand libraries. */
function stack(libs = {}) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const preview = document.createElement("div");
  preview.id = "preview";
  document.body.replaceChildren(preview);
  const mermaidLib = fakeMermaid();
  const all = { katex, hljs, mermaid: mermaidLib, plantuml: { encode: (c) => `enc(${c.length})` }, ...libs };
  const libraries = fakeLibraries(all);
  const marked = new Marked();
  const math = lazyMath(markedKatex, { throwOnError: false });
  marked.use(math.extension);
  const markdownRenderer = new MarkdownRenderer(preview, marked, null, DOMPurify, undefined, math);
  const mermaidRenderer = new MermaidRenderer(preview, null);
  const plantumlRenderer = new PlantUMLRenderer(preview, null, () => libraries.get("plantuml"));
  const sourceFileRenderer = new SourceFileRenderer(CONFIG, preview, null, false, () => libraries.get("hljs"));
  const scrollManager = new ScrollMemento(preview);
  const state = new ApplicationState();
  const orchestrator = new RendererOrchestrator(state, markdownRenderer, mermaidRenderer, plantumlRenderer, scrollManager, preview, sourceFileRenderer, libraries);
  return { preview, libraries, orchestrator, markdownRenderer, mermaidRenderer, mermaidLib, scrollManager };
}

const count = (preview, selector) => preview.querySelectorAll(selector).length;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("lazyMath (INV-81 (3))", () => {
  const plain = () => {
    const m = new Marked();
    m.use(markedKatex({ throwOnError: false }));
    return m;
  };

  it("AT-FAST-14 the tokens are the same with or without KaTeX; only the drawing waits", () => {
    const waiting = new Marked();
    waiting.use(lazyMath(markedKatex, { throwOnError: false }).extension);
    expect(waiting.lexer(DOC)).toEqual(plain().lexer(DOC));
  });

  it("AT-FAST-15 before KaTeX a formula is its TeX source (escaped) in a pending box; after, as marked-katex-extension draws it", () => {
    const math = lazyMath(markedKatex, { throwOnError: false });
    const m = new Marked();
    m.use(math.extension);
    expect(math.isReady()).toBe(false);
    const src = "Inline $a<b$ here.\n\n$$\nx&y\n$$\n";
    const html = m.parse(src);
    expect(html).toContain(`<span class="${MATH_PENDING_CLASS}">$a&lt;b$</span>`);
    expect(html).toContain(`<div class="${MATH_PENDING_CLASS}">$$\nx&amp;y\n$$</div>`);
    expect(math.takePending()).toBe(true);
    expect(math.takePending()).toBe(false);
    math.useKatex(katex);
    expect(math.isReady()).toBe(true);
    expect(m.parse(src)).toBe(plain().parse(src));
    expect(math.takePending()).toBe(false);
  });
});

describe("rendering with libraries that run on demand (INV-81 (3), spec 5.17.3)", () => {
  it("AT-FAST-16 nothing has arrived: TeX source, plain code and a Loading box are shown, and nothing runs", async () => {
    const { preview, libraries, orchestrator } = stack();
    orchestrator.state.setMarkdownText(DOC);
    await orchestrator.renderAll();
    expect(libraries.ran).toEqual([]);
    expect(count(preview, `.${MATH_PENDING_CLASS}`)).toBe(3);
    expect(count(preview, ".katex")).toBe(0);
    expect(count(preview, "code.hljs")).toBe(0);
    const box = preview.querySelector(".mermaid.mermaid-loading");
    expect(box.textContent).toBe(CONFIG.messages.diagram.loading);
    expect(CONFIG.messages.diagram.loading).toBe("Loading diagram...");
  });

  it("AT-FAST-17 each library that arrives later draws what waited for it, in the render queue", async () => {
    const { preview, libraries, orchestrator, mermaidLib } = stack();
    orchestrator.state.setMarkdownText(DOC);
    await orchestrator.renderAll();
    const heading = preview.querySelector("h1");
    libraries.arrive("katex");
    await settle();
    expect(count(preview, `.${MATH_PENDING_CLASS}`)).toBe(0);
    expect(count(preview, ".katex")).toBe(3);
    expect(preview.querySelector("h1")).not.toBe(heading); // the block was drawn again
    libraries.arrive("hljs");
    await settle();
    expect(count(preview, "code.hljs .hljs-keyword")).toBe(1);
    libraries.arrive("mermaid");
    await settle();
    expect(mermaidLib.drawn).toEqual(["flowchart LR\n  A --> B\n"]);
    expect(count(preview, ".mermaid svg")).toBe(1);
    expect(count(preview, ".mermaid-loading")).toBe(0);
    expect(libraries.ran).toEqual(["katex", "hljs", "mermaid"]);
  });

  it("AT-FAST-18 data already in the page: the render runs what it needs and draws it at once (no pending frame)", async () => {
    const { preview, libraries, orchestrator, mermaidLib } = stack();
    for (const name of ["mermaid", "hljs", "katex", "plantuml"]) libraries.arrive(name);
    orchestrator.state.setMarkdownText(DOC);
    await orchestrator.renderAll();
    expect(count(preview, `.${MATH_PENDING_CLASS}`)).toBe(0);
    expect(count(preview, ".katex")).toBe(3);
    expect(count(preview, "code.hljs")).toBe(1);
    expect(mermaidLib.drawn).toHaveLength(1);
    expect(libraries.ran.sort()).toEqual(["hljs", "katex", "mermaid"]);
  });

  it("AT-FAST-19 a document with no math, code or diagram runs no library", async () => {
    const { libraries, orchestrator } = stack();
    for (const name of ["mermaid", "hljs", "katex", "plantuml"]) libraries.arrive(name);
    orchestrator.state.setMarkdownText("# Plain\n\nJust text, a [link](https://example.com) and $ 5.\n");
    await orchestrator.renderAll();
    expect(libraries.ran).toEqual([]);
  });

  it("AT-FAST-20 an edit that brings the first formula: drawn in the same partial render when KaTeX's data is in", async () => {
    const { preview, libraries, orchestrator } = stack();
    libraries.arrive("katex");
    orchestrator.state.setMarkdownText("# A\n\nPara.\n");
    await orchestrator.renderAll();
    expect(libraries.ran).toEqual([]);
    const para = orchestrator.getModel().getBlocks()[1];
    orchestrator.commitBlock(para.id, "Para $y$.\n");
    await settle();
    expect(count(preview, ".katex")).toBe(1);
    expect(count(preview, `.${MATH_PENDING_CLASS}`)).toBe(0);
    expect(libraries.ran).toEqual(["katex"]);
  });

  it("AT-FAST-21 a library that ran when idle (preload) redraws only what waited for it", async () => {
    const { preview, orchestrator, markdownRenderer } = stack();
    orchestrator.state.setMarkdownText("# A\n\nInline $x$.\n");
    await orchestrator.renderAll();
    const heading = preview.querySelector("h1");
    const replace = vi.spyOn(markdownRenderer, "replaceBlocks");
    await orchestrator.libraryLoaded("hljs", hljs); // nothing waited for it
    expect(replace).not.toHaveBeenCalled();
    await orchestrator.libraryLoaded("katex", katex);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(count(preview, ".katex")).toBe(1);
    expect(preview.querySelector("h1")).toBe(heading); // a block with no math is kept
    await orchestrator.libraryLoaded("katex", katex); // twice: nothing more
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("AT-FAST-22 mermaid that cannot run: the Loading boxes say so; the error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { preview, libraries, orchestrator } = stack({ mermaid: new Error("blocked") });
    orchestrator.state.setMarkdownText("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await orchestrator.renderAll();
    libraries.arrive("mermaid");
    await settle();
    expect(preview.querySelector(".mermaid-loading").textContent).toBe(CONFIG.messages.diagram.loadFailed);
    expect(error).toHaveBeenCalled();
  });

  it("AT-FAST-23 a user-written .mermaid-loading is never drawn or changed", async () => {
    const { preview, libraries, orchestrator, mermaidLib } = stack();
    orchestrator.state.setMarkdownText('<div class="mermaid mermaid-loading">graph TD; X-->Y</div>\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    await orchestrator.renderAll();
    libraries.arrive("mermaid");
    await settle();
    expect(mermaidLib.drawn).toEqual(["flowchart LR\n  A --> B\n"]);
    expect(preview.querySelector(".md-block div.mermaid-loading").textContent).toBe("graph TD; X-->Y");
  });

  it("AT-FAST-24 a block written in place with a pending formula is drawn again when KaTeX runs", () => {
    const { preview, markdownRenderer } = stack();
    const block = { id: 1, raw: "| a |\n|---|\n| $x$ |\n", type: "table" };
    const model = { links: {}, getBlocks: () => [block] };
    markdownRenderer.renderBlocks(model);
    expect(count(preview, `.${MATH_PENDING_CLASS}`)).toBe(1);
    markdownRenderer.markWrittenInPlace(block, {});
    markdownRenderer.useLibrary("katex", katex);
    const replaced = markdownRenderer.replaceBlocks(model, model);
    expect(replaced).toHaveLength(1);
    expect(count(preview, ".katex")).toBe(1);
  });
});

describe("the look before a library has run (INV-81 (3))", () => {
  it("AT-FAST-43 the Loading box and the TeX box have light and dark rules (screen); the copy bar waits for the drawing", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "../css/style.css");
    const css = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.mermaid\.mermaid-loading \{[^}]*border: 2px dashed/);
    expect(css).toMatch(/\n\.math-pending \{[^}]*border: 1px dashed/);
    expect(css).toMatch(/div\.math-pending \{[^}]*white-space: pre-wrap/);
    expect(css).toMatch(/@media screen \{\s*\.dark \.mermaid\.mermaid-loading,\s*\.dark \.math-pending \{/);
    expect(css).toMatch(/\.diagram-copy-bar:has\(\+ \.mermaid-loading\) \{\s*visibility: hidden;/);
  });
});

describe("renderers that wait for their library (INV-81 (3))", () => {
  it("AT-FAST-25 PlantUML: the encoder is loaded after the consent, then the image is made", async () => {
    const preview = document.createElement("div");
    preview.innerHTML = '<pre><code class="language-plantuml">@startuml\nA -> B\n@enduml</code></pre>';
    const load = deferred();
    const r = new PlantUMLRenderer(preview, null, () => load.promise);
    vi.spyOn(r, "askConsent").mockReturnValue(true);
    vi.spyOn(r, "waitForImageLoad").mockResolvedValue(true);
    const rendering = r.render("light");
    await Promise.resolve();
    expect(preview.querySelector("img")).toBeNull();
    load.resolve({ encode: () => "ENC" });
    await rendering;
    expect(preview.querySelector("img").src).toBe(`${CONFIG.plantuml.serverUrl}ENC`);
  });

  it("AT-FAST-26 PlantUML [Render] waits for the encoder; an encoder that cannot load ends as an encoding error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const preview = document.createElement("div");
    document.body.replaceChildren(preview);
    const r = new PlantUMLRenderer(preview, null, () => Promise.reject(new Error("no")));
    vi.spyOn(r, "askConsent").mockReturnValue(true);
    const box = r.createPendingElement("@startuml\nA -> B\n@enduml", "light");
    preview.append(box);
    await expect(r.renderPending(box)).resolves.toBe(false);
    expect(preview.textContent).toContain(CONFIG.messages.plantuml.encodingFailed);
  });

  it("AT-FAST-27 the code view waits for highlight.js and is drawn once, colored, with its language (owner ruling 2026-10-25)", async () => {
    const preview = document.createElement("div");
    const load = deferred();
    const r = new SourceFileRenderer(CONFIG, preview, null, false, () => load.promise);
    const file = new File(["const a = 1;\n"], "a.js", { lastModified: 0 });
    const rendering = r.render(file, null, "dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preview.innerHTML).toBe("");
    load.resolve(hljs);
    const meta = await rendering;
    expect(meta.language).not.toBe("plaintext");
    expect(preview.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("AT-FAST-28 the code view without highlight.js (it could not load) is plain text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const preview = document.createElement("div");
    const r = new SourceFileRenderer(CONFIG, preview, null, false, () => Promise.reject(new Error("no")));
    await r.render(new File(["const a = 1;\n"], "a.js", { lastModified: 0 }), null, "dark");
    expect(preview.textContent).toContain("const a = 1;");
    expect(preview.querySelector(".hljs-keyword")).toBeNull();
  });
});
