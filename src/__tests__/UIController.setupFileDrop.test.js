import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Each UIController constructor adds document-level event listeners (drop, dragover,
 * paste, keydown, keyup). jsdom does not isolate these between tests, so listeners
 * accumulate. To work around this, we track controllers and only create one per test,
 * and clear spies right before dispatching to ignore stale calls from prior listeners.
 */
describe("UIController.setupFileDrop", () => {
  let UIController;
  let mockOrchestrator;
  let mockState;
  let mockElements;
  let mockScrollEngine;
  let alertSpy;

  beforeEach(async () => {
    vi.resetModules();

    // Mock utils.js
    vi.doMock("../js/utils.js", () => ({
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
      loadedAtStr: "2024-01-01 12:00:00",
    };

    mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(true),
      reRender: vi.fn().mockResolvedValue(undefined),
      reloadCodeView: vi.fn().mockResolvedValue(mockMetadata),
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

    alertSpy = vi.spyOn(globalThis, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockModal() {
    const modal = document.createElement("div");
    modal.innerHTML = '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    return new UIController(mockOrchestrator, mockState, mockElements, mockScrollEngine);
  }

  function createDropEvent(fileName, fileSize = 100) {
    const file = new File(["x".repeat(fileSize)], fileName, { type: "text/plain" });

    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();

    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [file],
        items: [
          {
            getAsFileSystemHandle: undefined,
          },
        ],
      },
    });

    return { event, file };
  }

  it("routes .md files to loadMarkdown", async () => {
    createController();

    const file = new File(["# Hello"], "test.md", { type: "text/markdown" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [file],
        items: [{}],
      },
    });

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockOrchestrator.loadMarkdown).toHaveBeenCalled();
    });
  });

  it("applies preprocessInput to .md file content on D&D (INV-17)", async () => {
    createController();

    const mdContent = "```markdown\n# Hello\n```";
    const file = new File([mdContent], "test.md", { type: "text/markdown" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file], items: [{}] },
    });

    mockOrchestrator.loadMarkdown.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockOrchestrator.loadMarkdown).toHaveBeenCalled();
    });
    // preprocessInput should strip the markdown fence
    const calledWith = mockOrchestrator.loadMarkdown.mock.calls.find(
      (call) => call[0] === "# Hello",
    );
    expect(calledWith).toBeDefined();
  });

  it("routes .py files to renderCodeView", async () => {
    createController();

    const { event } = createDropEvent("script.py");

    // Clear spies to ignore calls from stale listeners
    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockOrchestrator.renderCodeView).toHaveBeenCalled();
    });
  });

  it("rejects known binary extension (.png) with alert", async () => {
    createController();

    const file = new File(["fakecontent"], "image.png", { type: "image/png" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file], items: [{}] },
    });

    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("Binary file"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("accepts unknown text extension (.xyz) via null byte check", async () => {
    createController();

    // File with only ASCII content (no null bytes)
    const { event } = createDropEvent("data.xyz");

    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockOrchestrator.renderCodeView).toHaveBeenCalled();
    });
  });

  it("rejects unknown extension with null bytes as binary", async () => {
    createController();

    // File containing a null byte
    const content = new Uint8Array([0x48, 0x65, 0x6c, 0x00, 0x6f]);
    const file = new File([content], "data.xyz", { type: "application/octet-stream" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file], items: [{}] },
    });

    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("Binary file"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("rejects files exceeding 5 MB with alert", async () => {
    createController();

    const bigSize = 6 * 1024 * 1024;
    const file = new File(["x"], "big.py", { type: "text/plain" });
    Object.defineProperty(file, "size", { value: bigSize });

    const event = new Event("drop", { bubbles: true, cancelable: true });
    event.preventDefault = vi.fn();
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [file],
        items: [{}],
      },
    });

    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("too large"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("accepts Dockerfile (extensionless file matched by name)", async () => {
    createController();

    const { event } = createDropEvent("Dockerfile");

    // Clear all spies right before dispatch to ignore stale listener calls
    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockOrchestrator.renderCodeView).toHaveBeenCalled();
    });

    // Check that THIS test's controller did not alert
    // (alertSpy may have been called by stale listeners from prior tests;
    // we cleared it before dispatch, so only this test's calls remain)
    const unsupportedCalls = alertSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("Unsupported"),
    );
    expect(unsupportedCalls).toHaveLength(0);
  });
});
