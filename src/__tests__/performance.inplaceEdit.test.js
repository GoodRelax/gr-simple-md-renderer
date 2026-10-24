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
import { loadSampleLf, makeLexer, makeOneMegabyteDoc, makeDocWithDuplicateDefs, makeOneMegabyteTextDoc } from "./helpers/samples.js";
import { setupEdit } from "./helpers/editStack.js";
import { tap } from "./helpers/editDom.js";

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

  it("PRT-U25 marker: a commit leaves one 'grsmd-commit' measure (commit start to replaceBlocks) and no marks; an unchanged commit adds none", async () => {
    stack = realStack();
    await stack.orchestrator.loadMarkdown("Para one.\n\nPara two.\n", "light");
    performance.clearMarks();
    performance.clearMeasures();
    const order = [];
    const replace = stack.markdownRenderer.replaceBlocks.bind(stack.markdownRenderer);
    vi.spyOn(stack.markdownRenderer, "replaceBlocks").mockImplementation((...args) => {
      order.push(`replace(marks=${performance.getEntriesByName("grsmd-commit-start", "mark").length})`);
      return replace(...args);
    });
    const [a, b] = stack.orchestrator.getModel().getBlocks();
    await stack.orchestrator.commitBlock(a.id, "Para one changed.");
    await stack.orchestrator.commitBlock(b.id, "Para two changed.");
    const measures = performance.getEntriesByName("grsmd-commit", "measure");
    expect(order).toEqual(["replace(marks=1)", "replace(marks=1)"]);
    expect(measures).toHaveLength(1);
    expect(measures[0].duration).toBeGreaterThanOrEqual(0);
    expect(performance.getEntriesByName("grsmd-commit-start", "mark")).toHaveLength(0);

    const last = measures[0];
    const current = stack.orchestrator.getModel().getBlocks()[0];
    await stack.orchestrator.commitBlock(current.id, current.raw); // unchanged
    expect(performance.getEntriesByName("grsmd-commit", "measure")).toEqual([last]);
    expect(performance.getEntriesByName("grsmd-commit-start", "mark")).toHaveLength(0);
  });

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

describe("AT-PERF-08 a table session never makes the whole table's HTML inside a step (INV-51, INV-47)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opening a cell and committing it make none; a row operation makes only a small table's", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const rows = Array.from({ length: 50 }, (_, i) => `| r${i} | a${i} |`).join("\n");
    const s = await setupEdit(`| A | B |\n| --- | --- |\n${rows}\n\nAfter.\n`);
    const tableEl = () => s.block((b) => b.type === "table").el.querySelector(":scope > table");
    const blockHtml = vi.spyOn(s.markdownRenderer, "blockHtml");
    tap(tableEl().rows[3].cells[1]);
    const td = tableEl().rows[3].cells[1];
    td.firstChild.data = "changed";
    td.dispatchEvent(new Event("input", { bubbles: true }));
    td.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(blockHtml).not.toHaveBeenCalled(); // the commit writes the cell only; the render makes the table's HTML later
    s.bec.dispatch("tableOperationRequested", { op: { kind: "insertRow" } });
    expect(blockHtml).toHaveBeenCalledTimes(1);
    expect(blockHtml.mock.calls[0][0].split("\n")).toHaveLength(3); // header, delimiter, one empty row
    s.teardown();
  });
});

