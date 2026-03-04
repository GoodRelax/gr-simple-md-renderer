import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils.js to avoid DOM side-effects during import
vi.mock("../js/utils.js", () => ({
  applyTheme: vi.fn(),
  showToast: vi.fn(),
  waitForDOMStability: vi.fn().mockResolvedValue(true),
}));

import RendererOrchestrator from "../js/classes/RendererOrchestrator.js";
import ApplicationState from "../js/classes/ApplicationState.js";
import { applyTheme, showToast, waitForDOMStability } from "../js/utils.js";

function createOrchestrator() {
  const state = new ApplicationState();
  const markdownRenderer = { render: vi.fn().mockResolvedValue(undefined) };
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

    it("stores fileHandle for reload support", async () => {
      const { orchestrator } = createOrchestrator();
      const fakeHandle = { getFile: vi.fn() };
      await orchestrator.loadMarkdown("# Test", "light", fakeHandle);
      expect(orchestrator._mdFileHandle).toBe(fakeHandle);
    });

    it("preserves existing fileHandle when called without fileHandle arg (sentinel)", async () => {
      const { orchestrator } = createOrchestrator();
      const fakeHandle = { getFile: vi.fn() };
      await orchestrator.loadMarkdown("# First", "light", fakeHandle);
      expect(orchestrator._mdFileHandle).toBe(fakeHandle);

      // Call without fileHandle — should preserve existing handle
      await orchestrator.loadMarkdown("# Second", "dark");
      expect(orchestrator._mdFileHandle).toBe(fakeHandle);
    });

    it("clears fileHandle when null is passed explicitly", async () => {
      const { orchestrator } = createOrchestrator();
      const fakeHandle = { getFile: vi.fn() };
      await orchestrator.loadMarkdown("# First", "light", fakeHandle);

      // Pass null explicitly — should clear handle
      await orchestrator.loadMarkdown("# Second", "dark", null);
      expect(orchestrator._mdFileHandle).toBeNull();
    });
  });

  describe("readMarkdownFile()", () => {
    it("returns null and shows toast when no fileHandle", async () => {
      const { orchestrator } = createOrchestrator();
      orchestrator._viewState = "markdown";

      const result = await orchestrator.readMarkdownFile();

      expect(result).toBeNull();
      expect(showToast).toHaveBeenCalled();
    });

    it("returns raw text string when fileHandle exists (no render)", async () => {
      const { orchestrator, markdownRenderer } = createOrchestrator();
      orchestrator._viewState = "markdown";

      const fakeFile = { text: vi.fn().mockResolvedValue("# Reloaded") };
      const fakeHandle = { getFile: vi.fn().mockResolvedValue(fakeFile) };
      orchestrator._mdFileHandle = fakeHandle;

      const result = await orchestrator.readMarkdownFile();

      expect(result).toBe("# Reloaded");
      expect(fakeHandle.getFile).toHaveBeenCalled();
      expect(fakeFile.text).toHaveBeenCalled();
      // readMarkdownFile does NOT render or apply theme
      expect(applyTheme).not.toHaveBeenCalled();
      expect(markdownRenderer.render).not.toHaveBeenCalled();
    });
  });

  describe("clear() resets fileHandle", () => {
    it("resets _mdFileHandle to null", async () => {
      const { orchestrator } = createOrchestrator();
      const fakeHandle = { getFile: vi.fn() };
      await orchestrator.loadMarkdown("# Test", "light", fakeHandle);
      expect(orchestrator._mdFileHandle).toBe(fakeHandle);

      orchestrator.clear();
      expect(orchestrator._mdFileHandle).toBeNull();
    });
  });
});

// Separate describe for 2-message toast split (requires dynamic import to mock config)
describe("readMarkdownFile toast messages", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function createWithFSHSupported(supported) {
    const actualConfig = await vi.importActual("../js/config.js");

    vi.doMock("../js/utils.js", () => ({
      applyTheme: vi.fn(),
      showToast: vi.fn(),
      waitForDOMStability: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock("../js/config.js", () => ({
      CONFIG: actualConfig.CONFIG,
      FILE_SYSTEM_HANDLE_SUPPORTED: supported,
    }));

    const { default: Orch } = await import("../js/classes/RendererOrchestrator.js");
    const { showToast: toast } = await import("../js/utils.js");
    const cfg = actualConfig.CONFIG;

    const state = { setMarkdownText: vi.fn(), setTheme: vi.fn(), markdownText: "", currentTheme: "light" };
    const orch = new Orch(
      state,
      { render: vi.fn() },
      { render: vi.fn() },
      { render: vi.fn() },
      { save: vi.fn(), restore: vi.fn() },
      document.createElement("div"),
      { render: vi.fn(), reload: vi.fn(), destroy: vi.fn() },
    );
    return { orch, toast, cfg };
  }

  it("shows reloadNoFileMsg when FILE_SYSTEM_HANDLE_SUPPORTED=true and no handle", async () => {
    const { orch, toast, cfg } = await createWithFSHSupported(true);
    orch._viewState = "markdown";

    await orch.readMarkdownFile();

    expect(toast).toHaveBeenCalledWith(
      cfg.codeView.reloadNoFileMsg,
      cfg.codeView.toastDurationMs,
    );
  });

  it("shows reloadUnavailableMsg when FILE_SYSTEM_HANDLE_SUPPORTED=false and no handle", async () => {
    const { orch, toast, cfg } = await createWithFSHSupported(false);
    orch._viewState = "markdown";

    await orch.readMarkdownFile();

    expect(toast).toHaveBeenCalledWith(
      cfg.codeView.reloadUnavailableMsg,
      cfg.codeView.toastDurationMs,
    );
  });
});
