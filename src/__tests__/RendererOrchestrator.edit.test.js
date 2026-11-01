import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});

import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import BlockCaretMap from "../js/classes/BlockCaretMap.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import { CONFIG } from "../js/config.js";
import { waitForDOMStability } from "../js/utils.js";
import { makeLexer } from "./helpers/samples.js";
import { deferred } from "./helpers/fakeFs.js";

const lexer = makeLexer();
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// Real MarkdownBlockModel inside the orchestrator; fakes for the drawing side.
function setup() {
  const calls = [];
  const elements = new Map();
  const elementFor = (id) => {
    if (!elements.has(id)) elements.set(id, { id, name: `el${id}` });
    return elements.get(id);
  };
  const markdownRenderer = {
    lex: (src) => lexer(src),
    render: vi.fn().mockResolvedValue(undefined),
    renderBlocks: vi.fn((model) => {
      calls.push("renderBlocks");
      for (const b of model.getBlocks()) elementFor(b.id);
    }),
    replaceBlocks: vi.fn((rendered, current) => {
      calls.push("replaceBlocks");
      return current.getBlocks().filter((b) => rendered.findIndexById(b.id) < 0).map((b) => elementFor(b.id));
    }),
    getBlockElement: vi.fn((id) => elements.get(id) ?? null),
    resetExternalImageConsent: vi.fn(),
  };
  const mermaidRenderer = {
    render: vi.fn(async () => {
      calls.push("mermaid");
    }),
  };
  const plantumlRenderer = {
    render: vi.fn(async (theme, root, mode) => {
      calls.push(`plantuml:${mode ?? "consent"}`);
    }),
  };
  let anchorSeq = 0;
  const scrollManager = {
    save: vi.fn().mockReturnValue(0),
    restore: vi.fn(),
    watchUserMoves: vi.fn(() => ({ place: () => null, stop: vi.fn() })),
    captureAnchor: vi.fn((el) => {
      calls.push(`capture:${el?.name ?? "null"}`);
      return el ? { offsetTop: 100 + anchorSeq++ } : null;
    }),
    restoreAnchor: vi.fn((anchor, el) => {
      calls.push(`restore:${el?.name ?? "null"}`);
    }),
  };
  const sourceFileRenderer = {
    render: vi.fn().mockResolvedValue({ fileName: "a.py" }),
    reload: vi.fn(),
    destroy: vi.fn(),
  };
  const state = new ApplicationState();
  const preview = document.createElement("div");
  const orchestrator = new RendererOrchestrator(
    state,
    markdownRenderer,
    mermaidRenderer,
    plantumlRenderer,
    scrollManager,
    preview,
    sourceFileRenderer,
  );
  const listener = { onModelChanged: vi.fn() };
  orchestrator.setModelChangedListener(listener);
  const ids = () => orchestrator.getModel().getBlocks().map((b) => b.id);
  const idOf = (text) => orchestrator.getModel().getBlocks().find((b) => b.raw.trim() === text).id;
  return {
    orchestrator,
    state,
    markdownRenderer,
    mermaidRenderer,
    plantumlRenderer,
    scrollManager,
    sourceFileRenderer,
    preview,
    listener,
    calls,
    elements,
    elementFor,
    ids,
    idOf,
  };
}

async function loaded(body = "A\n\nB\n\nC\n") {
  const t = setup();
  await t.orchestrator.loadMarkdown(body, "light");
  t.calls.length = 0;
  vi.clearAllMocks();
  return t;
}