// Timing checks: only with GRSMD_PERF=1 (they depend on the machine; R6 Independence, Q8).
describe.runIf(PERF)("AT-PERF-02..07, 09 and 10 timing (GRSMD_PERF=1 only)", () => {
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

  it("AT-PERF-05 1 MB with 55 duplicate definitions spread over it: commit to DOM swap, median of 5 <= commitBudgetMs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const stack = realStack();
    const body = makeDocWithDuplicateDefs(58, 55);
    expect(body.length).toBeGreaterThan(1024 * 1024);
    await stack.orchestrator.loadMarkdown(body, "light");
    expect(stack.orchestrator.getModel().isWholeDocument).toBe(false);
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
    console.log(`AT-PERF-05 times (ms): ${times.map((t) => t.toFixed(1)).join(", ")}`);
    expect(times[2]).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    stack.preview.remove();
  }, PERF_TIMEOUT_MS);

  it("AT-PERF-06 1 MB text document (PRT-U25): full render, then commit to DOM swap median of 5 <= commitBudgetMs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const stack = realStack();
    const body = makeOneMegabyteTextDoc();
    const t0 = performance.now();
    await stack.orchestrator.loadMarkdown(body, "light");
    const full = performance.now() - t0;
    const paras = stack.orchestrator
      .getModel()
      .getBlocks()
      .filter((b) => b.type === "paragraph" && b.raw.length > 40);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const p = paras[Math.floor(((i + 1) * paras.length) / 6)];
      const t1 = performance.now();
      await stack.orchestrator.commitBlock(p.id, p.raw.replace(/\w+/, `Changed${i}`));
      times.push(performance.now() - t1);
    }
    times.sort((a, b) => a - b);
    console.log(`AT-PERF-06 full render (ms): ${full.toFixed(1)}; commits (ms): ${times.map((t) => t.toFixed(1)).join(", ")}`);
    expect(times[2]).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    stack.preview.remove();
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

  it("AT-PERF-07 1 MB with a 1,000 x 5 table (INV-51): first cell open, cell commit to next cell, table operation, format <= commitBudgetMs each", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const rows = Array.from({ length: 1000 }, (_, i) => `| r${i} | a${i} | b${i} | c${i} | d${i} |`).join("\n");
    const table = `| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
    // the table first: the 1 MiB cut may end inside a code fence
    const s = await setupEdit(`${table}\n${makeOneMegabyteDoc()}`);
    const tableEl = () => s.block((b) => b.type === "table").el.querySelector(":scope > table");
    const time = (fn) => {
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    };
    const open = time(() => tap(tableEl().rows[500].cells[1]));
    const td = tableEl().rows[500].cells[1];
    td.firstChild.data = "changed";
    td.dispatchEvent(new Event("input", { bubbles: true }));
    const commit = time(() => td.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    const operation = time(() => s.bec.dispatch("tableOperationRequested", { op: { kind: "insertRow" } }));
    const cell = tableEl().rows[500].cells[2];
    const range = document.createRange();
    range.selectNodeContents(s.block((b) => b.type === "table").el.querySelector(".grsmd-cell-editing"));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    s.bec.dispatch("escapePressed");
    tap(cell);
    const r2 = document.createRange();
    r2.selectNodeContents(cell);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r2);
    const format = time(() => s.bec.formatSelection({ kind: "strong" }));
    console.log(`AT-PERF-07 (ms): open ${open.toFixed(1)}, commit ${commit.toFixed(1)}, operation ${operation.toFixed(1)}, format ${format.toFixed(1)}`);
    // The table operation draws the whole table through DOMPurify, which jsdom
    // runs many times slower than Chrome: it is timed in Chromium instead
    // (e2e/tableCell.e2e.js, PRT-X23); here its count of HTML runs is fixed
    // (AT-PERF-01).
    for (const ms of [open, commit, format]) expect(ms).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    s.teardown();
  }, PERF_TIMEOUT_MS);

  it("AT-PERF-10 1 MB (INV-51, INV-52): Insert table in an open paragraph, from the press to the open Col1, median of 5 <= commitBudgetMs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const s = await setupEdit(makeOneMegabyteDoc());
    const times = [];
    for (let i = 0; i < 5; i++) {
      const paras = s.orchestrator.getModel().getBlocks().filter((b) => b.type === "paragraph" && b.raw.includes("\n"));
      const p = paras[Math.floor(((i + 1) * paras.length) / 6)];
      tap(s.markdownRenderer.getBlockElement(p.id).firstElementChild);
      const ta = s.preview.querySelector("textarea.md-block-editor");
      ta.value = ta.value.replace(/\w+/, `Changed${i}`);
      ta.setSelectionRange(2, 2);
      const t0 = performance.now();
      await s.bec.dispatch("blockInsertRequested", { kind: "insert", raw: CONFIG.edit.tableTemplate, opens: "cell" });
      times.push(performance.now() - t0);
      expect(s.bec.isEditingCell()).toBe(true);
      s.bec.dispatch("escapePressed");
    }
    times.sort((a, b) => a - b);
    console.log(`AT-PERF-10 times (ms): ${times.map((t) => t.toFixed(1)).join(", ")}`);
    expect(times[2]).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    s.teardown();
  }, PERF_TIMEOUT_MS);

  it("AT-PERF-09 1 MB with one 250 KB paragraph of 5,000 links (INV-51, INV-69): one frame's button states (Format open: canFormat, Paste link, Remove link) <= commitBudgetMs", async () => {
    const lines = [];
    for (let i = 0; i < 5000; i++) lines.push(`l${i} see [a link ${i}](https://example.com/${i}) t`);
    const s = await setupEdit(`${lines.join("\n")}\n\n${makeOneMegabyteDoc()}`);
    tap(s.block((b) => b.raw.startsWith("l0 ")).el.firstElementChild);
    const ta = s.editor();
    const frame = () => {
      const t0 = performance.now();
      s.bec.canFormatSelection();
      s.bec.canPasteLink();
      s.bec.canRemoveLink();
      return performance.now() - t0;
    };
    const times = [];
    for (const at of [ta.value.length - 1, Math.floor(ta.value.length / 2), ta.value.indexOf("a link 9")]) {
      ta.setSelectionRange(at, at);
      times.push(frame()); // a new caret: nothing kept from before for these checks
    }
    console.log(`AT-PERF-09 one frame of button states (ms): ${times.map((t) => t.toFixed(1)).join(", ")}`);
    for (const ms of times) expect(ms).toBeLessThanOrEqual(CONFIG.edit.commitBudgetMs);
    s.teardown();
  }, PERF_TIMEOUT_MS);
});

