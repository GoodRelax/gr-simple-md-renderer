import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("UIController.setupKeyboard (modifier guard)", () => {
  let UIController;
  let mockOrchestrator;
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

    mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(false),
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
    const mockElements = {
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
    const mockState = {
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

  function dispatchKey(key, modifiers = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    document.dispatchEvent(event);
  }

  it("bare 'c' key triggers doClear", () => {
    const ctrl = createController();
    const clearSpy = vi.spyOn(ctrl, "doClear");
    clearSpy.mockClear();

    dispatchKey("c");

    expect(clearSpy).toHaveBeenCalled();
  });

  it("Ctrl+C does NOT trigger doClear (INV-14)", () => {
    const ctrl = createController();
    const clearSpy = vi.spyOn(ctrl, "doClear");
    clearSpy.mockClear();

    dispatchKey("c", { ctrlKey: true });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("Meta+C does NOT trigger doClear (INV-14)", () => {
    const ctrl = createController();
    const clearSpy = vi.spyOn(ctrl, "doClear");
    clearSpy.mockClear();

    dispatchKey("c", { metaKey: true });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("Alt+C does NOT trigger doClear (INV-14)", () => {
    const ctrl = createController();
    const clearSpy = vi.spyOn(ctrl, "doClear");
    clearSpy.mockClear();

    dispatchKey("c", { altKey: true });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("Ctrl+L does NOT trigger handleRender (INV-14)", () => {
    const ctrl = createController();
    const renderSpy = vi.spyOn(ctrl, "handleRender");
    renderSpy.mockClear();

    dispatchKey("l", { ctrlKey: true });

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("Ctrl+D does NOT trigger handleRender (INV-14)", () => {
    const ctrl = createController();
    const renderSpy = vi.spyOn(ctrl, "handleRender");
    renderSpy.mockClear();

    dispatchKey("d", { ctrlKey: true });

    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("bare 'r' key triggers handleReload", () => {
    const ctrl = createController();
    const reloadSpy = vi.spyOn(ctrl, "handleReload");
    reloadSpy.mockClear();

    dispatchKey("r");

    expect(reloadSpy).toHaveBeenCalled();
  });

  it("Ctrl+R does NOT trigger handleReload (INV-14)", () => {
    const ctrl = createController();
    const reloadSpy = vi.spyOn(ctrl, "handleReload");
    reloadSpy.mockClear();

    dispatchKey("r", { ctrlKey: true });

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("bare ArrowDown triggers startScroll when not in pre-render state", () => {
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    createController();
    mockScrollEngine.startScroll.mockClear();

    dispatchKey("ArrowDown");

    expect(mockScrollEngine.startScroll).toHaveBeenCalledWith(+1);
  });

  it("Ctrl+ArrowDown does NOT trigger startScroll (INV-14)", () => {
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    createController();
    mockScrollEngine.startScroll.mockClear();

    dispatchKey("ArrowDown", { ctrlKey: true });

    expect(mockScrollEngine.startScroll).not.toHaveBeenCalled();
  });
});