describe("RendererOrchestrator edit API (INV-47, INV-48, spec 5.14.3)", () => {
  beforeEach(() => {
    vi.mocked(waitForDOMStability).mockResolvedValue(true);
  });

  it("AT-ORC-01 commitBlock updates the model and notifies synchronously, before any await", async () => {
    const t = await loaded();
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    expect(t.orchestrator.getBody()).toBe("A\n\nB2\n\nC\n");
    expect(t.state.markdownText).toBe("A\n\nB2\n\nC\n");
    expect(t.listener.onModelChanged).toHaveBeenCalledTimes(1);
    expect(t.listener.onModelChanged.mock.calls[0][0].isChanged).toBe(true);
  });

  it("AT-ORC-02 the render is queued: not run yet when commitBlock returns; the promise settles after it", async () => {
    const t = await loaded();
    const p = t.orchestrator.commitBlock(t.idOf("B"), "B2");
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    await p;
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(1);
  });

  it("AT-ORC-03 an unchanged commit notifies nothing, queues nothing, and keeps the undo state", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("B"), "B");
    expect(t.listener.onModelChanged).not.toHaveBeenCalled();
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    expect(t.orchestrator.canUndo()).toBe(false);
  });

  it("AT-ORC-04 renders run one after another; the second goes from the first's model to the latest", async () => {
    const t = await loaded();
    const gate = deferred();
    t.mermaidRenderer.render.mockImplementationOnce(() => gate.promise);
    const p1 = t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await flush();
    const p2 = t.orchestrator.commitBlock(t.idOf("C"), "C2");
    await flush();
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([p1, p2]);
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(2);
    const [first, second] = t.markdownRenderer.replaceBlocks.mock.calls;
    expect(second[0]).toBe(first[1]);
    expect(second[1]).toBe(t.orchestrator.getModel());
  });

  it("AT-ORC-05 queued commits collapse: the last render shows the latest model with the last anchor", async () => {
    const t = await loaded("A\n\nB\n\nC\n\nD\n");
    const gate = deferred();
    t.mermaidRenderer.render.mockImplementationOnce(() => gate.promise);
    const p1 = t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await flush();
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const p3 = t.orchestrator.commitBlock(t.idOf("C"), "C2");
    const lastAnchorId = t.listener.onModelChanged.mock.calls.at(-1)[0].anchorBlockId;
    gate.resolve();
    await Promise.all([p1, p3]);
    const renders = t.markdownRenderer.replaceBlocks.mock.calls;
    expect(renders.length).toBeLessThanOrEqual(3);
    expect(renders.at(-1)[1]).toBe(t.orchestrator.getModel());
    const lastRestores = t.scrollManager.restoreAnchor.mock.calls.slice(-2);
    for (const [, el] of lastRestores) expect(el).toBe(t.elements.get(lastAnchorId));
    expect(lastRestores[0][0]).toBe(t.scrollManager.captureAnchor.mock.results.at(-1).value);
  });

  it("AT-ORC-06 anchor: captured synchronously on the old element; restored after DOM stability (only the anchor block changed: nothing above it moved, so no correction right after the swap)", async () => {
    const t = await loaded();
    const bId = t.idOf("B");
    const p = t.orchestrator.commitBlock(bId, "B2");
    expect(t.calls).toEqual([`capture:el${bId}`]);
    await p;
    const newId = t.idOf("B2");
    expect(t.calls).toEqual([`capture:el${bId}`, "replaceBlocks", "mermaid", "plantuml:placeholder", `restore:el${newId}`]);
    expect(waitForDOMStability).toHaveBeenCalled();
  });

  it("AT-ORC-06b when the block count changes (a split), the anchor is also restored right after the swap", async () => {
    const t = await loaded();
    const bId = t.idOf("B");
    await t.orchestrator.commitBlock(bId, "B2\n\nB3");
    const newId = t.idOf("B2");
    expect(t.calls).toEqual([
      `capture:el${bId}`,
      "replaceBlocks",
      `restore:el${newId}`,
      "mermaid",
      "plantuml:placeholder",
      `restore:el${newId}`,
    ]);
  });

  it("a commit given an anchor taken before the editor closed uses it and captures nothing itself", async () => {
    const t = await loaded();
    const anchor = { offsetTop: 42 };
    await t.orchestrator.commitBlock(t.idOf("B"), "B2", anchor);
    expect(t.scrollManager.captureAnchor).not.toHaveBeenCalled();
    expect(t.scrollManager.restoreAnchor.mock.calls.at(-1)[0]).toBe(anchor);
  });

  it("AT-ORC-07 undo restores the body synchronously, notifies, disables undo, and queues a render", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    vi.clearAllMocks();
    const p = t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n");
    expect(t.listener.onModelChanged).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.canUndo()).toBe(false);
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    await p;
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(1);
  });

  it("AT-ORC-08 an unchanged commit does not overwrite the undo record", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.commitBlock(t.idOf("B"), "B");
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n");
  });

  it("AT-ORC-09 every unit can be undone in turn, and redone in turn (INV-48, owner ruling D4)", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.commitBlock(t.idOf("C"), "C2");
    expect(t.orchestrator.canRedo()).toBe(false);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A2\n\nB\n\nC\n");
    expect(t.orchestrator.canUndo()).toBe(true);
    expect(t.orchestrator.canRedo()).toBe(true);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n");
    expect(t.orchestrator.canUndo()).toBe(false);
    await t.orchestrator.undoLastCommit(); // nothing left: no change
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n");
    await t.orchestrator.redoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A2\n\nB\n\nC\n");
    await t.orchestrator.redoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A2\n\nB\n\nC2\n");
    expect(t.orchestrator.canRedo()).toBe(false);
    await t.orchestrator.redoLastCommit(); // nothing left
    expect(t.orchestrator.getBody()).toBe("A2\n\nB\n\nC2\n");
    expect(t.orchestrator.canUndo()).toBe(true);
  });

  it("AT-ORC-09b at most CONFIG.edit.undoMaxSteps units are kept; the oldest goes first", async () => {
    expect(CONFIG.edit.undoMaxSteps).toBe(30);
    const t = await loaded("A0\n");
    const max = CONFIG.edit.undoMaxSteps;
    for (let i = 1; i <= max + 5; i++) await t.orchestrator.commitBlock(t.orchestrator.getModel().getBlocks()[0].id, `A${i}`);
    let undone = 0;
    while (t.orchestrator.canUndo()) {
      await t.orchestrator.undoLastCommit();
      undone++;
    }
    expect(undone).toBe(max);
    expect(t.orchestrator.getBody()).toBe("A5\n");
    let redone = 0;
    while (t.orchestrator.canRedo()) {
      await t.orchestrator.redoLastCommit();
      redone++;
    }
    expect(redone).toBe(max);
    expect(t.orchestrator.getBody()).toBe(`A${max + 5}\n`);
  });

  it("AT-ORC-09c a new unit after an undo empties the redo record; a full render and a cleared document empty both (D6)", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.canRedo()).toBe(true);
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    expect(t.orchestrator.canRedo()).toBe(false);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.canRedo()).toBe(true);
    await t.orchestrator.renderAll();
    expect([t.orchestrator.canUndo(), t.orchestrator.canRedo()]).toEqual([false, false]);
    await t.orchestrator.commitBlock(t.idOf("C"), "C2");
    await t.orchestrator.undoLastCommit();
    t.orchestrator.clearDocument();
    expect([t.orchestrator.canUndo(), t.orchestrator.canRedo()]).toEqual([false, false]);
  });

  it("AT-ORC-09d a redone model keeps the id counter: ids given after it are larger than every id before (R4)", async () => {
    const t = await loaded();
    const seen = new Set(t.ids());
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    t.ids().forEach((id) => seen.add(id));
    await t.orchestrator.undoLastCommit();
    await t.orchestrator.redoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB2\n\nC\n");
    await t.orchestrator.commitBlock(t.idOf("C"), "C9");
    expect(t.idOf("C9")).toBeGreaterThan(Math.max(...seen));
  });

  it("AT-ORC-10 ids given after an undo are larger than every id given before", async () => {
    const t = await loaded();
    const seen = new Set(t.ids());
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    t.ids().forEach((id) => seen.add(id));
    await t.orchestrator.undoLastCommit();
    await t.orchestrator.commitBlock(t.idOf("C"), "C9");
    const fresh = t.idOf("C9");
    expect(fresh).toBeGreaterThan(Math.max(...seen));
  });

  describe("AT-ORC-11 undo anchor (spec 5.14.9)", () => {
    it("uses the element of the first restored block when it is still known", async () => {
      const t = await loaded();
      const bId = t.idOf("B");
      await t.orchestrator.commitBlock(bId, "B2");
      t.calls.length = 0;
      const p = t.orchestrator.undoLastCommit();
      expect(t.calls[0]).toBe(`capture:el${bId}`);
      await p;
      // Only the restored block changed (same count): one correction, after DOM stability.
      expect(t.calls.filter((c) => c.startsWith("restore:"))).toEqual([`restore:el${bId}`]);
    });

    it("falls back to the element now at the same position", async () => {
      const t = await loaded();
      const bId = t.idOf("B");
      await t.orchestrator.commitBlock(bId, "B2");
      t.elements.delete(bId);
      const b2 = t.idOf("B2");
      t.calls.length = 0;
      t.orchestrator.undoLastCommit();
      expect(t.calls[0]).toBe(`capture:el${b2}`);
    });

    it("takes no anchor when no element is known, or when the restored document is empty", async () => {
      const t = await loaded("Only\n");
      await t.orchestrator.commitBlock(t.idOf("Only"), "Other");
      t.elements.clear();
      t.calls.length = 0;
      vi.clearAllMocks();
      await t.orchestrator.undoLastCommit();
      expect(t.scrollManager.captureAnchor).not.toHaveBeenCalled();
      expect(t.scrollManager.restoreAnchor).not.toHaveBeenCalled();

      const e = await loaded("");
      await e.orchestrator.insertAfter(null, "New");
      e.calls.length = 0;
      vi.clearAllMocks();
      await e.orchestrator.undoLastCommit();
      expect(e.orchestrator.getBody()).toBe("");
      expect(e.scrollManager.restoreAnchor).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["full render (reRender)", (o) => o.reRender("dark")],
    ["loadMarkdown", (o) => o.loadMarkdown("X\n", "light")],
    ["startEmptyDocument", (o) => o.startEmptyDocument()],
    ["clearDocument", (o) => o.clearDocument()],
    ["clear", (o) => o.clear()],
  ])("AT-ORC-12 %s empties the undo record", async (_n, act) => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    expect(t.orchestrator.canUndo()).toBe(true);
    await act(t.orchestrator);
    expect(t.orchestrator.canUndo()).toBe(false);
  });

  it("AT-ORC-13 insertAfter is one undoable change; without a block it appends at the end", async () => {
    const t = await loaded();
    await t.orchestrator.insertAfter(t.idOf("A"), "T");
    expect(t.orchestrator.getBody()).toBe("A\n\nT\n\nB\n\nC\n");
    expect(t.listener.onModelChanged).toHaveBeenCalledTimes(1);
    expect(t.orchestrator.canUndo()).toBe(true);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n");
    await t.orchestrator.insertAfter(null, "E");
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n\nE\n"); // the last newline stays (L1)
  });

  it("AT-ORC-14 after a new document, pending and running partial renders drop their anchors; one full render runs", async () => {
    const t = await loaded("A\n\nB\n\nC\n");
    const gate = deferred();
    t.mermaidRenderer.render.mockImplementationOnce(() => gate.promise);
    const p1 = t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await flush();
    const restoresBefore = t.scrollManager.restoreAnchor.mock.calls.length;
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const pLoad = t.orchestrator.loadMarkdown("New doc\n", "light");
    gate.resolve();
    await Promise.all([p1, pLoad]);
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(1);
    expect(t.scrollManager.restoreAnchor.mock.calls.length).toBe(restoresBefore);
    expect(t.markdownRenderer.renderBlocks).toHaveBeenCalledTimes(1);
    expect(t.markdownRenderer.renderBlocks.mock.calls[0][0].toBody()).toBe("New doc\n");
  });

  it("AT-ORC-15 clearDocument drops the queued partial render and queues no full render", async () => {
    const t = await loaded();
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    t.orchestrator.clearDocument();
    await flush();
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    expect(t.markdownRenderer.renderBlocks).not.toHaveBeenCalled();
    expect(t.orchestrator.getBody()).toBe("");
    expect(t.orchestrator.getModel()).toBe(null);
  });

  it("AT-ORC-16 switching to the code view drops the queued partial render; no Markdown full render", async () => {
    const t = await loaded();
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const p = t.orchestrator.renderCodeView(new File(["x"], "a.py"), null);
    await p;
    await flush();
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    expect(t.markdownRenderer.renderBlocks).not.toHaveBeenCalled();
    expect(t.orchestrator.getModel()).toBe(null);
    expect(t.orchestrator.isCodeViewActive()).toBe(true);
  });

  it("AT-ORC-17 block ids grow across documents, through Clear and the code view", async () => {
    const t = setup();
    await t.orchestrator.loadMarkdown("A\n\nB\n", "light");
    const first = Math.max(...t.ids());
    t.orchestrator.clear();
    await t.orchestrator.loadMarkdown("C\n\nD\n", "light");
    const second = t.ids();
    expect(Math.min(...second)).toBeGreaterThan(first);
    await t.orchestrator.renderCodeView(new File(["x"], "a.py"), null);
    await t.orchestrator.loadMarkdown("E\n", "light");
    expect(Math.min(...t.ids())).toBeGreaterThan(Math.max(...second));
  });

  it("AT-ORC-18 a commit for an id that is not in the model changes nothing", async () => {
    const t = await loaded();
    const before = t.orchestrator.getModel();
    await t.orchestrator.commitBlock(9999, "X");
    expect(t.orchestrator.getModel()).toBe(before);
    expect(t.listener.onModelChanged).not.toHaveBeenCalled();
    expect(t.markdownRenderer.replaceBlocks).not.toHaveBeenCalled();
    expect(t.scrollManager.captureAnchor).not.toHaveBeenCalled();
  });

  it("AT-ORC-19 a full render draws by block, asks PlantUML consent, saves and restores the scroll", async () => {
    const t = setup();
    t.state.setMarkdownText("# H\n\nP\n");
    t.orchestrator._viewState = "markdown";
    await t.orchestrator.reRender("dark");
    expect(t.markdownRenderer.renderBlocks).toHaveBeenCalledTimes(1);
    expect(t.markdownRenderer.renderBlocks.mock.calls[0][0].toBody()).toBe("# H\n\nP\n");
    expect(t.mermaidRenderer.render).toHaveBeenCalledWith("dark");
    expect(t.plantumlRenderer.render).toHaveBeenCalledWith("dark", t.preview, "consent", null); // no loader: the page counts as settled (11-g)
    expect(t.scrollManager.save).toHaveBeenCalled();
    expect(t.scrollManager.restore).toHaveBeenCalled();
    expect(t.orchestrator.canUndo()).toBe(false);
  });

  it("AT-ORC-20 a partial render draws diagrams only in the replaced blocks, PlantUML as placeholder", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const replaced = t.markdownRenderer.replaceBlocks.mock.results[0].value;
    expect(t.mermaidRenderer.render).toHaveBeenCalledWith("light", replaced);
    expect(t.plantumlRenderer.render).toHaveBeenCalledWith("light", replaced, "placeholder", null);
    expect(t.plantumlRenderer.render).toHaveBeenCalledTimes(1);
  });

  it("AT-ORC-21 startEmptyDocument goes to the markdown view with an empty body", async () => {
    const t = setup();
    await t.orchestrator.startEmptyDocument();
    expect(t.orchestrator.isPreRenderState()).toBe(false);
    expect(t.orchestrator.isCodeViewActive()).toBe(false);
    expect(t.orchestrator.getBody()).toBe("");
    expect(t.markdownRenderer.renderBlocks).toHaveBeenCalledTimes(1);
  });

  it("AT-ORC-22 emptying the only block keeps the markdown view (INV-49)", async () => {
    const t = await loaded("Only\n");
    await t.orchestrator.commitBlock(t.idOf("Only"), "");
    expect(t.orchestrator.getBody()).toBe("");
    expect(t.orchestrator.isPreRenderState()).toBe(false);
    expect(t.orchestrator.isCodeViewActive()).toBe(false);
  });

  it("AT-ORC-23 a failed render does not stop the queue (Q11)", async () => {
    const t = await loaded();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t.markdownRenderer.replaceBlocks.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.commitBlock(t.idOf("C"), "C2");
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("AT-ORC-T table commits (INV-42 / 46 / 47 / 48, INV-62)", () => {
  const TBL = "Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nEnd\n";
  const tableId = (t) => t.orchestrator.getModel().getBlocks().find((b) => b.type === "table").id;

  it("AT-ORC-T1 replaceTableBlock applies a kept plan as one undoable unit, reading no layout (INV-46, INV-51)", async () => {
    const t = await loaded(TBL);
    const id = tableId(t);
    const before = t.orchestrator.getModel();
    const plan = t.orchestrator.planTableReplace(id, "| a | b |\n| --- | --- |\n| 1x | 2 |");
    expect(plan.keptId).toBe(true);
    expect(t.orchestrator.getModel()).toBe(before); // planning changes nothing
    t.orchestrator.replaceTableBlock(id, plan);
    expect(t.orchestrator.getModel()).toBe(plan.model);
    expect(tableId(t)).toBe(id);
    expect(t.listener.onModelChanged).toHaveBeenCalledTimes(1);
    expect(t.calls.filter((c) => c.startsWith("capture:"))).toEqual([]); // the held table's top does not move
    expect(t.orchestrator.canUndo()).toBe(true);
    t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe(TBL);
  });

  it("AT-ORC-T2 a plan made on another model than the current one changes nothing", async () => {
    const t = await loaded(TBL);
    const id = tableId(t);
    const stale = t.orchestrator.planTableReplace(id, "| a |\n| --- |");
    t.orchestrator.commitBlock(t.idOf("End"), "End changed");
    const body = t.orchestrator.getBody();
    t.orchestrator.replaceTableBlock(id, stale);
    expect(t.orchestrator.getBody()).toBe(body);
  });

  it("AT-ORC-T3 a table operation plans on the model of the cell commit before it (two units)", async () => {
    const t = await loaded(TBL);
    const id = tableId(t);
    const commit = t.orchestrator.planTableReplace(id, "| a | b |\n| --- | --- |\n| 9 | 2 |");
    const op = t.orchestrator.planTableReplace(id, "| a | b |\n| --- | --- |\n| 9 | 2 |\n|   |   |", commit.model);
    t.orchestrator.replaceTableBlock(id, commit);
    t.orchestrator.replaceTableBlock(id, op);
    expect(t.orchestrator.getBody()).toContain("|   |   |");
    t.orchestrator.undoLastCommit(); // the operation only
    expect(t.orchestrator.getBody()).toContain("| 9 | 2 |\n\nEnd");
  });

  it("AT-ORC-T4 writeHeldInterior writes only inside the held block, and then counts it current", async () => {
    const t = await loaded(TBL);
    const id = tableId(t);
    t.markdownRenderer.markWrittenInPlace = vi.fn();
    const write = vi.fn();
    expect(t.orchestrator.writeHeldInterior(id, write)).toBe(false); // not held
    expect(write).not.toHaveBeenCalled();
    t.orchestrator.holdBlock(id);
    expect(t.orchestrator.writeHeldInterior(t.idOf("End"), write)).toBe(false); // another block
    expect(t.orchestrator.writeHeldInterior(id, write)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(t.markdownRenderer.markWrittenInPlace).toHaveBeenCalledWith(expect.objectContaining({ id }), t.orchestrator.getModel().links);
  });

  it("AT-ORC-T5 while the table is held, the queued partial render keeps its DOM (keepBlockId)", async () => {
    const t = await loaded(TBL);
    const id = tableId(t);
    t.orchestrator.holdBlock(id);
    t.orchestrator.replaceTableBlock(id, t.orchestrator.planTableReplace(id, "| a |\n| --- |\n| z |"));
    await flush();
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledWith(expect.anything(), expect.anything(), id);
  });
});

describe("AT-ORC-T6 a table commit keeps the anchor an earlier commit left pending (INV-46)", () => {
  it("the paragraph commit's anchor (retargeted to the table) is restored by the render after the table commit", async () => {
    const t = await loaded("Intro\n\n| a |\n| --- |\n| 1 |\n\nEnd\n");
    const id = t.orchestrator.getModel().getBlocks().find((b) => b.type === "table").id;
    t.orchestrator.commitBlock(t.idOf("Intro"), "Intro changed");
    t.orchestrator.retargetPendingAnchor(id);
    t.orchestrator.replaceTableBlock(id, t.orchestrator.planTableReplace(id, "| a |\n| --- |\n| 2 |"));
    await flush();
    expect(t.calls).toContain(`restore:el${id}`);
  });
});

describe("AT-ORC-R keepReadingPosition (5.1, PRT-X08, INV-46)", () => {
  function withReading(t) {
    const order = [];
    t.scrollManager.captureReadingAnchor = vi.fn(() => {
      order.push("capture");
      return { element: "place", anchor: { offsetTop: 5 } };
    });
    t.scrollManager.restoreReadingAnchor = vi.fn(() => order.push("restore"));
    t.scrollManager.capturePlaceAt = vi.fn((top) => ({ element: `place@${top}`, anchor: { offsetTop: top } }));
    t.scrollManager.movedBy = vi.fn(() => -22);
    return order;
  }

  it("AT-ORC-R1 outside the markdown view the change only runs", () => {
    const t = setup();
    const order = withReading(t);
    const change = vi.fn();
    t.orchestrator.keepReadingPosition(change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(order).toEqual([]);
  });

  it("AT-ORC-R2 in the markdown view: the place is taken before the change and put back after it", async () => {
    const t = await loaded();
    const order = withReading(t);
    t.orchestrator.keepReadingPosition(() => order.push("change"));
    expect(order).toEqual(["capture", "change", "restore"]);
    expect(t.scrollManager.capturePlaceAt).not.toHaveBeenCalled();
  });

  it("AT-ORC-R3 a commit's anchor still to be rendered follows its place, so the render does not move the text back", async () => {
    const t = await loaded();
    withReading(t);
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const measured = t.scrollManager.captureAnchor.mock.results[0].value.offsetTop;
    t.orchestrator.keepReadingPosition(() => {});
    expect(t.scrollManager.capturePlaceAt).toHaveBeenCalledWith(measured);
    await flush();
    const restored = t.scrollManager.restoreAnchor.mock.calls.at(-1)[0];
    expect(restored).toEqual({ offsetTop: measured - 22 });
  });

  it("AT-ORC-R4 the anchor's place is taken before the change; a place that did not move leaves the anchor alone", async () => {
    const t = await loaded();
    withReading(t);
    const order = [];
    t.scrollManager.capturePlaceAt.mockImplementation((top) => {
      order.push("place");
      return { element: "p", anchor: { offsetTop: top } };
    });
    t.scrollManager.movedBy.mockImplementation(() => {
      order.push("moved");
      return 0;
    });
    t.scrollManager.restoreReadingAnchor.mockImplementation(() => order.push("restore"));
    t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const measured = t.scrollManager.captureAnchor.mock.results[0].value;
    t.orchestrator.keepReadingPosition(() => order.push("change"));
    // the anchor's move is read after the reading place is put back (both are on screen)
    expect(order).toEqual(["place", "change", "restore", "moved"]);
    await flush();
    expect(t.scrollManager.restoreAnchor.mock.calls.at(-1)[0]).toBe(measured);
  });

  it("AT-ORC-R5 during a render in progress its anchor follows too, and an anchor shared with the pending one moves once", async () => {
    const t = await loaded("A\n\nB\n\nC\n\nD\n");
    withReading(t);
    const gate = deferred();
    t.mermaidRenderer.render.mockImplementationOnce(() => gate.promise);
    const p1 = t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await flush();
    // the first render waits; a second commit is pending; the opened block is the anchor of both
    t.orchestrator.commitBlock(t.idOf("C"), "C2");
    const opened = t.idOf("D");
    t.orchestrator.retargetPendingAnchor(opened);
    const measured = t.scrollManager.captureAnchor.mock.results.at(-1).value.offsetTop;
    t.orchestrator.keepReadingPosition(() => {});
    expect(t.scrollManager.capturePlaceAt).toHaveBeenCalledTimes(1);
    gate.resolve();
    await p1;
    await flush();
    const restores = t.scrollManager.restoreAnchor.mock.calls.filter((c) => c[1] === t.elements.get(opened));
    expect(restores.length).toBeGreaterThan(0);
    for (const [anchor] of restores) expect(anchor).toEqual({ offsetTop: measured - 22 });
  });

  it("AT-ORC-R6 a commit's caret line (INV-84) stays when leaving edit mode moves its anchor", async () => {
    const t = await loaded();
    withReading(t);
    const placeOfLine = vi.spyOn(BlockCaretMap, "placeOfLine").mockReturnValue({ count: 1, afterSpace: false });
    const lineOffsetOf = vi.spyOn(BlockCaretMap, "lineOffsetOf").mockReturnValue(7);
    try {
      t.orchestrator.commitBlock(t.idOf("B"), "B2", { offsetTop: 100, line: { offset: 30, sourceOffset: 1 } });
      t.orchestrator.keepReadingPosition(() => {});
      await flush();
      // the block's top moved with the place (-22); the caret line, 30 px
      // below it in the editor, is 7 px below it in the rendered block
      expect(t.scrollManager.restoreAnchor.mock.calls.at(-1)[0]).toEqual({ offsetTop: 100 - 22 + 30 - 7 });
      // the place is found once for the rendered block, then reused
      expect(placeOfLine).toHaveBeenCalledTimes(1);
    } finally {
      placeOfLine.mockRestore();
      lineOffsetOf.mockRestore();
    }
  });
});

describe("RendererOrchestrator.insertBlock (INV-52, request 1)", () => {
  beforeEach(() => {
    vi.mocked(waitForDOMStability).mockResolvedValue(true);
  });

  it("AT-ORC-25 insertBlock at an offset is one change of its own: Undo takes only the block away", async () => {
    const t = await loaded("Line one\nLine two\n\nZ\n");
    await t.orchestrator.commitBlock(t.idOf("Line one\nLine two"), "Line ONE\nLine two");
    const committed = t.orchestrator.getBody();
    const { rendering, blockId } = t.orchestrator.insertBlock("T", { offset: 8 });
    expect(t.orchestrator.getBody()).toBe("Line ONE\n\nT\n\nLine two\n\nZ\n"); // synchronous (INV-47)
    await rendering;
    const inserted = t.orchestrator.getModel().getBlocks().find((b) => b.raw.startsWith("T"));
    expect(blockId).toBe(inserted.id);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe(committed);
    expect(t.orchestrator.canUndo()).toBe(true); // the commit before is its own unit
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("Line one\nLine two\n\nZ\n");
  });

  it("AT-ORC-26 insertBlock with a scroll anchor: the block at anchorOffset keeps its place (INV-46)", async () => {
    const t = await loaded("Line one\nLine two\n\nZ\n");
    const scroll = { offsetTop: 42 };
    const { rendering } = t.orchestrator.insertBlock("T", { offset: 8, scroll, anchorOffset: 0, removeBefore: 0 });
    await rendering;
    const upper = t.orchestrator.getModel().getBlocks()[0];
    expect(upper.raw).toBe("Line one");
    const restores = t.scrollManager.restoreAnchor.mock.calls.filter((c) => c[1] === t.elements.get(upper.id));
    expect(restores.length).toBeGreaterThan(0);
    for (const [anchor] of restores) expect(anchor).toBe(scroll);
  });

  it("AT-ORC-27 insertBlock after a block is insertAfter, and tells the new block's id", async () => {
    const t = await loaded();
    const { rendering, blockId } = t.orchestrator.insertBlock("T", { afterBlockId: t.idOf("A") });
    await rendering;
    expect(t.orchestrator.getBody()).toBe("A\n\nT\n\nB\n\nC\n");
    expect(t.orchestrator.getModel().getBlocks()[1].id).toBe(blockId);
    const none = setup().orchestrator.insertBlock("T", { afterBlockId: null });
    expect(none.blockId).toBeNull();
  });
});

describe("RendererOrchestrator.deleteBlocks / blocksSource (INV-74, INV-48)", () => {
  beforeEach(() => {
    vi.mocked(waitForDOMStability).mockResolvedValue(true);
  });

  it("AT-RNG-09 deletes a range as one unit: one undo brings all back, one redo takes them again", async () => {
    const t = await loaded("A\n\nB\n\nC\n\nD\n");
    const p = t.orchestrator.deleteBlocks(t.idOf("B"), t.idOf("C"));
    expect(t.orchestrator.getBody()).toBe("A\n\nD\n"); // synchronous (INV-47)
    expect(t.listener.onModelChanged).toHaveBeenCalledTimes(1);
    await p;
    expect(t.markdownRenderer.replaceBlocks).toHaveBeenCalledTimes(1);
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n\nD\n");
    expect(t.orchestrator.canUndo()).toBe(false);
    await t.orchestrator.redoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A\n\nD\n");
  });

  it("AT-RNG-10 the block after the range takes the place of the first block gone (INV-46)", async () => {
    const t = await loaded("A\n\nB\n\nC\n\nD\n");
    const b = t.idOf("B");
    const d = t.idOf("D");
    await t.orchestrator.deleteBlocks(b, t.idOf("C"));
    expect(t.calls).toContain(`capture:el${b}`);
    expect(t.calls).toContain(`restore:el${d}`);
  });

  it("AT-RNG-11 ids no longer in the model change nothing and record no unit", async () => {
    const t = await loaded("A\n\nB\n");
    await t.orchestrator.deleteBlocks(999, t.idOf("B"));
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n");
    expect(t.orchestrator.canUndo()).toBe(false);
    expect(t.listener.onModelChanged).not.toHaveBeenCalled();
    expect(t.orchestrator.readBlocksSource(999, 999)).toBeNull();
  });

  it("AT-RNG-12 readBlocksSource gives the raws in order with the blank lines between; the model does not change", async () => {
    const t = await loaded("A\n\nB\n\n\nC\n");
    expect(t.orchestrator.readBlocksSource(t.idOf("A"), t.idOf("C"))).toBe("A\n\nB\n\n\nC");
    expect(t.orchestrator.canUndo()).toBe(false);
    expect(t.listener.onModelChanged).not.toHaveBeenCalled();
  });

  it("AT-RNG-13 a new delete empties the redo record (INV-48)", async () => {
    const t = await loaded("A\n\nB\n\nC\n");
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.canRedo()).toBe(true);
    await t.orchestrator.deleteBlocks(t.idOf("C"), t.idOf("C"));
    expect(t.orchestrator.canRedo()).toBe(false);
  });
});
