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
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import { showToast } from "../js/utils.js";
import { CONFIG } from "../js/config.js";
import DiagramZoomController from "../js/classes/DiagramZoomController.js";
import BlockCaretMap from "../js/classes/BlockCaretMap.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { pointer, keydown } from "./helpers/editDom.js";

// INV-57: a double click on the preview outside edit mode enters edit mode
// and opens what was double-clicked (11-c previewDoubleClicked). A double
// tap (touch, pen: any pointer but the mouse) does not (owner ruling AQ3):
// the browser's double-tap zoom stays; [Edit] and then a tap opens a block.

const DOC = "# Title\n\nHello [link](https://example.com/) word.\n\n| A | B |\n|---|---|\n| x | y |\n\n```mermaid\nflowchart TD\n  A --> B\n```\n";
const isPara = (b) => b.type === "paragraph";

let app;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  showToast.mockClear();
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withDocument(md = DOC) {
  app = await setupApp();
  document.dispatchEvent(dropEvent(new File([md], "doc.md", { lastModified: 1000 }), null));
  await settle();
  return app;
}

function dblclick(el, { x = 10, y = 10 } = {}) {
  const e = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  el.dispatchEvent(e);
  return e;
}

/** Select the text of el, as the browser does on a double click. */
function selectWordIn(el) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.addRange(r);
}

const mermaidBlock = () => app.block((b) => b.raw.startsWith("```mermaid")).el;

