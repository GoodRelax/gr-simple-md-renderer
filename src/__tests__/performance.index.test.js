import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return { ...actual, applyTheme: vi.fn(), waitForDOMStability: vi.fn().mockResolvedValue(true) };
});

import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MermaidRenderer from "../js/classes/MermaidRenderer.js";
import PlantUMLRenderer from "../js/classes/PlantUMLRenderer.js";
import ScrollMemento from "../js/classes/ScrollMemento.js";
import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import DocumentIndex from "../js/classes/DocumentIndex.js";

// A file of its own: jsdom gets slower with every large document left in it,
// and the timing tests of performance.inplaceEdit.test.js leave some.
const PERF = process.env.GRSMD_PERF === "1";

function realStack() {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const preview = document.createElement("div");
  document.body.appendChild(preview);
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  const mermaidLib = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
  const markdownRenderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  const orchestrator = new RendererOrchestrator(
    new ApplicationState(),
    markdownRenderer,
    new MermaidRenderer(preview, mermaidLib),
    new PlantUMLRenderer(preview, { encode: () => "ENC" }),
    new ScrollMemento(preview),
    preview,
    { render: vi.fn(), reload: vi.fn(), destroy: vi.fn() },
  );
  return { preview, orchestrator };
}

// INV-77 (2): the Index shown on 1 MB. Timing: GRSMD_PERF=1 only.
describe.runIf(PERF)("AT-PERF-14 the Index on 1 MB (INV-77 (2); GRSMD_PERF=1 only)", () => {
  // about 60 s alone, mostly jsdom rendering 9,500 blocks (11 times); more
  // beside the other files
  const PERF_TIMEOUT_MS = 300000;
  // the coordinator's target (2026-10-25): what one commit or Undo adds to the frame after it
  const INDEX_UPDATE_BUDGET_MS = 50;
  /** Longer than a frame (nextFrame falls back to a 16 ms timer in jsdom). */
  const frame = () => new Promise((r) => setTimeout(r, 40));
  /**
   * 1 MB of long headings, a paragraph every 50 (9,318 headings: the
   * review measured 9,826). About as many blocks as the 1 MB sample: jsdom
   * renders blocks in more than linear time, and many more keep it loading
   * for minutes.
   */
  function makeOneMegabyteOfHeadings() {
    const parts = [];
    let size = 0;
    for (let i = 1; size < 1024 * 1024; i++) {
      const text = i % 50 === 0 ? `Text of section ${i}, long enough to read like a short paragraph of the document.\n\n` : "";
      const part = `## Section ${i}: a heading long enough to stand for one of a real document, as most of them are in a long one\n\n${text}`;
      parts.push(part);
      size += part.length;
    }
    return parts.join("");
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("AT-PERF-14 1 MB of headings with the Index shown: its update after a commit, and after an Undo, median of 5 <= 50 ms; the first list is measured only", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const stack = realStack();
    await stack.orchestrator.loadMarkdown(makeOneMegabyteOfHeadings(), "light");
    const make = (tag) => document.createElement(tag);
    const els = { button: make("button"), panel: make("nav"), column: make("div"), preview: stack.preview };
    els.panel.hidden = true;
    els.column.append(els.panel);
    document.body.append(els.button, els.column);
    const index = new DocumentIndex(els, new ScrollMemento(stack.preview), { emptyText: "none" });
    let t0 = performance.now();
    index.show();
    const first = performance.now() - t0;
    const headings = els.panel.children.length;

    const updates = [];
    const apply = index._applyChanges.bind(index);
    index._applyChanges = () => {
      const start = performance.now();
      apply();
      updates.push(performance.now() - start);
    };
    const paras = stack.orchestrator
      .getModel()
      .getBlocks()
      .filter((b) => b.type === "paragraph" && b.raw.length > 40);
    const commits = [];
    for (let i = 0; i < 5; i++) {
      const p = paras[Math.floor(((i + 1) * paras.length) / 6)];
      await stack.orchestrator.commitBlock(p.id, `## Index ${i}\n\n${p.raw}`);
      await frame();
      commits.push(updates.pop());
    }
    const undos = [];
    for (let i = 0; i < 5; i++) {
      await stack.orchestrator.undoLastCommit();
      await frame();
      undos.push(updates.pop());
    }
    expect(els.panel.children.length).toBe(headings);
    commits.sort((a, b) => a - b);
    undos.sort((a, b) => a - b);
    console.log(
      `AT-PERF-14 ${headings} headings, ${stack.preview.childElementCount} blocks: first list ${first.toFixed(1)} ms; ` +
        `after a commit (ms): ${commits.map((t) => t.toFixed(1)).join(", ")}; after an Undo (ms): ${undos.map((t) => t.toFixed(1)).join(", ")}`,
    );
    expect(commits[2]).toBeLessThanOrEqual(INDEX_UPDATE_BUDGET_MS);
    expect(undos[2]).toBeLessThanOrEqual(INDEX_UPDATE_BUDGET_MS);
    index.hide();
    els.button.remove();
    els.column.remove();
    stack.preview.remove();
  }, PERF_TIMEOUT_MS);
});
