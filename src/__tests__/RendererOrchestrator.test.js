import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils.js to avoid DOM side-effects during import
vi.mock("../js/utils.js", () => ({
  applyTheme: vi.fn(),
  waitForDOMStability: vi.fn().mockResolvedValue(true),
}));

import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import { applyTheme, waitForDOMStability } from "../js/utils.js";

function createOrchestrator() {
  const state = new ApplicationState();
  const markdownRenderer = { render: vi.fn().mockResolvedValue(undefined) };
  const mermaidRenderer = { render: vi.fn().mockResolvedValue(undefined) };
  const plantumlRenderer = { render: vi.fn().mockResolvedValue(undefined) };
  const scrollManager = { save: vi.fn().mockReturnValue(0), restore: vi.fn() };
  const preview = document.createElement("div");
  const sourceFileRenderer = {
    render: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
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
      expect(markdownRenderer.render).toHaveBeenCalledWith("# Hello");
    });

    it("calls renderAll which invokes all three renderers", async () => {
      const { orchestrator, state, markdownRenderer, mermaidRenderer, plantumlRenderer } =
        createOrchestrator();

      state.markdownText = "test";
      orchestrator._viewState = "markdown";

      await orchestrator.reRender("light");

      expect(markdownRenderer.render).toHaveBeenCalledOnce();
      expect(mermaidRenderer.render).toHaveBeenCalledOnce();
      expect(plantumlRenderer.render).toHaveBeenCalledOnce();
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
});