describe.runIf(PERF)("AT-PERF-11 the undo record on 1 MB (INV-48, GRSMD_PERF=1 only)", () => {
  // The heap the records keep after 30 commits, as RendererOrchestrator
  // records them (withoutJoinedBody). A record must not keep a whole body:
  // not through a block's raw, the leading blank lines or a link's text.
  const RECORD_BUDGET_MIB = 4;
  const MEMORY_TIMEOUT_MS = 120000;
  const variants = () => {
    const doc = makeOneMegabyteDoc();
    const defs = Array.from({ length: 20 }, (_, i) => `[reference-${i}]: https://example.com/a/long/path/${i} "A title for reference ${i}"`).join("\n");
    return [
      ["a plain document", doc],
      ["20 reference definitions at the top", `${defs}\n\n${doc}`],
      ["40 leading blank lines", `${"\n".repeat(40)}${doc}`],
    ];
  };
  let gc;
  beforeAll(async () => {
    const v8 = await import("node:v8");
    const vm = await import("node:vm");
    v8.setFlagsFromString("--expose-gc");
    gc = vm.runInNewContext("gc");
  });
  const heap = () => {
    gc();
    gc();
    return process.memoryUsage().heapUsed;
  };

  it.each(variants())("%s: 30 records keep less than RECORD_BUDGET_MIB", (name, doc) => {
    const lexer = makeLexer();
    let model = MarkdownBlockModel.fromBody(doc, lexer, 1);
    const paragraphs = model.getBlocks().filter((b) => b.type === "paragraph").map((b) => b.raw);
    const record = [];
    for (let i = 0; i < CONFIG.edit.undoMaxSteps; i++) {
      const raw = paragraphs[(i * 97) % paragraphs.length];
      const target = model.getBlocks().find((b) => b.raw === raw) ?? model.getBlocks().find((b) => b.type === "paragraph");
      model.toBody(); // the current model's body is joined, as in the app
      const change = model.replaceBlock(target.id, `${target.raw.trimEnd()} edit${i}`, lexer, CONFIG.edit.diffMaxCells);
      record.push(model.withoutJoinedBody());
      model = change.model;
    }
    const withRecord = heap();
    record.length = 0;
    const kept = (withRecord - heap()) / (1024 * 1024);
    console.log(`AT-PERF-11 ${name}: 30 records keep ${kept.toFixed(2)} MiB`);
    expect(kept).toBeLessThan(RECORD_BUDGET_MIB);
  }, MEMORY_TIMEOUT_MS);
});
