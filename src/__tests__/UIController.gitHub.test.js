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
import GitHubFileRef from "../js/classes/GitHubFileRef.js";
import GitHubLink from "../js/classes/GitHubLink.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

// AT-GH-11 a GitHub document through UIController (SC-28): the INV-94 (3)
// order of opening (read first, refuse while saving, ask when unsaved,
// replace), the INV-97 Reload (a document changed after the read is not
// replaced) and the INV-98 drop (keep the link, stop it, or cancel).

const M = CONFIG.messages.edit;
const G = CONFIG.github;
const TOAST_MS = CONFIG.codeView.toastDurationMs;
const REF = new GitHubFileRef("GoodRelax", "sample", "main", "docs/sample.md");
const LF = String.fromCharCode(10);
const GITHUB_TEXT = `# From GitHub${LF}${LF}body${LF}`;

let app;
let confirmSpy;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  showToast.mockClear();
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * @param {string} text
 * @returns {{link: GitHubLink, text: string, hasBom: boolean}} what GitHubContentsClient.openFile returns
 */
function opened(text = GITHUB_TEXT) {
  const link = new GitHubLink({ ref: REF, blobSha: "b1", fileText: text, isPrivate: false, lastCommit: null });
  return { link, text, hasBom: false };
}

/**
 * The app with a GitHub document open, and a stand-in GitHubController.
 * @param {"keep"|"stop"|"cancel"} [dropChoice]
 * @returns {Promise<{host: object, gitHub: object}>}
 */
async function withGitHubDocument(dropChoice = "keep") {
  app = await setupApp({ fileAccess: fakeFileAccess({}) });
  const gitHub = { enabled: true, refresh: vi.fn(), handleKey: vi.fn(), reloadDialog: vi.fn(), askDropChoice: vi.fn(async () => dropChoice) };
  app.ui.gitHub = gitHub;
  const host = app.ui._gitHubHost();
  await host.openDocument(opened());
  await settle();
  showToast.mockClear();
  return { host, gitHub };
}

describe("AT-GH-11 opening a GitHub document (INV-94 (3))", () => {
  it("replaces the document, keeps the GitHub link and shows the Opened toast", async () => {
    const { host } = await withGitHubDocument();
    expect(app.ui.documents.gitHub.ref).toBe(REF);
    expect(app.orchestrator.getBody()).toBe(GITHUB_TEXT);
    await host.openDocument(opened(`# Again${LF}`));
    expect(showToast).toHaveBeenCalledWith(G.messages.opened(REF.label()), TOAST_MS);
  });

  it("is refused while a save runs (INV-54): nothing changes", async () => {
    const { host } = await withGitHubDocument();
    const body = app.orchestrator.getBody();
    app.ui.documents._saveOperationState = "writingFile"; // white box: a save in flight
    await host.openDocument(opened(`# Other${LF}`));
    expect(showToast).toHaveBeenCalledWith(M.savingInProgress, TOAST_MS);
    expect(app.orchestrator.getBody()).toBe(body);
    app.ui.documents._saveOperationState = "idle";
  });

  it("asks when the document is unsaved; No keeps it", async () => {
    const { host } = await withGitHubDocument();
    app.ui.documents.openFile(`# Local${LF}`, false, 1, "local.md", null); // a document whose body differs
    await app.ui._showSessionBody("light");
    app.elements.editor.value += `typed${LF}`;
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    confirmSpy.mockReturnValue(false);
    const body = app.orchestrator.getBody();
    await host.openDocument(opened(`# Other${LF}`));
    expect(confirmSpy).toHaveBeenCalled();
    expect(app.orchestrator.getBody()).toBe(body);
  });

  it("over an unsaved code document (SC-27): asks first; OK closes the code document and opens the GitHub file", async () => {
    app = await setupApp({ fileAccess: fakeFileAccess({}), codeDialog: { askOpen: vi.fn(async () => null), askSaveEncoding: vi.fn(async () => null) } });
    app.ui.gitHub = { enabled: true, refresh: vi.fn(), handleKey: vi.fn(), reloadDialog: vi.fn(), askDropChoice: vi.fn() };
    const host = app.ui._gitHubHost();
    document.dispatchEvent(dropEvent(new File([`a${LF}`], "a.py", { lastModified: 1000 }), null));
    await settle();
    app.codeEdit.updateText(`b${LF}`);
    const bodyView = () => [...document.body.classList].find((c) => c.startsWith("view-"));
    confirmSpy.mockReturnValue(false);
    await host.openDocument(opened());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect([bodyView(), app.codeEdit.currentText()]).toEqual(["view-code", `b${LF}`]);
    confirmSpy.mockReturnValue(true);
    // the code document is closed before the GitHub file replaces the
    // document, not only later when the view turns to markdown (3.2)
    const close = vi.spyOn(app.codeEdit, "close");
    const openGitHub = vi.spyOn(app.ui.documents, "openGitHub");
    await host.openDocument(opened());
    await settle();
    expect(close).toHaveBeenCalled();
    expect(openGitHub).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(openGitHub.mock.invocationCallOrder[0]);
    expect([bodyView(), app.codeEdit.hasDocument(), app.ui.documents.gitHub?.ref]).toEqual(["view-markdown", false, REF]);
    expect(app.orchestrator.getBody()).toBe(GITHUB_TEXT);
    expect(app.ui._isDocumentDirty()).toBe(false);
  });
});

