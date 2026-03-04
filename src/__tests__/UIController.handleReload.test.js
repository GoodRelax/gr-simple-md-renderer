import { describe, it, expect, vi, beforeEach } from "vitest";

describe("UIController.handleReload", () => {
  let UIController;
  let mockOrchestrator;
  let mockState;
  let mockElements;
  let mockScrollEngine;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("../js/utils.js", () => ({
      applyTheme: vi.fn(),
      applySystemTheme: vi.fn(),
      systemTheme: vi.fn().mockReturnValue("light"),
    }));

    vi.doMock("../js/classes/ModalController.js", () => ({
      default: {
        setupModal: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      },
    }));

    const mod = await import("../js/classes/UIController.js");
    UIController = mod.default;

    const mockMetadata = {
      fileName: "test.py",
      fileSize: 1024,
      lineCount: 42,
      language: "python",
      lastModified: Date.now(),
      updatedAtStr: "2024-01-01 12:00:00",
    };

    mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(false),
      reRender: vi.fn().mockResolvedValue(undefined),
      reloadCodeView: vi.fn().mockResolvedValue(mockMetadata),
      readMarkdownFile: vi.fn().mockResolvedValue("# Reloaded"),
      renderAll: vi.fn().mockResolvedValue(undefined),
      loadMarkdown: vi.fn().mockResolvedValue(undefined),
      renderCodeView: vi.fn().mockResolvedValue(mockMetadata),
      clear: vi.fn(),
    };

    mockState = {
      currentTheme: "light",
      markdownText: "",
      setTheme: vi.fn(),
      setMarkdownText: vi.fn(),
    };

    mockElements = {
      editor: document.createElement("textarea"),
      fileInfo: document.createElement("div"),
      keyHint: document.createElement("div"),
      preview: document.createElement("div"),
      renderLightBtn: document.createElement("button"),
      renderDarkBtn: document.createElement("button"),
      reloadBtn: document.createElement("button"),
      newTabBtn: document.createElement("button"),
      clearBtn: document.createElement("button"),
      helpBtn: document.createElement("button"),
      helpModal: createMockModal(),
      promptModal: createMockModal(),
      promptText: document.createElement("textarea"),
      copyPromptBtn: document.createElement("button"),
    };

    mockScrollEngine = {
      startScroll: vi.fn(),
      stopScroll: vi.fn(),
      destroy: vi.fn(),
    };
  });

  function createMockModal() {
    const modal = document.createElement("div");
    modal.innerHTML =
      '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    return new UIController(
      mockOrchestrator,
      mockState,
      mockElements,
      mockScrollEngine,
    );
  }

  it("does nothing when in pre-render state", async () => {
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    const ctrl = createController();

    await ctrl.handleReload();

    expect(mockOrchestrator.reloadCodeView).not.toHaveBeenCalled();
    expect(mockOrchestrator.readMarkdownFile).not.toHaveBeenCalled();
  });

  it("calls reloadCodeView when code view is active", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(true);
    mockState.currentTheme = "dark";
    const ctrl = createController();

    await ctrl.handleReload();

    expect(mockOrchestrator.reloadCodeView).toHaveBeenCalledWith("dark");
  });

  it("reads file, preprocesses, and calls loadMarkdown for markdown view", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockOrchestrator.readMarkdownFile.mockResolvedValue("```markdown\n# Hello\n```");
    mockState.currentTheme = "light";
    const ctrl = createController();

    await ctrl.handleReload();

    expect(mockOrchestrator.readMarkdownFile).toHaveBeenCalled();
    // preprocessInput should strip the markdown fence
    expect(mockOrchestrator.loadMarkdown).toHaveBeenCalledWith("# Hello", "light");
    // editor should be updated with preprocessed text
    expect(mockElements.editor.value).toBe("# Hello");
  });

  it("does not call loadMarkdown when readMarkdownFile returns null", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockOrchestrator.readMarkdownFile.mockResolvedValue(null);
    const ctrl = createController();
    const setViewModeSpy = vi.spyOn(ctrl, "setViewMode");

    await ctrl.handleReload();

    expect(mockOrchestrator.loadMarkdown).not.toHaveBeenCalled();
    expect(setViewModeSpy).not.toHaveBeenCalled();
  });

  it("passes raw text through preprocessInput on reload", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockOrchestrator.readMarkdownFile.mockResolvedValue("# No fence here");
    mockState.currentTheme = "dark";
    const ctrl = createController();

    await ctrl.handleReload();

    // No fence to strip, text passes through unchanged
    expect(mockOrchestrator.loadMarkdown).toHaveBeenCalledWith("# No fence here", "dark");
  });
});
