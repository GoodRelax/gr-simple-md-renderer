import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("UIController.showKeyHint dismiss on scroll (FS-16 fix)", () => {
  let UIController;
  let mockOrchestrator;
  let mockScrollEngine;
  let mockElements;

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

  it("dismisses keyHint on preview scroll (PC)", () => {
    const ctrl = createController();
    ctrl.showKeyHint("markdown");

    expect(mockElements.keyHint.style.opacity).toBe("1");

    mockElements.preview.dispatchEvent(new Event("scroll"));

    expect(mockElements.keyHint.style.opacity).toBe("0");
  });

  it("dismisses keyHint on touchmove (touch device)", () => {
    const ctrl = createController();
    ctrl.showKeyHint("markdown");

    expect(mockElements.keyHint.style.opacity).toBe("1");

    document.dispatchEvent(new Event("touchmove", { bubbles: true }));

    expect(mockElements.keyHint.style.opacity).toBe("0");
  });

  it("dismisses keyHint on document click", () => {
    const ctrl = createController();
    ctrl.showKeyHint("markdown");

    expect(mockElements.keyHint.style.opacity).toBe("1");

    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(mockElements.keyHint.style.opacity).toBe("0");
  });

  it("dismisses keyHint on keydown", () => {
    const ctrl = createController();
    ctrl.showKeyHint("markdown");

    expect(mockElements.keyHint.style.opacity).toBe("1");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(mockElements.keyHint.style.opacity).toBe("0");
  });

  it("cleans up all listeners after dismiss via touchmove", () => {
    const ctrl = createController();
    const previewRemove = vi.spyOn(mockElements.preview, "removeEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");

    ctrl.showKeyHint("code");
    document.dispatchEvent(new Event("touchmove", { bubbles: true }));

    // After dismiss, _clearKeyHintDismiss should have removed all listeners
    expect(previewRemove).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
    );
    expect(docRemove).toHaveBeenCalledWith(
      "touchmove",
      expect.any(Function),
    );
  });

  it("no double-fire: preview scroll then touchmove is harmless", () => {
    const ctrl = createController();
    ctrl.showKeyHint("markdown");

    mockElements.preview.dispatchEvent(new Event("scroll"));
    expect(mockElements.keyHint.style.opacity).toBe("0");

    // Second scroll should not throw or cause issues
    document.dispatchEvent(new Event("touchmove", { bubbles: true }));
    expect(mockElements.keyHint.style.opacity).toBe("0");
  });
});