describe("AT-GH-11 Reload of a GitHub document (INV-97)", () => {
  it("replaces the document with what was read", async () => {
    const { host } = await withGitHubDocument();
    const id = app.ui.documents.session.documentId;
    await host.reloadDocument(opened(`# Reloaded${LF}`), id);
    expect(app.orchestrator.getBody()).toBe(`# Reloaded${LF}`);
    expect(showToast).toHaveBeenCalledWith(G.messages.reloaded, TOAST_MS);
  });

  it("does not replace a document that changed after the read started", async () => {
    const { host } = await withGitHubDocument();
    const id = app.ui.documents.session.documentId;
    await host.openDocument(opened(`# Newer${LF}`)); // another document now
    showToast.mockClear();
    await host.reloadDocument(opened(`# Stale read${LF}`), id);
    expect(showToast).toHaveBeenCalledWith(M.reloadCanceled, TOAST_MS);
    expect(app.orchestrator.getBody()).toBe(`# Newer${LF}`);
  });
});

describe("AT-GH-11 a .md dropped on a GitHub document (INV-98)", () => {
  /**
   * @param {string} text
   */
  async function drop(text) {
    const handle = fakeFileHandle({ name: "draft.md", content: [text] });
    document.dispatchEvent(dropEvent(new File([text], "draft.md", { lastModified: 2000 }), handle));
    await settle();
  }

  it("keep: the body becomes the dropped file and the GitHub link stays", async () => {
    const { gitHub } = await withGitHubDocument("keep");
    const link = app.ui.documents.gitHub;
    await drop(`# Draft${LF}`);
    expect(gitHub.askDropChoice).toHaveBeenCalledWith(expect.objectContaining({ fileName: "draft.md" }));
    expect(app.orchestrator.getBody()).toBe(`# Draft${LF}`);
    expect(app.ui.documents.gitHub).toBe(link);
    expect(app.ui.documents.location.fileName).toBe("draft.md");
  });

  it("stop: the dropped file opens and the link is dropped", async () => {
    await withGitHubDocument("stop");
    await drop(`# Draft${LF}`);
    expect(app.orchestrator.getBody()).toBe(`# Draft${LF}`);
    expect(app.ui.documents.gitHub).toBeNull();
  });

  it("cancel: nothing changes", async () => {
    await withGitHubDocument("cancel");
    const link = app.ui.documents.gitHub;
    await drop(`# Draft${LF}`);
    expect(app.orchestrator.getBody()).toBe(GITHUB_TEXT);
    expect(app.ui.documents.gitHub).toBe(link);
  });
});

describe("AT-HID-15 INV-101 (3): a GitHub file opened or reloaded tells its hidden characters (owner ruling AQ19)", () => {
  const ZWSP = String.fromCharCode(0x200b);
  const HIDDEN_TEXT = `# Hid${ZWSP}den${LF}${LF}a${ZWSP}b${LF}`;
  const toasts = () => showToast.mock.calls.map((call) => call[0]);

  it("open: the Opened toast, then the hidden characters toast below it", async () => {
    const { host } = await withGitHubDocument();
    await host.openDocument(opened(HIDDEN_TEXT));
    expect(toasts()).toEqual([G.messages.opened(REF.label()), CONFIG.messages.hiddenChars.found(2)]);
  });

  it("Reload: the Reloaded toast, then the hidden characters toast", async () => {
    const { host } = await withGitHubDocument();
    const id = app.ui.documents.session.documentId;
    await host.reloadDocument(opened(HIDDEN_TEXT), id);
    expect(toasts()).toEqual([G.messages.reloaded, CONFIG.messages.hiddenChars.found(2)]);
  });

  it("a file without hidden characters: only the GitHub toast", async () => {
    const { host } = await withGitHubDocument();
    await host.openDocument(opened(`# Plain${LF}`));
    const id = app.ui.documents.session.documentId;
    await host.reloadDocument(opened(`# Plain again${LF}`), id);
    expect(toasts()).toEqual([G.messages.opened(REF.label()), G.messages.reloaded]);
  });
});
