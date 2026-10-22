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
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// INV-69, the palette's Paste link / Remove link (5.15.5): the clipboard is
// read only when the button is pressed (navigator.clipboard, a fake here),
// in the button's pointerup; while it is read, the target (block or cell,
// selection, edit generation) must not change, else nothing changes and a
// toast tells (INV-69).

const M = CONFIG.messages.edit;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const DOC = "# Title\n\nSee the example here.\n\nA [link](https://old.example/) here.\n\n| A | B |\n|---|---|\n| one | two |\n";

let app;
afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => showToast.mockClear());

/** A clipboard whose read() waits until release() (or answers at once). */
function fakeClipboard(plain, html = null, { wait = false, refuse = false } = {}) {
  let release;
  const gate = wait ? new Promise((resolve) => (release = resolve)) : Promise.resolve();
  const types = { "text/plain": plain, ...(html === null ? {} : { "text/html": html }) };
  const clipboard = {
    read: vi.fn(async () => {
      await gate;
      if (refuse) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return [{ types: Object.keys(types), getType: async (t) => ({ text: async () => types[t] }) }];
    }),
    readText: vi.fn(),
  };
  clipboard.release = () => release?.();
  return clipboard;
}

async function withDocument(clipboard) {
  const access = fakeFileAccess();
  app = await setupApp({ fileAccess: access, clipboard });
  const handle = fakeFileHandle({ name: "doc.md", content: [DOC], calls: access.calls });
  document.dispatchEvent(dropEvent(new File([DOC], "doc.md", { lastModified: 1000 }), handle));
  await settle();
  keydown(document.body, "e");
  return app;
}

const btn = (id) => app.paletteRoot().querySelector(`#${id}`);
const off = (el) => el.getAttribute("aria-disabled") === "true";
const popoverButton = (label) => document.body.querySelector(`:scope > div.edit-palette-popover button[aria-label="${label}"]`);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function press(el) {
  pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
}

/** Open the paragraph starting with start and select part of it. */
async function openAndSelect(start, part) {
  tap(app.block((b) => b.raw.startsWith(start)).el.firstElementChild);
  const ta = app.blockEditor();
  const at = ta.value.indexOf(part);
  ta.setSelectionRange(at, at + part.length);
  document.dispatchEvent(new Event("selectionchange"));
  await nextFrame();
  return ta;
}

/** Press Format, then Paste link from clipboard. */
function pressPasteLink() {
  press(btn("paletteFormat"));
  press(popoverButton("Paste link from clipboard"));
}

describe("AT-UI-48 Paste link / Remove link button states (5.15.5, INV-51)", () => {
  /** Open the Format popover (the link buttons' states are worked out when it opens). */
  const openFormat = () => press(btn("paletteFormat"));

  it("not editing: both off; a caret in text: Paste on, Remove off; on a link: Remove on", async () => {
    await withDocument(fakeClipboard("https://example.com/"));
    expect(off(popoverButton("Paste link from clipboard"))).toBe(true);
    expect(off(popoverButton("Remove link"))).toBe(true);
    const ta = await openAndSelect("See", "");
    openFormat();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(false);
    expect(off(popoverButton("Remove link"))).toBe(true);
    pointer(document.body, "pointerdown");
    await openAndSelect("A [link]", "link");
    openFormat();
    expect(off(popoverButton("Remove link"))).toBe(false);
    expect(ta).not.toBe(app.blockEditor());
  });

  it("owner ruling F-R1: a caret before a heading's # (on the marks of the line) or in a link: Paste off", async () => {
    await withDocument(fakeClipboard("https://example.com/"));
    const ta = await openAndSelect("# Title", "");
    ta.setSelectionRange(0, 0);
    openFormat();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(true);
    ta.setSelectionRange(3, 3);
    document.dispatchEvent(new Event("selectionchange"));
    await nextFrame();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(false);
    pointer(document.body, "pointerdown");
    const tb = await openAndSelect("A [link]", "");
    tb.setSelectionRange(4, 4); // in the link's text
    openFormat();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(true);
  });

  it("the popover closed: the link states are not worked out (the inline range is not lexed per frame)", async () => {
    await withDocument(fakeClipboard("https://example.com/"));
    const ta = await openAndSelect("A [link]", "link");
    const canRemove = vi.spyOn(app.ui.blockEdit, "canRemoveLink");
    const canPaste = vi.spyOn(app.ui.blockEdit, "canPasteLink");
    ta.setSelectionRange(3, 4);
    document.dispatchEvent(new Event("selectionchange"));
    await nextFrame();
    expect(canRemove).not.toHaveBeenCalled();
    expect(canPaste).not.toHaveBeenCalled();
    openFormat();
    expect(canRemove).toHaveBeenCalled();
    expect(off(popoverButton("Remove link"))).toBe(false);
  });

  it("in a cell: Paste on; Remove off with no link", async () => {
    await withDocument(fakeClipboard("https://example.com/"));
    const td = app.block((b) => b.type === "table").el.querySelector(":scope > table").rows[1].cells[0];
    tap(td);
    const range = document.createRange();
    range.setStart(td.firstChild, 1);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    openFormat();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(false);
    expect(off(popoverButton("Remove link"))).toBe(true);
  });
});