describe("AT-DBL INV-57 double click outside edit mode", () => {
  it("AT-DBL-01 a paragraph: the palette shows, that block's editor opens, the selection is cleared", async () => {
    await withDocument();
    const p = app.block(isPara).el.firstElementChild;
    selectWordIn(p.firstChild);
    dblclick(p.firstChild.parentNode);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
    expect(app.blockEditor().value).toBe("Hello [link](https://example.com/) word.");
    expect(window.getSelection().isCollapsed).toBe(true);
  });

  it("AT-DBL-02 the margin of the preview: edit mode only, no editor", async () => {
    await withDocument();
    dblclick(app.preview);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).toBeNull();
  });

  it("AT-DBL-03 a cell opens in place (INV-57, INV-62); the table's margin only enters edit mode", async () => {
    await withDocument();
    const { el } = app.block((b) => b.type === "table");
    const td = el.querySelector("td");
    dblclick(td);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).toBeNull();
    expect(app.ui.blockEdit.isEditingCell()).toBe(true);
    expect(td.classList.contains("grsmd-cell-editing")).toBe(true);
    app.ui.blockEdit.dispatch("escapePressed");
    app.ui.blockEdit.dispatch("paletteHidden");
    app.ui.palette.hide();
    dblclick(el); // the table block's margin
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.ui.blockEdit.isEditing()).toBe(false);
  });

  it("AT-DBL-14 a cell of a table not editable by cell: as a click, the table's source opens with the toast (owner ruling Q-c)", async () => {
    await withDocument("# T\n\n| A | B |\n| --- | --- |\n| a</td><td>z | y |\n");
    const { el } = app.block((b) => b.type === "table");
    const td = el.querySelector("td");
    selectWordIn(td);
    dblclick(td);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.ui.blockEdit.isEditingCell()).toBe(false);
    expect(app.blockEditor()?.value).toContain("| A | B |");
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.edit.tableNotCellEditable, CONFIG.codeView.toastDurationMs);
    expect(window.getSelection().isCollapsed).toBe(true);
  });

  it("AT-DBL-04 a diagram, a link or a button: nothing (the diagram keeps its zoom reset)", async () => {
    await withDocument();
    const container = document.createElement("div");
    container.className = "mermaid";
    container.innerHTML = "<svg></svg>";
    mermaidBlock().appendChild(container);
    dblclick(container.firstChild);
    expect(app.ui.palette.isShown()).toBe(false);
    dblclick(app.preview.querySelector("a"));
    expect(app.ui.palette.isShown()).toBe(false);
    for (const cls of ["plantuml-wrapper", "plantuml-diagram", "plantuml-pending"]) {
      const el = document.createElement("div");
      el.className = cls;
      mermaidBlock().appendChild(el);
      dblclick(el);
      expect(app.ui.palette.isShown(), cls).toBe(false);
    }
  });

  it("AT-DBL-05 an empty document: the editor of the empty block opens", async () => {
    await withDocument("");
    dblclick(app.preview);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
    expect(app.blockEditor().value).toBe("");
  });

  it("AT-DBL-06 unrendered #editor changes: no editor; #editor is rendered and the toast is shown (INV-45)", async () => {
    await withDocument();
    app.elements.editor.value = "# Typed\n";
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    dblclick(app.block(isPara).el.firstElementChild);
    await settle();
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).toBeNull();
    expect(showToast).toHaveBeenCalledWith(CONFIG.messages.edit.editorRenderedFirst, CONFIG.codeView.toastDurationMs);
    expect(app.orchestrator.getBody()).toBe("# Typed\n");
  });

  it("AT-DBL-07 in edit mode: the two clicks are start gestures; the dblclick changes nothing (no cell in 11-c)", async () => {
    await withDocument();
    keydown(document.body, "e");
    const p = app.block(isPara).el.firstElementChild;
    for (let i = 0; i < 2; i++) {
      pointer(p, "pointerdown");
      pointer(p, "pointerup");
    }
    const ta = app.blockEditor();
    expect(ta).not.toBeNull();
    const dispatch = vi.spyOn(app.ui.blockEdit, "dispatch");
    dblclick(ta);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([]); // inside the open editor: excluded (a textarea)
    dblclick(app.preview);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(["previewDoubleClicked"]);
    expect(app.blockEditor()).toBe(ta); // editingBlock has no cell for it
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it("AT-DBL-13 INV-57 (AQ3): a touch double tap followed by the browser's dblclick opens nothing", async () => {
    await withDocument();
    const p = app.block(isPara).el.firstElementChild;
    const dispatch = vi.spyOn(app.ui.blockEdit, "dispatch");
    for (let i = 0; i < 2; i++) {
      pointer(p, "pointerdown", { pointerType: "touch" });
      pointer(p, "pointerup", { pointerType: "touch" });
    }
    dblclick(p);
    expect(dispatch).not.toHaveBeenCalled();
    expect(app.blockEditor()).toBeNull();
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it("AT-DBL-11 a diagram's dblclick still resets its zoom with the UIController listener there", async () => {
    await withDocument();
    const zoom = new DiagramZoomController(app.preview);
    const reset = vi.spyOn(zoom, "resetZoom");
    const container = document.createElement("div");
    container.className = "mermaid";
    container.innerHTML = "<svg></svg>";
    mermaidBlock().appendChild(container);
    dblclick(container.firstChild);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(app.ui.palette.isShown()).toBe(false);
  });

  it("AT-DBL-12 a double click on the preview's scroll bar does nothing", async () => {
    await withDocument();
    Object.defineProperty(app.preview, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(app.preview, "clientHeight", { configurable: true, value: 200 });
    dblclick(app.preview, { x: 305, y: 50 }); // jsdom: offsetX = clientX
    expect(app.ui.palette.isShown()).toBe(false);
    dblclick(app.preview, { x: 50, y: 50 });
    expect(app.ui.palette.isShown()).toBe(true);
  });

  it.each(["touch", ""])("AT-DBL-08 INV-57 (AQ3): a '%s' double tap (and the browser's dblclick) does not enter edit mode", async (pointerType) => {
    await withDocument();
    const p = app.block(isPara).el.firstElementChild;
    for (let i = 0; i < 2; i++) {
      pointer(p, "pointerdown", { pointerType });
      pointer(p, "pointerup", { pointerType });
    }
    dblclick(p);
    expect(app.ui.palette.isShown()).toBe(false);
    expect(app.blockEditor()).toBeNull();
  });

  it("AT-DBL-18 INV-57 (AQ3, review M3): a pen double tap (and the browser's dblclick) enters edit mode and opens the block, as a mouse double click (the pen is asked of the owner)", async () => {
    await withDocument();
    const p = app.block(isPara).el.firstElementChild;
    for (let i = 0; i < 2; i++) {
      pointer(p, "pointerdown", { pointerType: "pen" });
      pointer(p, "pointerup", { pointerType: "pen" });
    }
    dblclick(p);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
    expect(app.blockEditor().value).toBe(app.block(isPara).block.raw.trimEnd());
  });

  it("AT-DBL-15 INV-57 (AQ3): a mouse double click after a touch press still opens (the last press decides)", async () => {
    await withDocument();
    const p = app.block(isPara).el.firstElementChild;
    pointer(p, "pointerdown", { pointerType: "touch" });
    pointer(p, "pointerup", { pointerType: "touch" });
    dblclick(p);
    expect(app.blockEditor()).toBeNull();
    for (let i = 0; i < 2; i++) {
      pointer(p, "pointerdown");
      pointer(p, "pointerup");
    }
    dblclick(p);
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
  });

  it("AT-DBL-16 INV-29 (AQ3): on touch, [Edit] and then a tap on a block opens that block", async () => {
    await withDocument();
    app.elements.editBtn.click();
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).toBeNull();
    const p = app.block(isPara).el.firstElementChild;
    pointer(p, "pointerdown", { pointerType: "touch" });
    pointer(p, "pointerup", { pointerType: "touch" });
    p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(app.blockEditor()).not.toBeNull();
    expect(app.blockEditor().value).toBe(app.block(isPara).block.raw.trimEnd());
  });

  /** The body text style for the paragraph (jsdom computes none), and the press's place: right after "Hello". */
  function pressedAfterHello() {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      el.tagName === "P" && app.preview.contains(el)
        ? { fontFamily: "BodySans", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "24px", letterSpacing: "normal", marginTop: "16px", marginBottom: "16px" }
        : real(el),
    );
    return vi.spyOn(BlockCaretMap, "pointAt").mockReturnValue({ count: 5, afterSpace: false, lineOffset: 0, index: 5, text: "Hello link word." });
  }

  it("AT-BEC-TS-14 a double click outside edit mode puts the caret where it was pressed (INV-84)", async () => {
    await withDocument();
    const pointAt = pressedAfterHello();
    dblclick(app.block(isPara).el.firstElementChild, { x: 31, y: 17 });
    expect(pointAt).toHaveBeenCalledWith(expect.any(Element), 31, 17);
    const ta = app.blockEditor();
    expect(ta.selectionStart).toBe(5);
    expect(ta.value.slice(0, 5)).toBe("Hello");
  });

  it("AT-DBL-09 initial state with an empty #editor still starts an empty document (INV-31)", async () => {
    app = await setupApp();
    dblclick(app.preview);
    await settle();
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
  });

  it("AT-DBL-19 INV-31 (AQ3, review M3): initial state, empty #editor: a pen double tap starts an empty document, as a mouse double click", async () => {
    app = await setupApp();
    for (let i = 0; i < 2; i++) {
      pointer(app.preview, "pointerdown", { pointerType: "pen" });
      pointer(app.preview, "pointerup", { pointerType: "pen" });
    }
    dblclick(app.preview);
    await settle();
    expect(app.ui.palette.isShown()).toBe(true);
    expect(app.blockEditor()).not.toBeNull();
    expect(app.orchestrator.isPreRenderState()).toBe(false);
  });

  it.each(["touch"])("AT-DBL-17 INV-31 (AQ3): initial state, empty #editor: a %s double tap starts no empty document", async (pointerType) => {
    app = await setupApp();
    for (let i = 0; i < 2; i++) {
      pointer(app.preview, "pointerdown", { pointerType });
      pointer(app.preview, "pointerup", { pointerType });
    }
    dblclick(app.preview);
    await settle();
    expect(app.ui.palette.isShown()).toBe(false);
    expect(app.blockEditor()).toBeNull();
    expect(app.orchestrator.isPreRenderState()).toBe(true);
  });

  it("AT-DBL-10 code view: nothing", async () => {
    app = await setupApp();
    document.dispatchEvent(dropEvent(new File(["x = 1\n"], "a.py"), null));
    await settle();
    dblclick(app.preview);
    expect(app.ui.palette.isShown()).toBe(false);
  });
});
