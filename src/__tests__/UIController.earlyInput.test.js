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

import { setupApp, settle } from "./helpers/appStack.js";

// INV-81 (4): the last drop or paste made before the core ran is handled by
// UIController as if it came now (boot.js keeps it; main.js hands it over).

let app;

beforeEach(async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  app = await setupApp();
});

afterEach(() => {
  app?.teardown();
  vi.restoreAllMocks();
});

describe("UIController.receiveEarlyInput (INV-81 (4))", () => {
  it("AT-FAST-40 a .md file dropped early opens as a dropped file, with the handle asked for in the drop", async () => {
    const handle = { name: "early.md" };
    const file = new File(["# Early\n\nText.\n"], "early.md", { lastModified: 0 });
    await app.ui.receiveEarlyInput({ kind: "drop", file, handlePromise: Promise.resolve(handle) });
    await settle();
    expect(app.preview.querySelector("h1").textContent).toBe("Early");
    expect(app.documents.fileName()).toBe("early.md");
    expect(app.documents.reloadTarget().location.fileHandle).toBe(handle);
  });

  it("AT-FAST-41 text pasted early starts a document when the view is still initial and the editor empty", async () => {
    await app.ui.receiveEarlyInput({ kind: "paste", text: "# Pasted\n" });
    await settle();
    expect(app.preview.querySelector("h1").textContent).toBe("Pasted");
  });

  it("AT-FAST-42 an early paste is dropped when the editor has text by then", async () => {
    app.elements.editor.value = "typed";
    await app.ui.receiveEarlyInput({ kind: "paste", text: "# Pasted\n" });
    await settle();
    expect(app.preview.querySelector("h1")).toBeNull();
  });
});
