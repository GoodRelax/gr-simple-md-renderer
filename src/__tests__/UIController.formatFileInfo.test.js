import { describe, it, expect, vi, beforeEach } from "vitest";

describe("UIController._formatFileInfo", () => {
  let UIController;

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
  });

  function createMockModal() {
    const modal = document.createElement("div");
    modal.innerHTML =
      '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    const mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(true),
      reRender: vi.fn(),
      reloadCodeView: vi.fn(),
      readMarkdownFile: vi.fn(),
      loadMarkdown: vi.fn(),
      renderCodeView: vi.fn(),
      clear: vi.fn(),
    };
    const mockState = {
      setTheme: vi.fn(),
      setMarkdownText: vi.fn(),
    };
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
    const mockScrollEngine = {
      startScroll: vi.fn(),
      stopScroll: vi.fn(),
      destroy: vi.fn(),
    };
    return new UIController(
      mockOrchestrator,
      mockState,
      mockElements,
      mockScrollEngine,
    );
  }

  it("returns empty string when metadata is null", () => {
    const ctrl = createController();
    expect(ctrl._formatFileInfo(null)).toBe("");
  });

  it("returns empty string when metadata is undefined", () => {
    const ctrl = createController();
    expect(ctrl._formatFileInfo(undefined)).toBe("");
  });

  it("formats two-line output with comma-separated line count", () => {
    const ctrl = createController();
    const result = ctrl._formatFileInfo({
      fileName: "dummy_small.c",
      fileSize: 551813,
      lineCount: 27243,
      updatedAtStr: "2026-03-04 15:54:20",
    });
    expect(result).toBe(
      "dummy_small.c  |  27,243 lines  |  538.88 KB\nUpdated: 2026-03-04 15:54:20",
    );
  });

  it("does not include language field in output", () => {
    const ctrl = createController();
    const result = ctrl._formatFileInfo({
      fileName: "test.py",
      fileSize: 1024,
      lineCount: 10,
      language: "python",
      updatedAtStr: "2026-01-01 00:00:00",
    });
    expect(result).not.toContain("python");
    expect(result).not.toContain("Loaded");
  });

  it("uses 'Updated:' label instead of 'Loaded:'", () => {
    const ctrl = createController();
    const result = ctrl._formatFileInfo({
      fileName: "a.js",
      fileSize: 512,
      lineCount: 5,
      updatedAtStr: "2026-03-05 10:00:00",
    });
    expect(result).toContain("Updated: 2026-03-05 10:00:00");
    expect(result).not.toContain("Loaded");
  });

  it("formats small line count without comma", () => {
    const ctrl = createController();
    const result = ctrl._formatFileInfo({
      fileName: "small.txt",
      fileSize: 100,
      lineCount: 42,
      updatedAtStr: "2026-01-01 00:00:00",
    });
    expect(result).toContain("42 lines");
  });

  it("formats file size in KB with two decimal places", () => {
    const ctrl = createController();
    const result = ctrl._formatFileInfo({
      fileName: "test.c",
      fileSize: 1536,
      lineCount: 10,
      updatedAtStr: "2026-01-01 00:00:00",
    });
    expect(result).toContain("1.50 KB");
  });
});
