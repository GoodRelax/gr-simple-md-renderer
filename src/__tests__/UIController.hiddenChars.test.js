import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    applySystemTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../js/config.js", async () => ({
  ...(await vi.importActual("../js/config.js")),
  FILE_SYSTEM_HANDLE_SUPPORTED: true,
}));
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { showToast } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";
import { keydown } from "./helpers/editDom.js";

// INV-101 (3)(6), spec 5.21.3: the toast at open. It comes once per
// opening and per Reload (the file read from disk again), after the
// document shows; not on an edit, [Render], a refused Reload or a Cancel
// of the open dialog or of the unsaved question.

const ZWSP = "\u200b";
const RLO = "\u202e";
const tags = (ascii) => String.fromCodePoint(...[...ascii].map((c) => 0xe0000 + c.charCodeAt(0)));
const HIDDEN_MD = `# Title\n\nA${ZWSP}B and ${tags("hi")}.\n\nx${RLO}y\n`; // 3 places
const found = (n) => CONFIG.messages.hiddenChars.found(n);
const toasts = () => showToast.mock.calls.map((c) => c[0]);

let app;
let access;
let dialog;

beforeEach(() => {
  showToast.mockClear();
  dialog = { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start() {
  access = fakeFileAccess();
  app = await setupApp({ fileAccess: access, codeDialog: dialog, codeEditor: true });
  return app;
}

async function drop(content, name, handle = null) {
  document.dispatchEvent(dropEvent(new File([content], name, { lastModified: 1000 }), handle));
  await settle();
}

function paste(text) {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  e.clipboardData = { getData: () => text };
  document.dispatchEvent(e);
}

describe("AT-HID-08 INV-101 (3): the toast at open, once; not on an edit or [Render]", () => {
  it("a dropped .md: one toast with the number of places, after the preview is drawn; an edit gives none", async () => {
    await start();
    let shownWhenToasted = null;
    showToast.mockImplementation(() => {
      shownWhenToasted = app.preview.querySelectorAll("span.grsmd-hidden-mark").length;
    });
    const handle = fakeFileHandle({ name: "doc.md", content: [HIDDEN_MD], calls: access.calls });
    await drop(HIDDEN_MD, "doc.md", handle);
    expect(toasts()).toEqual([found(3)]);
    expect(shownWhenToasted).toBe(3); // the document is drawn first
    showToast.mockClear();
    showToast.mockImplementation(() => {});
    const id = app.block((b) => b.raw.startsWith("x")).block.id;
    await app.orchestrator.commitBlock(id, `x${RLO}y${ZWSP}z`);
    await settle();
    expect(toasts()).toEqual([]);
  });

  it("a document with no hidden character, or only emoji and a flag: no toast", async () => {
    await start();
    await drop("# Plain\n\nText.\n", "plain.md");
    const england = `\u{1F3F4}${tags("gbeng")}\u{E007F}`;
    await drop(`Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467} and ${england}.\n`, "emoji.md");
    expect(toasts()).toEqual([]);
    await drop(`Family \u{1F468}\u200d\u200d\u{1F469}.\n`, "two-zwj.md"); // not an emoji's joiner
    expect(toasts()).toEqual([found(1)]);
  });

  it("a code file: one toast after the code view shows", async () => {
    await start();
    let viewWhenToasted = null;
    showToast.mockImplementation(() => {
      viewWhenToasted = app.orchestrator.isCodeViewActive() && app.preview.querySelector("#codeViewBody") !== null;
    });
    await drop(`const a = 1;${ZWSP}\n// x${RLO}y\n`, "a.js");
    expect(toasts()).toEqual([found(2)]);
    expect(viewWhenToasted).toBe(true);
  });

  it("a paste that starts a document gives the toast; [Render] of text typed into #editor does not", async () => {
    await start();
    paste(HIDDEN_MD);
    await settle();
    expect(toasts()).toEqual([found(3)]);
    app.ui.doClear();
    showToast.mockClear();
    app.elements.editor.value = HIDDEN_MD;
    await app.ui.handleRender("light");
    await settle();
    expect(app.preview.querySelectorAll("span.grsmd-hidden-mark")).toHaveLength(3);
    expect(toasts()).toEqual([]);
  });

  it("the early input (INV-81 (4)): a paste and a drop give the toast", async () => {
    await start();
    await app.ui.receiveEarlyInput({ kind: "paste", text: HIDDEN_MD });
    await settle();
    expect(toasts()).toEqual([found(3)]);
    showToast.mockClear();
    await app.ui.receiveEarlyInput({ kind: "drop", file: new File([`a${ZWSP}b\n`], "b.txt"), handlePromise: null });
    await settle();
    expect(toasts()).toEqual([found(1)]);
  });

  it("AT-HID-08 INV-101 (3): another document opened while the first is drawn: the first gives no toast", async () => {
    await start();
    const loadMarkdown = app.orchestrator.loadMarkdown.bind(app.orchestrator);
    let release;
    const held = new Promise((resolve) => (release = resolve));
    // the first drawing ends only when released
    vi.spyOn(app.orchestrator, "loadMarkdown").mockImplementationOnce((...args) => loadMarkdown(...args).then((r) => held.then(() => r)));
    document.dispatchEvent(dropEvent(new File([HIDDEN_MD], "hidden.md", { lastModified: 1000 })));
    await settle();
    expect(app.orchestrator.loadMarkdown).toHaveBeenCalledTimes(1);
    await drop("# Plain\n", "plain.md");
    release();
    await settle();
    expect(app.preview.querySelector("h1").textContent).toBe("Plain");
    expect(toasts()).not.toContain(found(3));
  });

  it("U+FEFF at the start of a pasted text is not counted; one further on is", async () => {
    await start();
    paste(`\ufeff# T\n\nplain\n`);
    await settle();
    expect(app.orchestrator.getBody().charCodeAt(0)).toBe(0xfeff);
    expect(toasts()).toEqual([]);
    app.ui.doClear();
    paste(`\ufeff# T\n\npl\ufeffain\n`);
    await settle();
    expect(toasts()).toEqual([found(1)]);
  });
});

describe("AT-HID-10 INV-101 (6): the open dialog and the unsaved question come first; a Cancel gives no toast", () => {
  const MIXED = `a${ZWSP}\r\nb\nc\n`; // mixed line endings: the open dialog asks

  it("the dialog is answered before the toast, which comes after the code view shows", async () => {
    await start();
    const order = [];
    dialog.askOpen.mockImplementation(async () => {
      order.push(`dialog, toasts so far: ${showToast.mock.calls.length}`);
      return { encoding: "utf-8", lineEndingMode: "\n" };
    });
    showToast.mockImplementation((message) => order.push(message));
    await drop(MIXED, "mixed.txt");
    expect(order).toEqual(["dialog, toasts so far: 0", found(1)]);
  });

  it("Cancel in the open dialog: no toast, nothing changes", async () => {
    await start();
    await drop("# Kept\n", "kept.md");
    await drop(MIXED, "mixed.txt"); // askOpen answers null (Cancel)
    expect(dialog.askOpen).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual([]);
    expect(app.preview.querySelector("h1").textContent).toBe("Kept");
    dialog.askOpen.mockResolvedValue({ encoding: "utf-8", lineEndingMode: "\n" });
    await drop(MIXED, "mixed.txt"); // the same file, opened this time
    expect(toasts()).toEqual([found(1)]);
  });

  it("Cancel of the unsaved question (INV-21): no toast, the document stays", async () => {
    await start();
    await drop("# Kept\n\nText.\n", "kept.md");
    keydown(document.body, "e"); // the palette: edit mode
    const id = app.block((b) => b.raw.startsWith("Text")).block.id;
    await app.orchestrator.commitBlock(id, "Changed.");
    await settle();
    window.confirm.mockReturnValue(false);
    await drop(HIDDEN_MD, "hidden.md");
    expect(window.confirm).toHaveBeenCalled();
    expect(toasts()).toEqual([]);
    expect(app.preview.querySelector("h1").textContent).toBe("Kept");
    window.confirm.mockReturnValue(true);
    await drop(HIDDEN_MD, "hidden.md"); // OK this time
    expect(toasts()).toEqual([found(3)]);
  });
});

describe("AT-HID-14 INV-101 (3), INV-21 Reload: Reload tells the hidden characters as an opening does; a refused Reload does not", () => {
  it("Markdown view: one toast after the preview is drawn again, with the number in the file read now", async () => {
    await start();
    const handle = fakeFileHandle({ name: "doc.md", content: [HIDDEN_MD], calls: access.calls });
    await drop(HIDDEN_MD, "doc.md", handle);
    showToast.mockClear();
    let shownWhenToasted = null;
    showToast.mockImplementation(() => {
      shownWhenToasted = app.preview.querySelectorAll("span.grsmd-hidden-mark").length;
    });
    handle.state.content = [`${HIDDEN_MD}\nmore${ZWSP}\n`];
    await app.ui.handleReload();
    await settle();
    expect(toasts()).toEqual([found(4)]);
    expect(shownWhenToasted).toBe(4); // the document is drawn first
    showToast.mockClear();
    handle.state.content = ["# Plain\n"];
    await app.ui.handleReload();
    await settle();
    expect(toasts()).toEqual([]); // nothing hidden: no toast
  });

  it("code view: one toast after the code view shows the file read now", async () => {
    await start();
    const handle = fakeFileHandle({ name: "a.js", content: ["let a = 1;\n"], calls: access.calls });
    await drop("let a = 1;\n", "a.js", handle);
    app.sourceFileRenderer.reload.mockImplementation(async (theme, isCurrent, readText = (file) => file.text()) => {
      await readText(await handle.getFile());
      return { fileName: "a.js", fileSize: 1, lineCount: 2, language: "javascript", updatedAtStr: "y" };
    });
    showToast.mockClear();
    const order = [];
    const setViewMode = app.ui.setViewMode.bind(app.ui);
    vi.spyOn(app.ui, "setViewMode").mockImplementation((...args) => {
      order.push(`view ${args[0]}`);
      return setViewMode(...args);
    });
    showToast.mockImplementation((message) => order.push(message));
    handle.state.content = [`let a = 1;${ZWSP}\n// x${RLO}y\n`];
    await app.ui.handleReload();
    await settle();
    expect(order).toEqual(["view code", found(2)]);
  });

  it("a Reload refused by the open checks (U+0000): the alert only, no toast", async () => {
    await start();
    const handle = fakeFileHandle({ name: "doc.md", content: ["# Doc\n"], calls: access.calls });
    await drop("# Doc\n", "doc.md", handle);
    showToast.mockClear();
    handle.state.content = [`${HIDDEN_MD}\u0000\n`];
    await app.ui.handleReload();
    await settle();
    expect(window.alert).toHaveBeenCalledWith(CONFIG.fileDrop.messages.binaryFile);
    expect(toasts()).toEqual([]);
  });
});
