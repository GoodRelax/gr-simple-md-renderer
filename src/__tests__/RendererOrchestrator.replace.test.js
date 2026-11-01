import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});

import { setupEdit, flush } from "./helpers/editStack.js";

// INV-80 (5), INV-48, INV-42: a replace of Search is one change for Undo.

let s;

afterEach(() => {
  s?.teardown();
  s = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RendererOrchestrator.replaceBody (INV-80)", () => {
  it("AT-SRCH-11 the new body is one undoable change; blocks whose text did not change keep their ids; the same body changes nothing", async () => {
    const body = "# Title\n\nFirst one.\n\nSecond one.\n\nThird.\n";
    s = await setupEdit(body);
    const o = s.orchestrator;
    const idsBefore = o.getModel().getBlocks().map((b) => b.id);
    const changed = vi.fn();
    o.setModelChangedListener({ onModelChanged: changed, onBlockSplitFailed: vi.fn() });

    const replaced = body.replace(/one/g, "two");
    await o.replaceBody(replaced, body.indexOf("First"));
    await flush();
    expect(o.getBody()).toBe(replaced);
    expect(changed).toHaveBeenCalledTimes(1);
    const idsAfter = o.getModel().getBlocks().map((b) => b.id);
    expect(idsAfter[0]).toBe(idsBefore[0]); // "# Title" kept
    expect(idsAfter[3]).toBe(idsBefore[3]); // "Third." kept
    expect(idsAfter[1]).not.toBe(idsBefore[1]);
    expect(s.preview.textContent).toContain("First two.");
    expect(s.preview.textContent).toContain("Second two.");

    // one Undo takes the whole replace back, one Redo brings it again
    expect(o.canUndo()).toBe(true);
    await o.undoLastCommit();
    await flush();
    expect(o.getBody()).toBe(body);
    expect(o.canUndo()).toBe(false);
    await o.redoLastCommit();
    await flush();
    expect(o.getBody()).toBe(replaced);

    // the same body: no change, nothing recorded
    changed.mockClear();
    await o.replaceBody(replaced, 0);
    expect(changed).not.toHaveBeenCalled();
    await o.undoLastCommit();
    await flush();
    expect(o.getBody()).toBe(body); // the Undo was the replace's, not a new one
  });
});
