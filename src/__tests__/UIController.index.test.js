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

import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { keydown } from "./helpers/editDom.js";

// INV-77 (4), (5), 5.11: the Index's key, Esc order and availability, as
// UIController wires them (owner rulings T4, T7, T8, 2026-10-25).

let app;

async function withFile(name, text) {
  document.dispatchEvent(dropEvent(new File([text], name, { lastModified: 1000 }), null));
  await settle();
}

beforeEach(async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  app = await setupApp({ withIndex: true });
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AT-IDX-10 (INV-77 (4)(5), 5.11) UIController and the Index", () => {
  it("(a) INV-77 (5): off in the initial state and in the code view; on in the Markdown view", async () => {
    expect(app.indexBtn.disabled).toBe(true);
    keydown(document.body, "i");
    expect(app.index.isShown()).toBe(false);

    await withFile("doc.md", "# Title\n\n## Part\n");
    expect(app.indexBtn.disabled).toBe(false);
    keydown(document.body, "i");
    expect(app.index.isShown()).toBe(true);
    expect([...app.indexPanel.querySelectorAll(".index-entry")].map((e) => e.textContent)).toEqual(["Title", "Part"]);

    await withFile("code.py", "print(1)\n");
    expect(app.indexBtn.disabled).toBe(true);
    expect(app.index.isShown()).toBe(false);
  });

  it("(b) INV-77 (5), INV-14, INV-52: i toggles; with a modifier, in an input and while an insert is pending it does nothing", async () => {
    await withFile("doc.md", "# Title\n");
    keydown(document.body, "i");
    keydown(document.body, "i");
    expect(app.index.isShown()).toBe(false);
    keydown(document.body, "i", { ctrlKey: true });
    expect(app.index.isShown()).toBe(false);
    keydown(app.elements.editor, "i");
    expect(app.index.isShown()).toBe(false);
    vi.spyOn(app.ui.blockEdit, "isInsertPending").mockReturnValue(true);
    keydown(document.body, "i");
    expect(app.index.isShown()).toBe(false);
  });

  it("(c) INV-77 (4), 5.11: Esc closes the palette first and the Index last (owner ruling T7)", async () => {
    await withFile("doc.md", "# Title\n");
    keydown(document.body, "i");
    keydown(document.body, "e");
    expect(app.ui.palette.isShown()).toBe(true);
    keydown(document.body, "Escape");
    expect(app.ui.palette.isShown()).toBe(false);
    expect(app.index.isShown()).toBe(true);
    keydown(document.body, "Escape", { repeat: true });
    expect(app.index.isShown()).toBe(true);
    keydown(document.body, "Escape");
    expect(app.index.isShown()).toBe(false);
  });

  it("(d) INV-77 (5): Clear hides the Index and turns it off", async () => {
    await withFile("doc.md", "# Title\n");
    keydown(document.body, "i");
    app.ui.doClear();
    await settle();
    expect(app.index.isShown()).toBe(false);
    expect(app.indexBtn.disabled).toBe(true);
  });
});
