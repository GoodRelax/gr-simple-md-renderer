import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("FS-16: Touch paste assist via editor.focus()", () => {
  let UIController;
  let mockOrchestrator;
  let mockScrollEngine;
  let mockElements;
  let mockState;

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

    mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(true),
      reRender: vi.fn().mockResolvedValue(undefined),
      reloadCodeView: vi.fn().mockResolvedValue(undefined),
      readMarkdownFile: vi.fn().mockResolvedValue(null),
      loadMarkdown: vi.fn().mockResolvedValue(undefined),
      renderCodeView: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
    };

    mockScrollEngine = {
      startScroll: vi.fn(),
      stopScroll: vi.fn(),
      destroy: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockModal() {
    const modal = document.createElement("div");
    modal.innerHTML =
      '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
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
    document.body.appendChild(mockElements.preview);
    document.body.appendChild(mockElements.editor);
    mockState = {
      setTheme: vi.fn(),
      setMarkdownText: vi.fn(),
    };
    return new UIController(
      mockOrchestrator,
      mockState,
      mockElements,
      mockScrollEngine,
    );
  }

  it("clicking preview in pre-render state focuses editor", () => {
    createController();
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    mockElements.editor.value = "";
    const focusSpy = vi.spyOn(mockElements.editor, "focus");

    mockElements.preview.click();

    expect(focusSpy).toHaveBeenCalled();
  });

  it("clicking preview in rendered state does NOT focus editor", () => {
    createController();
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    const focusSpy = vi.spyOn(mockElements.editor, "focus");

    mockElements.preview.click();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("clicking preview with non-empty editor does NOT focus editor", () => {
    createController();
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    mockElements.editor.value = "existing content";
    const focusSpy = vi.spyOn(mockElements.editor, "focus");

    mockElements.preview.click();

    expect(focusSpy).not.toHaveBeenCalled();
  });
});
