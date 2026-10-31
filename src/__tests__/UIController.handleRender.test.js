import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeEditServices, withEditMethods } from "./helpers/uiMocks.js";

describe("UIController.handleRender", () => {
  let UIController;
  let mockOrchestrator;
  let mockState;
  let mockElements;
  let mockScrollEngine;

  beforeEach(async () => {
    vi.resetModules();

    // Mock utils.js
    vi.doMock("../js/utils.js", async () => ({
      ...(await vi.importActual("../js/utils.js")),
      showToast: vi.fn(),
      applyTheme: vi.fn(),
      applySystemTheme: vi.fn(),
      systemTheme: vi.fn().mockReturnValue("light"),
    }));

    // Mock ModalController
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
      readMarkdownFile: vi.fn().mockResolvedValue(null),
      renderAll: vi.fn().mockResolvedValue(undefined),
      loadMarkdown: vi.fn().mockResolvedValue(undefined),
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
      editBtn: document.createElement("button"),
      clearBtn: document.createElement("button"),
      helpBtn: document.createElement("button"),
      helpModal: createMockModal(),
      githubHelpModal: createMockModal(),
      guideModal: createMockModal(),
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
    modal.innerHTML = '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    return new UIController(withEditMethods(mockOrchestrator), mockState, mockElements, mockScrollEngine, fakeEditServices());
  }

  it("applies CSS-only theme toggle when code view is active (no DOM rebuild)", async () => {
    const { applyTheme } = await import("../js/utils.js");
    mockOrchestrator.isCodeViewActive.mockReturnValue(true);
    const ctrl = createController();
    applyTheme.mockClear();

    await ctrl.handleRender("dark");

    expect(applyTheme).toHaveBeenCalledWith("dark");
    expect(mockState.setTheme).toHaveBeenCalledWith("dark");
    expect(mockOrchestrator.reloadCodeView).not.toHaveBeenCalled();
    expect(mockOrchestrator.reRender).not.toHaveBeenCalled();
  });

  it("calls reRender when markdown view is active (not pre-render, not code)", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockElements.editor.value = "# Hello World";

    const ctrl = createController();
    await ctrl.handleRender("light");

    expect(mockState.setMarkdownText).toHaveBeenCalledWith("# Hello World");
    expect(mockOrchestrator.reRender).toHaveBeenCalledWith("light");
  });

  it("does nothing when in pre-render state with empty editor", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    mockElements.editor.value = "";

    const ctrl = createController();
    await ctrl.handleRender("dark");

    expect(mockOrchestrator.reRender).not.toHaveBeenCalled();
    expect(mockOrchestrator.reloadCodeView).not.toHaveBeenCalled();
    expect(mockOrchestrator.loadMarkdown).not.toHaveBeenCalled();
  });

  it("calls loadMarkdown when in pre-render state with editor content", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    mockElements.editor.value = "# Hello";

    const ctrl = createController();
    await ctrl.handleRender("light");

    expect(mockOrchestrator.loadMarkdown).toHaveBeenCalledWith("# Hello", "light");
    expect(mockOrchestrator.reRender).not.toHaveBeenCalled();
  });

  it("does NOT call applyTheme directly (LOD compliance)", async () => {
    const { applyTheme } = await import("../js/utils.js");
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockElements.editor.value = "test";

    const ctrl = createController();
    // Clear any calls from constructor
    applyTheme.mockClear();

    await ctrl.handleRender("dark");

    // applyTheme should NOT be called directly by handleRender
    // It should be delegated to orchestrator.reRender
    expect(applyTheme).not.toHaveBeenCalled();
  });

  it("markdown view: the wrapper is NOT stripped, only line endings are normalized (ruling T33)", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockElements.editor.value = "```markdown\r\n# Hello\r\n```";

    const ctrl = createController();
    await ctrl.handleRender("light");

    expect(mockState.setMarkdownText).toHaveBeenCalledWith("```markdown\n# Hello\n```");
  });

  it("initial state: line endings are normalized, then the wrapper is stripped (AT-UI-46 comparison)", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    mockElements.editor.value = "```markdown\r\n# Hello\r\n```";

    const ctrl = createController();
    await ctrl.handleRender("light");

    expect(mockOrchestrator.loadMarkdown).toHaveBeenCalledWith("# Hello", "light");
    expect(mockElements.editor.value).toBe("# Hello");
  });
});
