import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

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
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import BlockDiff from "../js/classes/BlockDiff.js";
import { CONFIG } from "../js/config.js";
import { loadSampleLf, makeLexer, makeOneMegabyteDoc } from "./helpers/samples.js";

// Heavy setup (whole-document renders in jsdom) gets an explicit timeout so CPU
// load cannot fail it; the global 5 s default stays.
const HEAVY_TEST_TIMEOUT_MS = 30000;
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
  return { preview, orchestrator, markdownRenderer, mermaidLib };
}

describe("AT-PERF-01 deterministic cost checks (always run; INV-51, INV-42)", () => {
  let stack;

  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
  });

  afterEach(() => {
    stack?.preview.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("(a) one changed paragraph of sample-data-2: one sanitize, no highlight, no mermaid run, no PlantUML dialog", async () => {
    stack = realStack();
    await stack.orchestrator.loadMarkdown(loadSampleLf("sample-data-2.md"), "light");
    const para = stack.orchestrator
      .getModel()
      .getBlocks()
      .find((b) => b.type === "paragraph" && b.raw.length > 40);
    const sanitize = vi.spyOn(stack.markdownRenderer.purify, "sanitize");
    const highlight = vi.spyOn(hljs, "highlightElement");
    stack.mermaidLib.run.mockClear();
    window.confirm.mockClear();
    await stack.orchestrator.commitBlock(para.id, para.raw.replace(/\w+/, "Changed"));
    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(highlight).not.toHaveBeenCalled();
    expect(stack.mermaidLib.run).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  }, HEAVY_TEST_TIMEOUT_MS);

  it("(a) editing a PlantUML block never asks or sends: the block shows the pending box (INV-23)", async () => {
    stack = realStack();
    await stack.orchestrator.loadMarkdown("Intro\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n", "light");
    window.confirm.mockClear();
    const puml = stack.orchestrator.getModel().getBlocks().find((b) => b.type === "code");
    await stack.orchestrator.commitBlock(puml.id, "```plantuml\n@startuml\nA -> C\n@enduml\n```");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(stack.preview.querySelector(".plantuml-pending")).not.toBeNull();
    expect(stack.preview.innerHTML).not.toContain(CONFIG.plantuml.serverUrl);
  }, HEAVY_TEST_TIMEOUT_MS);

  describe("(b) 1 MB document, model only (no DOM)", () => {
    let doc;
    let lexer;
    beforeAll(() => {
      doc = makeOneMegabyteDoc();
      lexer = makeLexer();
    }, HEAVY_TEST_TIMEOUT_MS);

    it("the document is just over 1 MiB", () => {
      expect(doc.length).toBeGreaterThanOrEqual(1024 * 1024);
      expect(doc.length).toBeLessThan(1024 * 1024 + 20000);
    });

    it("a one-word change leaves a 1 x 1 middle range: n - 1 blocks match", () => {
      const m1 = MarkdownBlockModel.fromBody(doc, lexer, 1);
      const blocks = m1.getBlocks();
      const target = blocks.slice(Math.floor(blocks.length / 2)).find((b) => b.type === "paragraph");
      expect(target).toBeTruthy();
      const m2 = m1.replaceBlock(target.id, target.raw.replace(/\w+/, "Changed"), lexer, CONFIG.edit.diffMaxCells).model;
      const matches = BlockDiff.diffBlocks(m1.getBlocks(), m2.getBlocks(), CONFIG.edit.diffMaxCells);
      expect(m2.getBlocks().length).toBe(blocks.length);
      expect(matches.length).toBe(blocks.length - 1);
    }, HEAVY_TEST_TIMEOUT_MS);
  });
});

// Timing checks: only with GRSMD_PERF=1 (they depend on the machine; R6.1, Q8).
describe.runIf(PERF)("AT-PERF-02..04 timing (GRSMD_PERF=1 only)", () => {
  const PERF_TIMEOUT_MS = 60000;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("AT-PERF-02 1 MB: commit to DOM swap, median of 5 <= commitBudgetMs (diagrams excluded)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const stack = realStack();
    await stack.orchestrator.loadMarkdown(makeOneMegabyteDoc(), "light");
    const paras = stack.orchestrator
      .getModel()
      .getBlocks()
      .filter((b) => b.type === "paragraph" && b.raw.length > 40);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const p = paras[Math.floor(((i + 1) * paras.length) / 6)];
      const t0 = performance.now();
      await stack.orchestrator.commitBlock(p.id, p.raw.replace(/\w+/, `Changed${i}`));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`AT-PERF-02 times (ms): ${times.map((t) => t.toFixed(1)).join(", ")}`);
    expect(times[2]).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    stack.preview.remove();
  }, PERF_TIMEOUT_MS);

  it("AT-PERF-03 a 9,000 x 9,000 full replacement diff stays under 100 ms", () => {
    const a = Array.from({ length: 9000 }, (_, i) => ({ raw: `old ${i}` }));
    const b = Array.from({ length: 9000 }, (_, i) => ({ raw: `new ${i}` }));
    const t0 = performance.now();
    BlockDiff.diffBlocks(a, b, CONFIG.edit.diffMaxCells);
    const ms = performance.now() - t0;
    console.log(`AT-PERF-03 diff (ms): ${ms.toFixed(1)}`);
    expect(ms).toBeLessThan(100);
  }, PERF_TIMEOUT_MS);

  it("AT-PERF-04 editing a reference definition (record only, outside INV-51)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const stack = realStack();
    // At the start: the 1 MiB cut may end inside a code fence, which would swallow it.
    const body = `[d]: https://example.com/x\n\n${makeOneMegabyteDoc()}`;
    await stack.orchestrator.loadMarkdown(body, "light");
    const def = stack.orchestrator.getModel().getBlocks().find((b) => b.type === "def");
    const t0 = performance.now();
    await stack.orchestrator.commitBlock(def.id, "[d]: https://example.com/y");
    console.log(`AT-PERF-04 definition edit (ms): ${(performance.now() - t0).toFixed(1)}`);
    stack.preview.remove();
  }, PERF_TIMEOUT_MS);
});
