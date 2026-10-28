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
import LibraryLoader from "../js/classes/LibraryLoader.js";
import { LIBRARY_NAMES } from "../js/libraryNames.js";
import { fakeBoot, arriveData } from "./helpers/fakeBoot.js";

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

/**
 * The real LibraryLoader (11-g) on a stand-in receiver: data arrives when
 * the test says (arrive), a library given as an Error cannot run. Idle
 * turns run on setTimeout 0 (settle() lets them run). ran: the libraries
 * that are ready.
 */
function realLibraries(libs) {
  const boot = fakeBoot();
  const doc = document.implementation.createHTMLDocument("");
  const loader = new LibraryLoader(boot, doc, { idle: (task) => setTimeout(task, 0) });
  Object.assign(loader, { boot, doc, arrive: (name) => arriveData(boot, name, libs[name]) });
  Object.defineProperty(loader, "ran", { get: () => LIBRARY_NAMES.filter((name) => loader.libraryState(name) === "ready") });
  return loader;
}

/** The render side as main.js composes it, with on-demand libraries; the core has started (page loading). */
function stack(libs = {}) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const preview = document.createElement("div");
  preview.id = "preview";
  document.body.replaceChildren(preview);
  const mermaidLib = fakeMermaid();
  const all = { katex, hljs, mermaid: mermaidLib, plantuml: { encode: (c) => `enc(${c.length})` }, ...libs };
  const libraries = realLibraries(all);
  const marked = new Marked();
  const math = lazyMath(markedKatex, { throwOnError: false });
  marked.use(math.extension);
  const markdownRenderer = new MarkdownRenderer(preview, marked, null, DOMPurify, undefined, math);
  const mermaidRenderer = new MermaidRenderer(preview, null);
  const plantumlRenderer = new PlantUMLRenderer(preview, null);
  const sourceFileRenderer = new SourceFileRenderer(CONFIG, preview, null, false, () => libraries.get("hljs"));
  const scrollManager = new ScrollMemento(preview);
  const state = new ApplicationState();
  const orchestrator = new RendererOrchestrator(state, markdownRenderer, mermaidRenderer, plantumlRenderer, scrollManager, preview, sourceFileRenderer, libraries);
  libraries.connect(orchestrator);
  libraries.dispatchPage("coreStarted", {});
  return { preview, libraries, orchestrator, markdownRenderer, mermaidRenderer, plantumlRenderer, sourceFileRenderer, mermaidLib, scrollManager };
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
    // data-tex: the TeX without delimiters, as KaTeX's annotation (the Index, INV-77)
    expect(html).toContain(`<span class="${MATH_PENDING_CLASS}" data-tex="a&lt;b">$a&lt;b$</span>`);
    expect(html).toContain(`<div class="${MATH_PENDING_CLASS}" data-tex="x&amp;y">$$\nx&amp;y\n$$</div>`);
    expect(math.pendingCount()).toBe(2);
    math.useKatex(katex);
    expect(math.isReady()).toBe(true);
    expect(m.parse(src)).toBe(plain().parse(src));
    expect(math.pendingCount()).toBe(2);
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
    expect(libraries.ran.sort()).toEqual(["hljs", "katex", "mermaid"]);
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

  it("AT-FAST-21 a library that ran on an idle turn redraws only what waited for it (11-g idleTurn, redrawShownWithout)", async () => {
    const { preview, libraries, orchestrator, markdownRenderer } = stack();
    orchestrator.state.setMarkdownText("# A\n\nInline $x$.\n");
    await orchestrator.renderAll();
    const heading = preview.querySelector("h1");
    const replace = vi.spyOn(markdownRenderer, "replaceBlocks");
    libraries.arrive("hljs"); // nothing on screen waits for it: an idle turn runs it
    expect(libraries.ran).toEqual([]);
    await settle();
    expect(libraries.ran).toEqual(["hljs"]);
    expect(replace).not.toHaveBeenCalled();
    libraries.arrive("katex"); // the math waits for it: run at once, drawn in the queue
    expect(libraries.ran).toEqual(["hljs", "katex"]);
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(count(preview, ".katex")).toBe(1);
    expect(preview.querySelector("h1")).toBe(heading); // a block with no math is kept
    libraries.dispatch("katex", "needed"); // ready: nothing more is drawn
    await settle();
    expect(replace.mock.results.slice(1).every((r) => r.value.length === 0)).toBe(true);
    expect(count(preview, ".katex")).toBe(1);
  });

  it("AT-FAST-22 mermaid that cannot run: the Loading boxes say so", async () => {
    const { preview, libraries, orchestrator } = stack({ mermaid: new Error("blocked") });
    orchestrator.state.setMarkdownText("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await orchestrator.renderAll();
    libraries.arrive("mermaid");
    await settle();
    expect(preview.querySelector(".mermaid-loading").textContent).toBe(CONFIG.messages.diagram.loadFailed);
  });

  it("AT-FAST-49 (M3) after mermaid failed, the next render (a theme switch) says so at once, not Loading", async () => {
    const { preview, libraries, orchestrator } = stack({ mermaid: new Error("blocked") });
    orchestrator.state.setMarkdownText("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await orchestrator.renderAll();
    libraries.arrive("mermaid");
    await settle();
    await orchestrator.reRender("dark");
    expect(preview.querySelector(".mermaid-loading").textContent).toBe(CONFIG.messages.diagram.loadFailed);
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
    expect(css).toMatch(/\.mermaid\.mermaid-loading,\s*\.plantuml-loading \{[^}]*border: 2px dashed/);
    expect(css).toMatch(/\n\.math-pending \{[^}]*border: 1px dashed/);
    expect(css).toMatch(/div\.math-pending \{[^}]*white-space: pre-wrap/);
    expect(css).toMatch(/@media screen \{\s*\.dark \.mermaid\.mermaid-loading,\s*\.dark \.plantuml-loading,\s*\.dark \.math-pending \{/);
    expect(css).toMatch(/\.diagram-copy-bar:has\(\+ \.mermaid-loading\) \{\s*visibility: hidden;/);
  });
});

describe("what else waits (INV-81 (3), spec 5.17.3)", () => {
  it("AT-FAST-50 (C1) a document's id with the app's prefix (grsmd-) is dropped when sanitized; other ids stay", () => {
    const { markdownRenderer } = stack();
    const html = markdownRenderer.documentHtml('<span id="grsmd-lib-katex">x</span> <b id="GRSMD-x">y</b> <i id="note-1">z</i>').html;
    expect(html).not.toMatch(/grsmd-/i);
    expect(html).toContain('id="note-1"');
  });

  it("AT-FAST-51 (L1) the Index lists a heading's math as its TeX, the same before and after KaTeX", async () => {
    const { default: DocumentIndex } = await import("../js/classes/DocumentIndex.js");
    const { preview, libraries, orchestrator } = stack();
    const panel = document.createElement("div");
    panel.hidden = true;
    const column = document.createElement("div");
    column.append(panel);
    document.body.append(column);
    const button = document.createElement("button");
    const index = new DocumentIndex({ button, panel, column, preview }, orchestrator.scrollManager, { emptyText: "none" });
    orchestrator.state.setMarkdownText("# Fast $a+b$\n\nText.\n");
    await orchestrator.renderAll();
    index.setAvailable(true);
    index.show();
    expect(panel.textContent).toBe("Fast a+b");
    libraries.arrive("katex");
    await settle();
    await new Promise((r) => requestAnimationFrame(r));
    expect(preview.querySelector("h1 .katex")).not.toBeNull();
    expect(panel.textContent).toBe("Fast a+b");
    index.hide();
  });

  it("AT-FAST-52 (L2, AQ7) KaTeX arriving later redraws a block with math; its PlantUML is held, and sent once, after the one dialog of answering (the libraries are settled)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    vi.spyOn(plantumlRenderer, "waitForImageLoad").mockResolvedValue(true);
    const createImage = vi.spyOn(plantumlRenderer, "createImage");
    orchestrator.state.setMarkdownText("- $x$\n\n  ```plantuml\n  @startuml\n  A -> B\n  @enduml\n  ```\n");
    await orchestrator.renderAll();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(1);
    libraries.arrive("katex");
    await settle();
    expect(preview.querySelector(".katex")).not.toBeNull();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(1); // held again, not sent
    expect(confirm).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
    for (const name of ["mermaid", "hljs", "plantuml"]) libraries.arrive(name);
    await settle();
    expect(libraries.isSettled()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(preview.querySelector("img.plantuml-diagram")).not.toBeNull();
    expect(preview.querySelector(".plantuml-pending, .plantuml-loading")).toBeNull();
  });

  it("AT-FAST-56 (N1, AQ7) KaTeX arriving later never sends a PlantUML diagram a commit added: it stays [Render] (INV-23, INV-02)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    vi.spyOn(plantumlRenderer, "waitForImageLoad").mockResolvedValue(true);
    const sent = [];
    const createImage = plantumlRenderer.createImage.bind(plantumlRenderer);
    vi.spyOn(plantumlRenderer, "createImage").mockImplementation((code) => {
      sent.push(code);
      return createImage(code);
    });
    orchestrator.state.setMarkdownText("```plantuml\n@startuml\nA -> B\n@enduml\n```\n\n- $x$\n");
    await orchestrator.renderAll();
    const list = orchestrator.getModel().getBlocks()[1];
    orchestrator.commitBlock(list.id, "- $x$\n\n  ```plantuml\n  @startuml\n  SECRET -> D\n  @enduml\n  ```\n");
    await settle();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(2); // both held (no dialog yet)
    libraries.arrive("katex"); // its redraw replaces the committed block
    await settle();
    expect(preview.querySelector(".katex")).not.toBeNull();
    for (const name of ["mermaid", "hljs", "plantuml"]) libraries.arrive(name);
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.includes("A -> B"))).toEqual([true]);
    expect(sent.some((c) => c.includes("SECRET"))).toBe(false);
    expect(preview.querySelectorAll(".plantuml-pending")).toHaveLength(1); // INV-23
  });

  it("AT-FAST-57 (N1, AQ7) Cancel in the dialog of answering (the libraries are settled): the held diagram shows 'not sent', nothing is sent (INV-03)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    const createImage = vi.spyOn(plantumlRenderer, "createImage");
    orchestrator.state.setMarkdownText("- $x$\n\n  ```plantuml\n  @startuml\n  A -> B\n  @enduml\n  ```\n");
    await orchestrator.renderAll();
    libraries.arrive("katex");
    await settle();
    for (const name of ["mermaid", "hljs", "plantuml"]) libraries.arrive(name);
    await settle();
    expect(preview.querySelector(".katex")).not.toBeNull();
    expect(preview.textContent).toContain(CONFIG.messages.plantuml.canceled);
    expect(createImage).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("AT-FAST-53 (L6) a block open in the editor stays as it was when KaTeX comes, and is drawn when released (Q-d1)", async () => {
    const { preview, libraries, orchestrator, markdownRenderer } = stack();
    orchestrator.state.setMarkdownText("# A\n\nInline $x$.\n");
    await orchestrator.renderAll();
    const para = orchestrator.getModel().getBlocks()[1];
    orchestrator.holdBlock(para.id);
    libraries.arrive("katex");
    await settle();
    expect(markdownRenderer.getBlockElement(para.id).querySelector(`.${MATH_PENDING_CLASS}`)).not.toBeNull();
    expect(markdownRenderer.isStale(para.id)).toBe(true);
    orchestrator.releaseBlock();
    await settle();
    expect(markdownRenderer.getBlockElement(para.id).querySelector(".katex")).not.toBeNull();
    void preview;
  });
});

describe("renderers that wait for their library (INV-81 (3))", () => {
  it("AT-FAST-25 (M2, AQ7) PlantUML before the libraries are settled (loading): a Loading box, no dialog, nothing sent; runWaiting asks once and draws it", async () => {
    const preview = document.createElement("div");
    document.body.replaceChildren(preview);
    preview.innerHTML = '<pre><code class="language-plantuml">@startuml\nA -> B\n@enduml</code></pre>';
    const r = new PlantUMLRenderer(preview, null);
    const ask = vi.spyOn(r, "askConsent").mockReturnValue(true);
    vi.spyOn(r, "waitForImageLoad").mockResolvedValue(true);
    r.hold("light", preview, "consent");
    expect(preview.querySelector(".plantuml-loading").textContent).toBe("Loading diagram...");
    expect(preview.querySelector("img")).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    r.useLibrary("plantuml", { encode: () => "ENC" });
    await expect(r.runWaiting()).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(preview.querySelector(".plantuml-loading")).toBeNull();
    expect(preview.querySelector("img").src).toBe(`${CONFIG.plantuml.serverUrl}ENC`);
    await expect(r.runWaiting()).resolves.toBe(false); // once
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("AT-FAST-47 (M2, AQ7) a full render with PlantUML before the libraries are settled (loading) does not hold the render queue, and asks nothing", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, orchestrator } = stack();
    orchestrator.state.setMarkdownText("# A\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n");
    await orchestrator.renderAll(); // settles though the encoder has not arrived
    expect(preview.querySelector(".plantuml-loading")).not.toBeNull();
    const heading = orchestrator.getModel().getBlocks()[0];
    orchestrator.commitBlock(heading.id, "# B\n");
    await settle();
    expect(preview.querySelector("h1").textContent).toBe("B");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("AT-FAST-48 (L6, AQ7) PlantUML [Render] with the encoder: the dialog and the image request start inside the click", () => {
    const preview = document.createElement("div");
    document.body.replaceChildren(preview);
    const r = new PlantUMLRenderer(preview, { encode: () => "ENC" });
    const ask = vi.spyOn(r, "askConsent").mockReturnValue(true);
    vi.spyOn(r, "waitForImageLoad").mockResolvedValue(true);
    const box = r.createPendingElement("@startuml\nA -> B\n@enduml", "light");
    preview.append(box);
    box.querySelector("button").click();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(preview.querySelector("img").src).toBe(`${CONFIG.plantuml.serverUrl}ENC`);
  });

  it("AT-FAST-26 (AQ7) PlantUML without the encoder (it could not run): [Render] and runWaiting show the encoding error, with no dialog", async () => {
    const preview = document.createElement("div");
    document.body.replaceChildren(preview);
    const r = new PlantUMLRenderer(preview, null);
    const ask = vi.spyOn(r, "askConsent").mockReturnValue(true);
    const box = r.createPendingElement("@startuml\nA -> B\n@enduml", "light");
    preview.append(box);
    await expect(r.renderPending(box)).resolves.toBe(false);
    expect(preview.textContent).toContain(CONFIG.messages.plantuml.encodingFailed);
    preview.innerHTML = '<pre><code class="language-plantuml">@startuml\nC -> D\n@enduml</code></pre>';
    r.hold("light");
    await r.runWaiting();
    expect(preview.querySelectorAll(".plantuml-error")).toHaveLength(1);
    expect(preview.textContent).toBe(CONFIG.messages.plantuml.encodingFailed);
    expect(ask).not.toHaveBeenCalled();
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

  it("AT-FAST-54 (M2) the code view waits at most highlightWaitMs: then plain, and colored (with its language) when highlight.js comes", async () => {
    vi.useFakeTimers();
    try {
      const { preview, libraries, orchestrator, sourceFileRenderer } = stack();
      const recolored = [];
      orchestrator.setModelChangedListener({ onModelChanged() {}, onBlockSplitFailed() {}, onCodeViewRecolored: (m) => recolored.push(m) });
      const file = new File(["const a = 1;\n"], "a.js", { lastModified: 0 });
      const rendering = orchestrator.renderCodeView(file, null);
      await vi.advanceTimersByTimeAsync(CONFIG.codeView.highlightWaitMs);
      const meta = await rendering;
      expect(meta.language).toBe("plaintext");
      expect(preview.querySelector(".hljs-keyword")).toBeNull();
      expect(preview.textContent).toContain("const a = 1;");
      libraries.arrive("hljs");
      await vi.advanceTimersByTimeAsync(10);
      expect(preview.querySelector(".hljs-keyword")).not.toBeNull();
      expect(recolored).toHaveLength(1);
      expect(recolored[0].language).not.toBe("plaintext");
      void sourceFileRenderer;
    } finally {
      vi.useRealTimers();
    }
  });

  it("AT-FAST-55 (M1) a Markdown document opened while the code view waits for highlight.js stays shown when it comes", async () => {
    const { preview, libraries, orchestrator } = stack();
    const file = new File(["const a = 1;\n"], "a.js", { lastModified: 0 });
    const coding = orchestrator.renderCodeView(file, null);
    await orchestrator.loadMarkdown("# Markdown B\n", "light");
    libraries.arrive("hljs");
    await expect(coding).resolves.toBeNull();
    await settle();
    expect(preview.querySelector("h1").textContent).toBe("Markdown B");
    expect(orchestrator.isCodeViewActive()).toBe(false);
  });

  it("AT-FAST-58 (INV-81 (2), 11-g isShownWithout, review L13) the renderers' queries are true while something is drawn without the library, false after it ran", async () => {
    const { preview, libraries, orchestrator, markdownRenderer, mermaidRenderer } = stack();
    orchestrator.state.setMarkdownText(DOC);
    await orchestrator.renderAll();
    expect(markdownRenderer.hasPendingMath()).toBe(true);
    expect(markdownRenderer.hasPendingHighlight()).toBe(true);
    expect(mermaidRenderer.hasLoadingBoxes()).toBe(true);
    for (const name of ["katex", "hljs", "mermaid"]) expect(orchestrator.isShownWithout(name)).toBe(true);
    expect(orchestrator.isShownWithout("plantuml")).toBe(false);
    for (const name of LIBRARY_NAMES) libraries.arrive(name);
    await settle();
    expect(markdownRenderer.hasPendingMath()).toBe(false);
    expect(markdownRenderer.hasPendingHighlight()).toBe(false);
    expect(mermaidRenderer.hasLoadingBoxes()).toBe(false);
    for (const name of ["katex", "hljs", "mermaid"]) expect(orchestrator.isShownWithout(name)).toBe(false);
    // a box the document wrote itself is not one the renderer made
    const own = document.createElement("div");
    own.className = "mermaid-loading";
    preview.append(own);
    expect(mermaidRenderer.hasLoadingBoxes()).toBe(false);
  });

  it("AT-FAST-59 (INV-81 (3), 11-g isShownWithout, review L12) the code view: isWaitingForHljs is true while any of two overlapping waits goes on, and while the code is shown plain", async () => {
    vi.useFakeTimers();
    try {
      const preview = document.createElement("div");
      const load = deferred();
      const r = new SourceFileRenderer(CONFIG, preview, null, false, () => load.promise);
      const file = new File(["const a = 1;\n"], "a.js", { lastModified: 0 });
      expect(r.isWaitingForHljs()).toBe(false);
      const first = r.render(file, null, "dark", () => false); // another document was opened meanwhile
      await vi.advanceTimersByTimeAsync(1000);
      const second = r.render(file, null, "dark");
      expect(r.isWaitingForHljs()).toBe(true);
      await vi.advanceTimersByTimeAsync(CONFIG.codeView.highlightWaitMs - 1000);
      await expect(first).resolves.toBeNull(); // the first wait is over, nothing shown
      expect(r.isWaitingForHljs()).toBe(true); // the second still waits
      await vi.advanceTimersByTimeAsync(1000);
      await expect(second).resolves.toMatchObject({ language: "plaintext" });
      expect(r.isWaitingForHljs()).toBe(true); // shown plain
      r.useLibrary("hljs", hljs);
      expect(r.isWaitingForHljs()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

describe("AT-LSM PlantUML waits for the four libraries to be settled (answering, then settled) (11-g, INV-81 (3), INV-02, INV-23, owner ruling AQ7)", () => {
  const PUML = (name) => `\`\`\`plantuml\n@startuml\n${name} -> B\n@enduml\n\`\`\`\n`;
  const allArrive = (libraries) => {
    for (const name of LIBRARY_NAMES) if (libraries.libraryState(name) === "notArrived") libraries.arrive(name);
  };
  const sentCodes = (plantumlRenderer) => {
    const sent = [];
    const createImage = plantumlRenderer.createImage.bind(plantumlRenderer);
    vi.spyOn(plantumlRenderer, "createImage").mockImplementation((code) => {
      sent.push(code);
      return createImage(code);
    });
    vi.spyOn(plantumlRenderer, "waitForImageLoad").mockResolvedValue(true);
    return sent;
  };

  it("AT-LSM-12 (INV-02, INV-23) before the libraries are settled no dialog and nothing sent; in answering one dialog in the render queue, the full render's diagrams sent, a commit's diagram [Render], the reading place kept", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer, scrollManager } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`# T\n\n${PUML("FULL1")}\n${PUML("FULL2")}\nText.\n`);
    await orchestrator.renderAll();
    const text = orchestrator.getModel().getBlocks()[3];
    orchestrator.commitBlock(text.id, PUML("COMMIT"));
    await settle();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(3);
    expect(confirm).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    const restore = vi.spyOn(scrollManager, "restoreReadingAnchor");
    const place = { blockId: 1, offset: 3 };
    vi.spyOn(scrollManager, "captureReadingAnchor").mockReturnValue(place);
    allArrive(libraries);
    expect(confirm).not.toHaveBeenCalled(); // answering now: runWaiting waits for its turn in the queue
    await settle();
    expect(libraries.isSettled()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.match(/(\w+) -> B/)[1]).sort()).toEqual(["FULL1", "FULL2"]);
    expect(preview.querySelectorAll(".plantuml-pending")).toHaveLength(1);
    expect(preview.querySelector(".plantuml-pending").previousElementSibling).toBeNull();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(0);
    expect(restore).toHaveBeenCalledWith(place);
    // after settled: each full render asks again (INV-02), no hold
    await orchestrator.reRender("dark");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(0);
  });

  it("AT-LSM-13 (INV-03) Cancel in answering (the libraries are settled): the held diagrams show 'not sent'; nothing is sent; a commit's diagram is still [Render]", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`${PUML("FULL")}\nText.\n`);
    await orchestrator.renderAll();
    orchestrator.commitBlock(orchestrator.getModel().getBlocks()[1].id, PUML("COMMIT"));
    await settle();
    allArrive(libraries);
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect(preview.textContent).toContain(CONFIG.messages.plantuml.canceled);
    expect(preview.querySelectorAll(".plantuml-pending")).toHaveLength(1);
  });

  it("AT-LSM-14 (INV-81 (3)) the encoder could not run: in answering no dialog, every held diagram shows the encoding error; later renders too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack({ plantuml: new Error("blocked") });
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`${PUML("FULL")}\nText.\n`);
    await orchestrator.renderAll();
    orchestrator.commitBlock(orchestrator.getModel().getBlocks()[1].id, PUML("COMMIT"));
    await settle();
    allArrive(libraries);
    await settle();
    expect(libraries.hasFailed("plantuml")).toBe(true);
    expect(libraries.isSettled()).toBe(true);
    expect(preview.querySelectorAll(".plantuml-error")).toHaveLength(2);
    await orchestrator.reRender("dark");
    expect(preview.querySelectorAll(".plantuml-error")).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("AT-LSM-15 (INV-81 (3), review N5) Clear before the libraries are settled, or another document before then: the held boxes are gone, no dialog comes, and the page is settled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const cleared = stack();
    cleared.orchestrator.state.setMarkdownText(PUML("CLEARED"));
    await cleared.orchestrator.renderAll();
    expect(cleared.preview.querySelectorAll(".plantuml-loading")).toHaveLength(1);
    cleared.orchestrator.clear(); // the page is still loading
    expect(cleared.libraries.pageStartupState).toBe("loading");
    expect(cleared.preview.querySelectorAll(".plantuml-loading")).toHaveLength(0);
    allArrive(cleared.libraries);
    await settle();
    expect(cleared.libraries.pageStartupState).toBe("settled");
    expect(confirm).not.toHaveBeenCalled();

    const replaced = stack();
    replaced.orchestrator.state.setMarkdownText(PUML("OLD"));
    await replaced.orchestrator.renderAll();
    expect(replaced.preview.querySelectorAll(".plantuml-loading")).toHaveLength(1);
    await replaced.orchestrator.loadMarkdown("# New\n\nNo diagram.\n", "light");
    expect(replaced.libraries.pageStartupState).toBe("loading");
    expect(replaced.preview.querySelectorAll(".plantuml-loading")).toHaveLength(0);
    allArrive(replaced.libraries);
    await settle();
    expect(replaced.libraries.pageStartupState).toBe("settled");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("AT-LSM-25 (INV-81 (3), INV-02, review N4) no held box when the libraries settle (a document without PlantUML): the page goes from answering to settled, and a later full render asks once and sends", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText("# Title\n\nNo diagram.\n");
    await orchestrator.renderAll();
    allArrive(libraries);
    await settle();
    expect(libraries.pageStartupState).toBe("settled");
    expect(confirm).not.toHaveBeenCalled();
    await orchestrator.loadMarkdown(PUML("LATER"), "light");
    await settle();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.match(/(\w+) -> B/)[1])).toEqual(["LATER"]);
  });

  it("AT-LSM-18 (INV-02, INV-81 (3), G6) KaTeX is the last library: its queued redraw runs in answering, before runWaiting, and the full render still gets one dialog for all its diagrams", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`- $x$\n\n  \`\`\`plantuml\n  @startuml\n  MATH -> B\n  @enduml\n  \`\`\`\n\n${PUML("OTHER")}`);
    await orchestrator.renderAll();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(2);
    for (const name of ["mermaid", "hljs", "plantuml"]) libraries.arrive(name);
    await settle();
    expect(libraries.isSettled()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    libraries.arrive("katex"); // ready: the redraw is queued, then answering queues runWaiting
    await settle();
    expect(libraries.isSettled()).toBe(true);
    expect(preview.querySelector(".katex")).not.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.match(/(\w+) -> B/)[1]).sort()).toEqual(["MATH", "OTHER"]);
    expect(preview.querySelectorAll(".plantuml-loading, .plantuml-pending")).toHaveLength(0);
  });

  it("AT-LSM-19 (INV-03, G6) the same, Cancel: one dialog, both diagrams 'not sent', nothing sent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { preview, libraries, orchestrator, plantumlRenderer } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`- $x$\n\n  \`\`\`plantuml\n  @startuml\n  MATH -> B\n  @enduml\n  \`\`\`\n\n${PUML("OTHER")}`);
    await orchestrator.renderAll();
    for (const name of ["mermaid", "hljs", "plantuml"]) libraries.arrive(name);
    await settle();
    libraries.arrive("katex");
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect(preview.querySelectorAll(".plantuml-error")).toHaveLength(2);
    expect(preview.textContent).toContain(CONFIG.messages.plantuml.canceled);
  });

  it("AT-LSM-23 (INV-02, INV-81 (3), G6, review L1) the libraries settle while a full render draws its diagrams: its PlantUML step and the queued KaTeX redraw join one dialog", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const mermaid = fakeMermaid();
    const draw = mermaid.run;
    let libraries = null;
    // the full render yields inside mermaid's step; KaTeX and the encoder arrive and run meanwhile
    mermaid.run = vi.fn(async (options) => {
      if (libraries.libraryState("plantuml") === "notArrived") {
        libraries.arrive("katex");
        libraries.arrive("plantuml");
        await settle();
      }
      return draw(options);
    });
    const parts = stack({ mermaid });
    libraries = parts.libraries;
    const { preview, orchestrator, plantumlRenderer } = parts;
    const sent = sentCodes(plantumlRenderer);
    libraries.arrive("mermaid");
    libraries.arrive("hljs");
    await settle();
    orchestrator.state.setMarkdownText(`- $x$\n\n  \`\`\`plantuml\n  @startuml\n  MATH -> B\n  @enduml\n  \`\`\`\n\n${PUML("OTHER")}\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`);
    await orchestrator.renderAll();
    await settle();
    expect(mermaid.run).toHaveBeenCalled();
    expect(libraries.isSettled()).toBe(true);
    expect(preview.querySelector(".katex")).not.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.match(/(\w+) -> B/)[1]).sort()).toEqual(["MATH", "OTHER"]);
    expect(preview.querySelectorAll(".plantuml-loading, .plantuml-pending")).toHaveLength(0);
  });

  it("AT-LSM-24 (INV-23, INV-81 (3), review M2) a block open in the editor when the libraries settle: its held diagram becomes [Render] when the editor closes; one dialog for the others, nothing of it sent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { preview, libraries, orchestrator, plantumlRenderer, markdownRenderer } = stack();
    const sent = sentCodes(plantumlRenderer);
    orchestrator.state.setMarkdownText(`${PUML("OPEN")}\n${PUML("OTHER")}`);
    await orchestrator.renderAll();
    expect(preview.querySelectorAll(".plantuml-loading")).toHaveLength(2);
    const block = orchestrator.getModel().getBlocks()[0];
    const wrapper = markdownRenderer.getBlockElement(block.id);
    // the editor opens (BlockEditController, 5.14.6): the block is held and its children kept aside
    orchestrator.holdBlock(block.id);
    const saved = [...wrapper.childNodes];
    wrapper.replaceChildren(document.createElement("textarea"));
    allArrive(libraries);
    await settle();
    expect(libraries.isSettled()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent.map((c) => c.match(/(\w+) -> B/)[1])).toEqual(["OTHER"]);
    // Esc with nothing changed: the children come back, the hold is released
    wrapper.replaceChildren(...saved);
    orchestrator.releaseBlock();
    await settle();
    expect(wrapper.querySelector(".plantuml-loading")).toBeNull();
    expect(wrapper.querySelector(".plantuml-pending button").textContent).toBe(CONFIG.messages.edit.plantumlRenderButton);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("AT-LSM-16 (INV-02, INV-81 (3), AQ7, no resend) settled from the start (dev server): KaTeX is handed in the full render's step; one dialog, each diagram sent once, never again by the math redraw", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const preview = document.createElement("div");
    preview.id = "preview";
    document.body.replaceChildren(preview);
    const provided = { katex, hljs, mermaid: fakeMermaid(), plantuml: { encode: (c) => `enc(${c.length})` } };
    const libraries = new LibraryLoader(fakeBoot({ provided }), document.implementation.createHTMLDocument(""), { idle: (t) => setTimeout(t, 0) });
    const marked = new Marked();
    const math = lazyMath(markedKatex, { throwOnError: false });
    marked.use(math.extension);
    const markdownRenderer = new MarkdownRenderer(preview, marked, null, DOMPurify, undefined, math);
    const plantumlRenderer = new PlantUMLRenderer(preview, libraries.peek("plantuml"));
    const sent = sentCodes(plantumlRenderer);
    const orchestrator = new RendererOrchestrator(new ApplicationState(), markdownRenderer, new MermaidRenderer(preview, null), plantumlRenderer, new ScrollMemento(preview), preview, new SourceFileRenderer(CONFIG, preview, null, false, () => libraries.get("hljs")), libraries);
    libraries.connect(orchestrator);
    libraries.dispatchPage("coreStarted", {});
    expect(libraries.isSettled()).toBe(true);
    orchestrator.state.setMarkdownText(`- $x$\n\n  \`\`\`plantuml\n  @startuml\n  A -> B\n  @enduml\n  \`\`\`\n\n${PUML("C")}`);
    await orchestrator.renderAll();
    await settle();
    expect(preview.querySelectorAll(".katex")).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    // a commit in the math block: drawn again, its diagram is [Render], nothing sent
    const list = orchestrator.getModel().getBlocks()[0];
    orchestrator.commitBlock(list.id, "- $y$\n\n  ```plantuml\n  @startuml\n  A -> B\n  @enduml\n  ```\n");
    await settle();
    expect(preview.querySelectorAll(".plantuml-pending")).toHaveLength(1);
    expect(sent).toHaveLength(2);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
