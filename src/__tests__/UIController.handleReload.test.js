import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeEditServices, withEditMethods } from "./helpers/uiMocks.js";
import { deferred } from "./helpers/fakeFs.js";

describe("AT-RLD-01 UIController.handleReload (FS-04, FS-20)", () => {
  let UIController;
  let mockOrchestrator;
  let mockState;
  let mockElements;
  let mockScrollEngine;
  let services;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("../js/utils.js", async () => ({
      ...(await vi.importActual("../js/utils.js")),
      showToast: vi.fn(),
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
    services = fakeEditServices();

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
      editBtn: document.createElement("button"),
      clearBtn: document.createElement("button"),
      helpBtn: document.createElement("button"),
      helpModal: createMockModal(),
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
    modal.innerHTML =
      '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    return new UIController(withEditMethods(mockOrchestrator), mockState, mockElements, mockScrollEngine, services);
  }

  it("does nothing when in pre-render state", async () => {
    mockOrchestrator.isPreRenderState.mockReturnValue(true);
    const ctrl = createController();

    await ctrl.handleReload();

    expect(mockOrchestrator.reloadCodeView).not.toHaveBeenCalled();
    expect(services.fileAccess.readFile).not.toHaveBeenCalled();
  });

  it("calls reloadCodeView when code view is active", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(true);
    mockState.currentTheme = "dark";
    const ctrl = createController();

    await ctrl.handleReload();

    // readText decodes with the open checks of a drop (INV-18 on Reload)
    expect(mockOrchestrator.reloadCodeView).toHaveBeenCalledWith("dark", expect.any(Function));
  });

  /** A markdown document dropped from doc.md (its session and save target). */
  function withSaveTarget(ctrl, handle) {
    ctrl.documents.openFile("", false, 0, "doc.md", handle);
  }

  it("markdown view: reads through MarkdownFileAccess.readFile, then loads the file body (wrapper split)", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    mockState.currentTheme = "light";
    const handle = { name: "doc.md" };
    services.fileAccess.readFile.mockResolvedValue({
      bytesHead: new Uint8Array([96, 96, 96]),
      text: "```markdown\n# Hello\n```",
      lastModified: 5,
    });
    const ctrl = createController();
    withSaveTarget(ctrl, handle);

    await ctrl.handleReload();

    // with the open checks by name and size before the read (INV-18 on Reload)
    expect(services.fileAccess.readFile).toHaveBeenCalledWith(handle, expect.any(Function));
    expect(mockOrchestrator.loadMarkdown).toHaveBeenCalledWith("# Hello", "light");
    expect(mockElements.editor.value).toBe("# Hello");
  });

  it("markdown view without a save target: a toast, nothing read or loaded (INV-55, Q7)", async () => {
    const { showToast } = await import("../js/utils.js");
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    const ctrl = createController();
    const setViewModeSpy = vi.spyOn(ctrl, "setViewMode");

    await ctrl.handleReload();

    expect(showToast).toHaveBeenCalled();
    expect(services.fileAccess.readFile).not.toHaveBeenCalled();
    expect(mockOrchestrator.loadMarkdown).not.toHaveBeenCalled();
    expect(setViewModeSpy).not.toHaveBeenCalled();
  });

  it("markdown view without a save target: the toast is shown synchronously, before any await (as before the split)", async () => {
    const { showToast } = await import("../js/utils.js");
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    const ctrl = createController();

    const reloading = ctrl.handleReload();

    expect(showToast).toHaveBeenCalledTimes(1);
    await reloading;
  });

  it("markdown view: a read failure is told in the first microtask after the read rejects (one step, as before the split)", async () => {
    const { showToast } = await import("../js/utils.js");
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    const gate = deferred();
    services.fileAccess.readFile.mockReturnValue(gate.promise);
    const ctrl = createController();
    withSaveTarget(ctrl, { name: "doc.md" });

    const reloading = ctrl.handleReload();
    gate.reject(new Error("NotReadableError"));
    await Promise.resolve();

    expect(showToast).toHaveBeenCalledTimes(1);
    await reloading;
  });

  it("markdown view: a read failure loads nothing", async () => {
    mockOrchestrator.isCodeViewActive.mockReturnValue(false);
    mockOrchestrator.isPreRenderState.mockReturnValue(false);
    services.fileAccess.readFile.mockRejectedValue(new Error("NotReadableError"));
    const ctrl = createController();
    withSaveTarget(ctrl, { name: "doc.md" });

    await ctrl.handleReload();

    expect(mockOrchestrator.loadMarkdown).not.toHaveBeenCalled();
  });
});
