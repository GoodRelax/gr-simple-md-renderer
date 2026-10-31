import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { fakeEditServices, withEditMethods } from "./helpers/uiMocks.js";

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
      isPreRenderState: vi.fn().mockReturnValue(true),
      reRender: vi.fn().mockResolvedValue(undefined),
      reloadCodeView: vi.fn().mockResolvedValue(mockMetadata),
      renderAll: vi.fn().mockResolvedValue(undefined),
      loadMarkdown: vi.fn().mockResolvedValue(undefined),
      renderCodeView: vi.fn().mockResolvedValue(mockMetadata),
      readMarkdownFile: vi.fn().mockResolvedValue(null),
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
    return new UIController(withEditMethods(mockOrchestrator), mockState, mockElements, mockScrollEngine, fakeEditServices());
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

  it("AT-UI-74 routes .md files to loadMarkdown (INV-17, INV-18 (3))", async () => {
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

  it("AT-UI-74 applies preprocessInput to .md file content on D&D (INV-17)", async () => {
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

  it("AT-UI-74 routes .py files to renderCodeView (INV-18 (3))", async () => {
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

  it("AT-UI-74 rejects a file of no listed type (.png) with the notAllowed alert (INV-18; D29: no black list)", async () => {
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
        expect.stringContaining("only known text file types"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("AT-UI-74 rejects an unknown text extension (.xyz) too: no look at its bytes (INV-18, owner ruling AQ1)", async () => {
    createController();

    // File with only ASCII content (no null bytes)
    const { event } = createDropEvent("data.xyz");

    alertSpy.mockClear();
    mockOrchestrator.renderCodeView.mockClear();

    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("only known text file types"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("AT-UI-74 rejects a listed type (.txt) whose text holds U+0000 as binary (INV-18, owner ruling AQ11)", async () => {
    createController();

    // File containing a null byte
    const content = new Uint8Array([0x48, 0x65, 0x6c, 0x00, 0x6f]);
    const file = new File([content], "data.txt", { type: "application/octet-stream" });
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
        expect.stringContaining("only open text files"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("AT-UI-74 rejects files exceeding 5 MB with alert (INV-11)", async () => {
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
        expect.stringContaining("too big"),
      );
    });
    expect(mockOrchestrator.renderCodeView).not.toHaveBeenCalled();
  });

  it("AT-UI-74 accepts Dockerfile (extensionless file matched by name) (INV-18)", async () => {
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

  describe("AT-UI-63 a file that cannot be read is told, not left as an unhandled rejection (release test N4)", () => {
    it("a code view file whose reading fails: the read error, and back to the initial state", async () => {
      const controller = createController();
      const { event } = createDropEvent("script.py");
      mockOrchestrator.renderCodeView.mockRejectedValue(new DOMException("could not be read", "NotReadableError"));
      const setView = vi.spyOn(controller, "setViewMode");
      alertSpy.mockClear();
      document.dispatchEvent(event);
      await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Couldn't read this file."));
      expect(mockOrchestrator.clear).toHaveBeenCalled();
      expect(setView).toHaveBeenLastCalledWith("initial");
      expect(setView).not.toHaveBeenCalledWith("code", expect.anything());
    });

    it("a drop whose file handle cannot be had goes on without one", async () => {
      // a browser whose drops give handles (jsdom gives none)
      vi.resetModules();
      vi.doMock("../js/config.js", async () => ({ ...(await vi.importActual("../js/config.js")), FILE_SYSTEM_HANDLE_SUPPORTED: true }));
      onTestFinished(() => vi.doUnmock("../js/config.js"));
      UIController = (await import("../js/classes/UIController.js")).default;
      createController();
      const file = new File(["print(1)"], "script.py", { type: "text/plain" });
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { files: [file], items: [{ getAsFileSystemHandle: () => Promise.reject(new DOMException("no", "NotAllowedError")) }] },
      });
      mockOrchestrator.renderCodeView.mockClear();
      alertSpy.mockClear();
      document.dispatchEvent(event);
      await vi.waitFor(() => expect(mockOrchestrator.renderCodeView).toHaveBeenCalled());
      expect(mockOrchestrator.renderCodeView.mock.calls[0][1]).toBe(null);
    });

    it("a .md drop whose handle is refused at once: no unhandled rejection while the file is read (review L1)", async () => {
      vi.resetModules();
      vi.doMock("../js/config.js", async () => ({ ...(await vi.importActual("../js/config.js")), FILE_SYSTEM_HANDLE_SUPPORTED: true }));
      onTestFinished(() => vi.doUnmock("../js/config.js"));
      UIController = (await import("../js/classes/UIController.js")).default;
      createController();
      const unhandled = [];
      const onUnhandled = (reason) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      onTestFinished(() => process.off("unhandledRejection", onUnhandled));
      // reads that end in later tasks, as a browser's do (jsdom's end in microtasks)
      const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 5));
      const file = { name: "doc.md", size: 7, lastModified: 1000, slice: () => ({ arrayBuffer: () => later(new ArrayBuffer(0)) }), text: () => later("# Hello") };
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { files: [file], items: [{ getAsFileSystemHandle: () => Promise.reject(new DOMException("no", "NotAllowedError")) }] },
      });
      mockOrchestrator.loadMarkdown.mockClear();
      document.dispatchEvent(event);
      await vi.waitFor(() => expect(mockOrchestrator.loadMarkdown).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    });

    it("the code view's reload whose reading fails: the reload toast", async () => {
      const { showToast } = await import("../js/utils.js");
      const controller = createController();
      mockOrchestrator.isPreRenderState.mockReturnValue(false);
      mockOrchestrator.isCodeViewActive.mockReturnValue(true);
      mockOrchestrator.reloadCodeView.mockRejectedValue(new DOMException("gone", "NotFoundError"));
      showToast.mockClear();
      await expect(controller.handleReload()).resolves.toBeUndefined();
      expect(showToast).toHaveBeenCalledWith("Couldn't reload the file.", expect.any(Number));
    });
  });
});