describe("AT-UI-49 Paste link reads the clipboard when pressed (INV-69)", () => {
  it("the read starts inside the press (user activation); the selection becomes the link", async () => {
    const clipboard = fakeClipboard("https://example.com/");
    await withDocument(clipboard);
    const ta = await openAndSelect("See", "example");
    expect(clipboard.read).not.toHaveBeenCalled();
    pressPasteLink();
    expect(clipboard.read).toHaveBeenCalledTimes(1);
    await settle();
    expect(ta.value).toBe("See the [example](https://example.com/) here.");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("no selection: a link goes in at the caret with the clipboard's link text, selected", async () => {
    await withDocument(fakeClipboard("https://example.com/", '<a href="https://example.com/">Example site</a>'));
    const ta = await openAndSelect("See", "");
    ta.setSelectionRange(0, 0);
    pressPasteLink();
    await settle();
    expect(ta.value).toBe("[Example site](https://example.com/)See the example here.");
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("Example site");
  });

  it("not a URL, or the read refused: nothing changes, the noUrlInClipboard toast", async () => {
    for (const clipboard of [fakeClipboard("just words"), fakeClipboard("https://example.com/", null, { refuse: true })]) {
      await withDocument(clipboard);
      const ta = await openAndSelect("See", "example");
      pressPasteLink();
      await settle();
      expect(ta.value).toBe("See the example here.");
      expect(showToast).toHaveBeenCalledWith(M.noUrlInClipboard, TOAST_MS);
      app.teardown();
      app = null;
      showToast.mockClear();
    }
  });

  it("no navigator.clipboard: the noUrlInClipboard toast", async () => {
    await withDocument(null);
    await openAndSelect("See", "example");
    pressPasteLink();
    await settle();
    expect(showToast).toHaveBeenCalledWith(M.noUrlInClipboard, TOAST_MS);
  });

  it("Remove link takes the link at the caret off (a selection: AT-BEC-35)", async () => {
    await withDocument(fakeClipboard("x"));
    const ta = await openAndSelect("A [link]", "");
    ta.setSelectionRange(5, 5); // the caret in "link"
    press(btn("paletteFormat"));
    press(popoverButton("Remove link"));
    expect(ta.value).toBe("A link here.");
  });

  it("owner ruling F-R2: a URL that cannot be put there: nothing changes, the linkNotPastable toast", async () => {
    await withDocument(fakeClipboard("https://example.com/"));
    const ta = await openAndSelect("See", "example");
    vi.spyOn(app.ui.blockEdit, "pasteLink").mockReturnValue(false);
    pressPasteLink();
    await settle();
    expect(ta.value).toBe("See the example here.");
    expect(showToast).toHaveBeenCalledWith(M.linkNotPastable, TOAST_MS);
  });
});

describe("AT-UI-50 the wait for the clipboard (INV-69): a changed target changes nothing", () => {
  /** Press Paste link with a waiting clipboard, change something, then let the read end. */
  async function race(change) {
    const clipboard = fakeClipboard("https://example.com/", null, { wait: true });
    await withDocument(clipboard);
    const ta = await openAndSelect("See", "example");
    pressPasteLink();
    await change(ta);
    clipboard.release();
    await settle();
    return ta;
  }

  it.each([
    ["the editor closed (outside press)", () => pointer(document.body, "pointerdown")],
    ["Esc", (ta) => keydown(ta, "Escape")],
    ["the selection changed", (ta) => ta.setSelectionRange(0, 3)],
    ["the text changed", (ta) => {
      ta.value = "See the example here!";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }],
    ["another block opened", () => tap(app.block((b) => b.raw.startsWith("A [link]")).el.firstElementChild)],
    ["Ctrl+S (the editor commits)", () => keydown(document.body, "s", { ctrlKey: true })],
  ])("%s: nothing is linked, the linkTargetChanged toast", async (_name, change) => {
    const ta = await race(change);
    expect(app.orchestrator.getBody()).not.toContain("[example](");
    expect(ta.value).not.toContain("[example](");
    expect(app.blockEditor()?.value ?? "").not.toContain("[example](");
    expect(showToast).toHaveBeenCalledWith(M.linkTargetChanged, TOAST_MS);
  });

  it("the same target when the read ends: the link goes on", async () => {
    const ta = await race(async () => {
      await nextFrame();
    });
    expect(ta.value).toBe("See the [example](https://example.com/) here.");
    expect(showToast).not.toHaveBeenCalled();
  });

  describe("a cell", () => {
    const table = () => app.block((b) => b.type === "table").el.querySelector(":scope > table");
    /** Open cell (1, 0), select "one", press Paste link, change something, let the read end. */
    async function raceInCell(change) {
      const clipboard = fakeClipboard("https://example.com/", null, { wait: true });
      await withDocument(clipboard);
      const td = table().rows[1].cells[0];
      tap(td);
      const range = document.createRange();
      range.setStart(td.firstChild, 0);
      range.setEnd(td.firstChild, 3);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      pressPasteLink();
      await change(td);
      clipboard.release();
      await settle();
    }

    it.each([
      ["another cell opened (Tab)", (td) => keydown(td, "Tab")],
      ["an outside press", () => pointer(document.body, "pointerdown")],
      ["Esc", (td) => keydown(td, "Escape")],
      ["the selection changed", (td) => {
        const range = document.createRange();
        range.setStart(td.firstChild, 0);
        range.setEnd(td.firstChild, 1);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      }],
      ["the text changed", (td) => {
        td.firstChild.data = "one!";
        td.dispatchEvent(new Event("input", { bubbles: true }));
      }],
    ])("%s: nothing is linked, the linkTargetChanged toast", async (_name, change) => {
      await raceInCell(change);
      expect(table().querySelector("a")).toBeNull();
      expect(app.orchestrator.getBody()).not.toContain("](https://example.com/)");
      expect(showToast).toHaveBeenCalledWith(M.linkTargetChanged, TOAST_MS);
    });

    it("the same target when the read ends: the cell's text becomes the link", async () => {
      await raceInCell(async () => {
        await nextFrame();
      });
      expect(table().rows[1].cells[0].querySelector("a")?.textContent).toBe("one");
      expect(showToast).not.toHaveBeenCalled();
    });
  });
});

describe("AT-UI-64 one read of the clipboard at a time (review FX-1)", () => {
  it("while a read waits, Paste link is off and a second press reads nothing; the link goes in once, with no toast", async () => {
    const clipboard = fakeClipboard("https://u.example/", null, { wait: true });
    await withDocument(clipboard);
    const ta = await openAndSelect("See", "example");
    pressPasteLink();
    expect(clipboard.read).toHaveBeenCalledTimes(1);
    press(btn("paletteFormat")); // open the popover again while the read waits
    expect(off(popoverButton("Paste link from clipboard"))).toBe(true);
    app.ui._runPaletteCommand("linkPaste"); // a press that gets through anyway
    expect(clipboard.read).toHaveBeenCalledTimes(1);
    clipboard.release();
    await settle();
    expect(ta.value).toBe("See the [example](https://u.example/) here.");
    expect(showToast).not.toHaveBeenCalled();
    await nextFrame();
    expect(off(popoverButton("Paste link from clipboard"))).toBe(false);
  });
});
