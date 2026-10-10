import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils.js to avoid DOM side-effects during import
vi.mock("../js/utils.js", () => ({
  applyTheme: vi.fn(),
  waitForDOMStability: vi.fn().mockResolvedValue(true),
}));

import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import { applyTheme, waitForDOMStability } from "../js/utils.js";
import { makeLexer } from "./helpers/samples.js";

const lexer = makeLexer();

function createOrchestrator() {
  const state = new ApplicationState();
  const markdownRenderer = {
    lex: (src) => lexer(src),
    render: vi.fn().mockResolvedValue(undefined),
    renderBlocks: vi.fn(),
    replaceBlocks: vi.fn().mockReturnValue([]),
    getBlockElement: vi.fn().mockReturnValue(null),
    resetExternalImageConsent: vi.fn(),
  };
  const mermaidRenderer = { render: vi.fn().mockResolvedValue(undefined) };
  const plantumlRenderer = { render: vi.fn().mockResolvedValue(undefined) };
  const scrollManager = { save: vi.fn().mockReturnValue(0), restore: vi.fn() };
  const preview = document.createElement("div");
  const mockMetadata = {
    fileName: "test.py",
    fileSize: 1024,
    lineCount: 42,
    language: "python",
    lastModified: Date.now(),
    updatedAtStr: "2024-01-01 12:00:00",
  };
  const sourceFileRenderer = {
    render: vi.fn().mockResolvedValue(mockMetadata),
    reload: vi.fn().mockResolvedValue(mockMetadata),
    destroy: vi.fn(),
  };

  const orchestrator = new RendererOrchestrator(
    state,
    markdownRenderer,
    mermaidRenderer,
    plantumlRenderer,
    scrollManager,
    preview,
    sourceFileRenderer,
  );

  return {
    orchestrator,
    state,
    markdownRenderer,
    mermaidRenderer,
    plantumlRenderer,
    scrollManager,
    preview,
    sourceFileRenderer,
  };
}

