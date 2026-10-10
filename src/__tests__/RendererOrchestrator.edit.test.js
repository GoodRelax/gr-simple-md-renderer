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
import ApplicationState from "../js/classes/ApplicationState.js";
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

  it("AT-ORC-09 only the last commit is kept for undo (OS-18)", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("A"), "A2");
    await t.orchestrator.commitBlock(t.idOf("C"), "C2");
    await t.orchestrator.undoLastCommit();
    expect(t.orchestrator.getBody()).toBe("A2\n\nB\n\nC\n");
    expect(t.orchestrator.canUndo()).toBe(false);
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
    expect(t.orchestrator.getBody()).toBe("A\n\nB\n\nC\n\nE");
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
    expect(t.plantumlRenderer.render).toHaveBeenCalledWith("dark", t.preview, "consent");
    expect(t.scrollManager.save).toHaveBeenCalled();
    expect(t.scrollManager.restore).toHaveBeenCalled();
    expect(t.orchestrator.canUndo()).toBe(false);
  });

  it("AT-ORC-20 a partial render draws diagrams only in the replaced blocks, PlantUML as placeholder", async () => {
    const t = await loaded();
    await t.orchestrator.commitBlock(t.idOf("B"), "B2");
    const replaced = t.markdownRenderer.replaceBlocks.mock.results[0].value;
    expect(t.mermaidRenderer.render).toHaveBeenCalledWith("light", replaced);
    expect(t.plantumlRenderer.render).toHaveBeenCalledWith("light", replaced, "placeholder");
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
