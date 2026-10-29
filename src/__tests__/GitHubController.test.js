import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import GitHubController from "../js/classes/GitHubController.js";
import GitHubFileRef from "../js/classes/GitHubFileRef.js";
import GitHubLink from "../js/classes/GitHubLink.js";
import UIController from "../js/classes/UIController.js";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import { resolveRelativeUrl } from "../js/gitHubUrl.js";
import { Marked } from "marked";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { CONFIG } from "../js/config.js";

// AT-GH-08 GitHubController (SC-28): the token field of the three
// dialogs (owner rulings D28, D34, D35, D37) and the Pushed toast (D36).
// The dialogs come from src/index.html; no request leaves the test.

const G = CONFIG.github;
const TOKEN = "github_pat_11ABCDEF0123456789_abcdefghijklmnopqrstuvwxyz";
const REF = new GitHubFileRef("GoodRelax", "repo", "main", "docs/a.md");
const INDEX_HTML = readFileSync(resolve(__dirname, "../index.html"), "utf8");

beforeAll(() => {
  // jsdom has no modal dialogs: open and close are enough here
  const proto = window.HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    proto.close = function close() {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

/**
 * The button and the four dialogs of src/index.html.
 * @returns {object} the elements, as main.js passes them
 */
function mountDialogs() {
  const start = INDEX_HTML.indexOf('<dialog id="gitHubOpenDialog"');
  const end = INDEX_HTML.indexOf("</dialog>", INDEX_HTML.indexOf('<dialog id="gitHubDropDialog"')) + "</dialog>".length;
  document.body.innerHTML = `<button id="gitHubBtn" hidden></button>${INDEX_HTML.slice(start, end)}`;
  const byId = (id) => document.getElementById(id);
  const fields = (name, extra) => ({
    form: byId(`gitHub${name}Form`),
    token: byId(`gitHub${name}Token`),
    error: byId(`gitHub${name}Error`),
    submit: byId(`gitHub${name}Submit`),
    ...extra,
  });
  return {
    button: byId("gitHubBtn"),
    openDialog: byId("gitHubOpenDialog"),
    pushDialog: byId("gitHubPushDialog"),
    reloadDialog: byId("gitHubReloadDialog"),
    dropDialog: byId("gitHubDropDialog"),
    open: fields("Open", {
      url: byId("gitHubOpenUrl"),
      fields: byId("gitHubOpenFields"),
      repo: byId("gitHubOpenRepo"),
      branch: byId("gitHubOpenBranch"),
      path: byId("gitHubOpenPath"),
    }),
    push: fields("Push", {
      visibility: byId("gitHubPushVisibility"),
      repo: byId("gitHubPushRepo"),
      branch: byId("gitHubPushBranch"),
      path: byId("gitHubPushPath"),
      message: byId("gitHubPushMessage"),
    }),
    reload: fields("Reload", {
      repo: byId("gitHubReloadRepo"),
      target: byId("gitHubReloadTarget"),
    }),
    drop: {
      editing: byId("gitHubDropEditing"),
      lastCommit: byId("gitHubDropLastCommit"),
      dropped: byId("gitHubDropDropped"),
      notes: byId("gitHubDropNotes"),
      keep: byId("gitHubDropKeep"),
      stop: byId("gitHubDropStop"),
      cancel: byId("gitHubDropCancel"),
    },
  };
}

/**
 * A host showing a GitHub document whose body differs from the GitHub version.
 * @returns {object} GitHubHost
 */
function fakeHost() {
  const link = new GitHubLink({ ref: REF, blobSha: "a".repeat(40), fileText: "# A\n", isPrivate: false, lastCommit: null });
  const documents = {
    gitHub: link,
    isSaving: () => false,
    fileTextOf: (body) => body,
    startPush: () => ({ id: 1 }),
    finishPush: vi.fn(() => true),
    session: { documentId: 1 },
  };
  return {
    documents,
    isCodeView: () => false,
    body: () => "# A changed\n",
    hasUnsyncedEdits: () => false,
    prepareBody: () => true,
    openDocument: vi.fn(),
    reloadDocument: vi.fn(),
    refreshDirtyMark: vi.fn(),
    toast: vi.fn(),
  };
}

/**
 * @param {object} [client]
 * @param {object} [host]
 * @returns {{c: GitHubController, el: object, host: object}}
 */
function make(client = {}, host = fakeHost()) {
  const el = mountDialogs();
  const c = new GitHubController(el, client, host, { ...G, enabled: true, passwordStore: null });
  return { c, el, host };
}

describe("AT-GH-08 GitHubController: the token field", () => {
  let el;
  beforeEach(() => {
    ({ el } = make());
  });

  it("names the field as GitHub does, in all three dialogs (D35)", () => {
    for (const name of ["Open", "Push", "Reload"]) {
      const label = document.querySelector(`label[for="gitHub${name}Token"]`);
      expect(label.textContent).toBe("Fine-grained personal access token");
    }
  });

  it("has no [Saved] button (D34)", () => {
    expect(document.querySelectorAll(".gh-saved")).toHaveLength(0);
  });

  it("the eye button shows and hides the token (D28)", () => {
    const f = el.open;
    const eye = f.form.querySelector(".gh-reveal");
    expect(f.token.type).toBe("password");
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    expect(eye.getAttribute("aria-label")).toBe(G.labels.showToken);
    eye.click();
    expect(f.token.type).toBe("text");
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    expect(eye.getAttribute("aria-label")).toBe(G.labels.hideToken);
    eye.click();
    expect(f.token.type).toBe("password");
  });

  it("hides the token again when the dialog closes or opens (D28)", () => {
    const { c } = make();
    const f = document.getElementById("gitHubReloadToken");
    const eye = document.querySelector("#gitHubReloadForm .gh-reveal");
    c.reloadDialog();
    eye.click();
    expect(f.type).toBe("text");
    document.getElementById("gitHubReloadDialog").close();
    expect(f.type).toBe("password");
    c.reloadDialog();
    eye.click();
    c.reloadDialog();
    expect(f.type).toBe("password");
  });

  it("a token typed into the field clears the dialog's error (D37)", () => {
    const f = el.push;
    f.error.textContent = "Use a fine-grained personal access token.";
    f.error.hidden = false;
    f.token.value = TOKEN;
    f.token.dispatchEvent(new Event("input"));
    expect(f.error.hidden).toBe(true);
    expect(f.error.textContent).toBe("");
  });
});

describe("AT-GH-08 GitHubController: push", () => {
  it("the Pushed toast stays longer than others (D36), and the token is hidden and emptied after", async () => {
    const pushed = { status: "ok", commitSha: "1234567890abcdef", link: null };
    const { c, el, host } = make({ pushFile: vi.fn(async () => pushed) });
    c.pushDialog();
    el.push.form.querySelector(".gh-reveal").click();
    el.push.token.value = TOKEN;
    await c._submitPush();
    expect(host.toast).toHaveBeenCalledWith(G.messages.pushed("1234567"), G.pushedToastMs);
    expect(G.pushedToastMs).toBe(6000);
    expect(el.push.token.value).toBe("");
    expect(el.push.token.type).toBe("password");
  });
});

describe("AT-GH-08 the key hint lists [O] GitHub where GitHub editing is shown (D33)", () => {
  /**
   * @param {boolean} enabled - GitHub editing shown (a mouse or trackpad device)
   * @param {string} mode
   * @param {boolean} [isApple] - a Mac (the fold keys are Option+Left / Right)
   * @returns {string} the hint text
   */
  function hintText(enabled, mode, isApple = false) {
    const app = {
      elements: { keyHint: document.createElement("div"), preview: document.createElement("div") },
      gitHub: { enabled },
      _isApple: isApple,
      _clearKeyHintDismiss: UIController.prototype._clearKeyHintDismiss,
    };
    UIController.prototype.showKeyHint.call(app, mode);
    app._clearKeyHintDismiss();
    return app.elements.keyHint.textContent;
  }

  it("a PC: [O] GitHub; after [F] Search; (the code view: after [P] Commands;) in both views", () => {
    expect(hintText(true, "markdown")).toContain("[F] Search; [O] GitHub; [L] Light;");
    expect(hintText(true, "code")).toContain("[F] Search; [P] Commands; [O] GitHub; [L] Light;");
    expect(hintText(true, "code")).toContain("[Ctrl+Left][Ctrl+Right] Fold (JSON);");
  });

  it("a Mac: the code view keeps the Option fold keys with [O] GitHub;", () => {
    expect(hintText(true, "code", true)).toBe(CONFIG.keyHints.codeAppleGitHub);
    expect(hintText(true, "code", true)).toContain("[P] Commands; [O] GitHub;");
    expect(hintText(true, "code", true)).toContain("[Option+Left][Option+Right] Fold (JSON);");
    expect(hintText(false, "code", true)).toBe(CONFIG.keyHints.codeApple);
  });

  it("an iPad (GitHub editing not shown): no [O]", () => {
    expect(hintText(false, "markdown")).toBe(CONFIG.keyHints.markdown);
    expect(hintText(false, "code")).toBe(CONFIG.keyHints.code);
    expect(CONFIG.keyHints.markdown).not.toContain("[O]");
  });

  it("the GitHub hints differ from the plain ones only by [O] GitHub;", () => {
    for (const mode of ["markdown", "code", "codeApple"]) {
      expect(CONFIG.keyHints[`${mode}GitHub`].replace("[O] GitHub; ", "")).toBe(CONFIG.keyHints[mode]);
    }
  });
});

describe("AT-GH-09 GitHubController: the button, the o key and the dialogs", () => {
  it("[Open GitHub] when no GitHub document; [Push to GitHub] while one is shown, enabled only when it differs (INV-95)", () => {
    const host = fakeHost();
    const { c, el } = make({}, host);
    expect(el.button.hidden).toBe(false);
    expect(el.button.classList.contains("gh-push")).toBe(true);
    expect(el.button.disabled).toBe(false);
    host.body = () => "# A\n"; // the GitHub version
    c.refresh();
    expect(el.button.disabled).toBe(true);
    host.documents.gitHub = null;
    c.refresh();
    expect(el.button.classList.contains("gh-push")).toBe(false);
    expect(el.button.textContent).toBe("OpenGitHub"); // G.labels.openButton
  });

  it("o opens the Open dialog with the cursor in the token field; nothing while a GitHub document is shown (INV-93, D9, D24)", () => {
    const host = fakeHost();
    const { c, el } = make({}, host);
    c.handleKey();
    expect(el.openDialog.open).toBe(false);
    host.documents.gitHub = null;
    c.handleKey();
    expect(el.openDialog.open).toBe(true);
    expect(document.activeElement).toBe(el.open.token);
  });

  it("not shown on a touch device or in a frame: the button is hidden and o does nothing (INV-100)", () => {
    const el = mountDialogs();
    const host = fakeHost();
    host.documents.gitHub = null;
    const c = new GitHubController(el, {}, host, { ...G, enabled: false, passwordStore: null });
    expect(el.button.hidden).toBe(true);
    c.handleKey();
    expect(el.openDialog.open).toBe(false);
  });

  it("keys typed in a dialog do not reach the app's one-key shortcuts", () => {
    const { el } = make();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    el.open.token.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("a .md dropped on a GitHub document: keep, stop or cancel (INV-98)", async () => {
    const { c, el } = make();
    for (const [button, choice] of [["keep", "keep"], ["stop", "stop"], ["cancel", "cancel"]]) {
      const answer = c.askDropChoice({ fileName: "draft.md", text: "# A\r\n", hasBom: false });
      expect(el.dropDialog.open).toBe(true);
      expect(el.drop.notes.hidden).toBe(false); // CRLF against LF
      el.drop[button].click();
      expect(await answer).toBe(choice);
      expect(el.dropDialog.open).toBe(false);
    }
  });
});

describe("AT-GH-10 relative images and links of a GitHub document (INV-99)", () => {
  it("rewrites them after sanitizing, and leaves them alone without a resolver", () => {
    const preview = document.createElement("div");
    document.body.appendChild(preview);
    const renderer = new MarkdownRenderer(preview, new Marked(), hljs, DOMPurify);
    const body = "![a](img/a.png) [next](b.md#top) [abs](https://example.com/x)";
    const plain = renderer.documentHtml(body).html;
    expect(plain).toContain("img/a.png");
    expect(plain).not.toContain("githubusercontent");
    renderer.setRelativeUrlResolver((value, kind) => resolveRelativeUrl(REF, value, kind, G));
    const { html } = renderer.documentHtml(body);
    expect(html).toContain("https://raw.githubusercontent.com/GoodRelax/repo/main/docs/img/a.png");
    expect(html).toContain('href="https://github.com/GoodRelax/repo/blob/main/docs/b.md#top"');
    expect(html).toContain('href="https://example.com/x"');
  });
});

describe("AT-GH-13 GitHubController: review fixes (M3, L2, L3)", () => {
  it.each([
    ["Ctrl+S", { key: "s", ctrlKey: true }, false],
    ["Ctrl+Shift+S", { key: "S", ctrlKey: true, shiftKey: true }, false],
    ["Cmd+S on a Mac", { key: "s", metaKey: true }, true],
  ])("INV-58: %s in a dialog stops the browser's Save page and starts no save", (_name, init, isApple) => {
    const el = mountDialogs();
    const host = fakeHost();
    host.documents.gitHub = null;
    const c = new GitHubController(el, {}, host, { ...G, enabled: true, passwordStore: null, isApple });
    c.openDialog();
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    el.open.url.dispatchEvent(event);
    document.removeEventListener("keydown", seen);
    expect(event.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled(); // the app's Save handler is never reached
  });

  it("a plain s typed in a dialog is text, not prevented", () => {
    const { c, el } = make();
    c.reloadDialog();
    const event = new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true });
    el.reload.token.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("CON-16 (2): a token typed and then canceled is emptied when the dialog closes", () => {
    const { c, el } = make();
    c.reloadDialog();
    el.reload.token.value = TOKEN;
    el.reloadDialog.querySelector(".gh-cancel").click();
    expect(el.reloadDialog.open).toBe(false);
    expect(el.reload.token.value).toBe("");
  });

  it("L2: a branch or path with a dot part is refused in the Open dialog and nothing is sent", async () => {
    const client = { openFile: vi.fn() };
    const host = fakeHost();
    host.documents.gitHub = null;
    const { c, el } = make(client, host);
    c.openDialog();
    el.open.url.value = "https://github.com/GoodRelax/sample/blob/main/docs/a.md";
    el.open.url.dispatchEvent(new Event("input"));
    el.open.token.value = TOKEN;
    for (const [branch, path] of [["main", "docs/../../../../user/repos/x.md"], ["..", "a.md"], ["main", "docs/./a.md"]]) {
      el.open.branch.value = branch;
      el.open.path.value = path;
      await c._submitOpen();
      expect(el.open.error.textContent).toBe(G.messages.unsafePath);
    }
    expect(client.openFile).not.toHaveBeenCalled();
  });
});

describe("AT-GH-10 a rewritten relative image still waits for consent (INV-99 (1), INV-19)", () => {
  it("the raw.githubusercontent.com image is held (no src) until the user consents", () => {
    const preview = document.createElement("div");
    document.body.appendChild(preview);
    const renderer = new MarkdownRenderer(preview, new Marked(), hljs, DOMPurify);
    renderer.setRelativeUrlResolver((value, kind) => resolveRelativeUrl(REF, value, kind, G));
    const holder = document.createElement("div");
    holder.innerHTML = renderer.documentHtml("![a](img/a.png)").html;
    const img = holder.querySelector("img");
    expect(img.hasAttribute("src")).toBe(false);
    const held = [...img.attributes].map((a) => a.value);
    expect(held).toContain("https://raw.githubusercontent.com/GoodRelax/repo/main/docs/img/a.png");
  });
});