describe("RendererOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("state queries", () => {
    it("isPreRenderState() returns true initially", () => {
      const { orchestrator } = createOrchestrator();
      expect(orchestrator.isPreRenderState()).toBe(true);
    });

    it("isCodeViewActive() returns false initially", () => {
      const { orchestrator } = createOrchestrator();
      expect(orchestrator.isCodeViewActive()).toBe(false);
    });
  });

  describe("clear()", () => {
    it("resets _viewState to initial", async () => {
      const { orchestrator, state } = createOrchestrator();
      // Move to markdown state first
      state.markdownText = "# test";
      await orchestrator.loadMarkdown("# test", "light");
      expect(orchestrator.isPreRenderState()).toBe(false);

      orchestrator.clear();
      expect(orchestrator.isPreRenderState()).toBe(true);
      expect(orchestrator.isCodeViewActive()).toBe(false);
    });

    it("revokes external image consent", () => {
      const { orchestrator, markdownRenderer } = createOrchestrator();
      orchestrator.clear();
      expect(markdownRenderer.resetExternalImageConsent).toHaveBeenCalledOnce();
    });
  });

  describe("external image consent scope", () => {
    it("resetExternalImageConsent() revokes it (UIController calls it for a dropped .md, INV-43)", () => {
      const { orchestrator, markdownRenderer } = createOrchestrator();
      orchestrator.resetExternalImageConsent();
      expect(markdownRenderer.resetExternalImageConsent).toHaveBeenCalledOnce();
    });

    it("is kept by loadMarkdown and reRender", async () => {
      const { orchestrator, markdownRenderer } = createOrchestrator();
      await orchestrator.loadMarkdown("# a", "light");
      await orchestrator.reRender("dark");
      expect(markdownRenderer.resetExternalImageConsent).not.toHaveBeenCalled();
    });
  });

  describe("reRender(theme)", () => {
    it("calls setTheme, applyTheme, and renderAll", async () => {
      const { orchestrator, state, markdownRenderer } = createOrchestrator();

      // Set up state as if markdown was loaded
      state.markdownText = "# Hello";
      orchestrator._viewState = "markdown";

      await orchestrator.reRender("dark");

      expect(state.currentTheme).toBe("dark");
      expect(applyTheme).toHaveBeenCalledWith("dark");
      // Full renders draw by block (spec 5.14.4).
      expect(markdownRenderer.renderBlocks.mock.calls[0][0].toBody()).toBe("# Hello");
    });

    it("calls renderAll which invokes all three renderers", async () => {
      const { orchestrator, state, markdownRenderer, mermaidRenderer, plantumlRenderer } =
        createOrchestrator();

      state.markdownText = "test";
      orchestrator._viewState = "markdown";

      await orchestrator.reRender("light");

      expect(markdownRenderer.renderBlocks).toHaveBeenCalledOnce();
      expect(mermaidRenderer.render).toHaveBeenCalledOnce();
      expect(plantumlRenderer.render).toHaveBeenCalledOnce();
    });
  });

  describe("renderCodeView()", () => {
    it("returns CodeViewMeta from sourceFileRenderer.render()", async () => {
      const { orchestrator } = createOrchestrator();
      const file = new File(["test"], "test.py");
      const result = await orchestrator.renderCodeView(file, null);
      expect(result).toEqual(expect.objectContaining({ fileName: "test.py" }));
    });
  });

  describe("reloadCodeView(theme)", () => {
    it("calls sourceFileRenderer.reload(theme)", async () => {
      const { orchestrator, sourceFileRenderer } = createOrchestrator();

      orchestrator._viewState = "code";

      await orchestrator.reloadCodeView("light");

      expect(sourceFileRenderer.reload).toHaveBeenCalledWith("light");
      expect(sourceFileRenderer.reload).toHaveBeenCalledOnce();
    });

    it("returns metadata from sourceFileRenderer.reload()", async () => {
      const { orchestrator } = createOrchestrator();
      orchestrator._viewState = "code";
      const result = await orchestrator.reloadCodeView("dark");
      expect(result).toEqual(expect.objectContaining({ fileName: "test.py" }));
    });
  });

  describe("loadMarkdown()", () => {
    it("sets _viewState to markdown", async () => {
      const { orchestrator } = createOrchestrator();
      await orchestrator.loadMarkdown("# Test", "light");
      expect(orchestrator.isPreRenderState()).toBe(false);
      expect(orchestrator.isCodeViewActive()).toBe(false);
    });

    it("calls applyTheme with the given theme", async () => {
      const { orchestrator } = createOrchestrator();
      await orchestrator.loadMarkdown("# Test", "dark");
      expect(applyTheme).toHaveBeenCalledWith("dark");
    });
  });

  describe("full renders of an older generation are skipped (5.14.4)", () => {
    it("two full renders queued back to back draw once, and PlantUML asks once", async () => {
      const { orchestrator, state, markdownRenderer, plantumlRenderer } = createOrchestrator();
      orchestrator._viewState = "markdown";
      state.markdownText = "# a";
      const first = orchestrator.renderAll();
      const second = orchestrator.renderAll();
      await Promise.all([first, second]);
      expect(markdownRenderer.renderBlocks).toHaveBeenCalledTimes(1);
      expect(plantumlRenderer.render).toHaveBeenCalledTimes(1);
    });
  });

  describe("AT-ORC-24 the file handle moved to DocumentLocation (INV-55)", () => {
    it("has no _mdFileHandle and no readMarkdownFile; loadMarkdown takes (text, theme) only", () => {
      const { orchestrator } = createOrchestrator();
      expect("_mdFileHandle" in orchestrator).toBe(false);
      expect(orchestrator.readMarkdownFile).toBeUndefined();
      expect(RendererOrchestrator.prototype.loadMarkdown.length).toBe(2);
    });
  });
});
