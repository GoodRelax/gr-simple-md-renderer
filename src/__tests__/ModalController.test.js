import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ModalController from "../js/classes/ModalController.js";
import HelpLanguageSwitch from "../js/classes/HelpLanguageSwitch.js";

// AT-HLP-07..11: while the help (or the prompt) is open, the app's one-key
// shortcuts do not act behind it, Esc closes it, the real close button closes
// it, the focus moves in on open and back on close, and Tab / Shift+Tab stay
// inside it (SC-16, FS-10, 5.11).

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(here, "../index.html"), "utf8");

function makeModal() {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML =
    '<div class="modal-content"><button type="button" class="close-btn" aria-label="Close">x</button>' +
    '<button type="button" data-help-lang="ja">Japanese</button></div>';
  document.body.appendChild(modal);
  return modal;
}

/** A real modal of src/index.html (#helpModal or #promptModal), attached. */
function realModal(id) {
  const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  const modal = document.importNode(doc.getElementById(id), true);
  document.body.appendChild(modal);
  return modal;
}

/** A button behind the modal, like [?] and [Clear]. */
function pageButton(id) {
  const button = document.createElement("button");
  button.id = id;
  document.body.prepend(button);
  return button;
}

function press(target, key, init = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Tab the way a browser would deliver it: to the focused element. */
const tab = (init = {}) => press(document.activeElement ?? document.body, "Tab", init);

describe("ModalController keys and focus (AT-HLP-07..11)", () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  /** An app shortcut listener like UIController's (document, bubble). */
  function appListener() {
    const seen = [];
    const listener = (e) => {
      if (!e.defaultPrevented) seen.push(e.key);
    };
    document.addEventListener("keydown", listener);
    cleanups.push(() => document.removeEventListener("keydown", listener));
    return seen;
  }

  function setup(modal = makeModal()) {
    const dispose = ModalController.setupModal(modal, [modal.querySelector(".close-btn")]);
    cleanups.push(dispose);
    return modal;
  }

  it("AT-HLP-07 while open, a one-key shortcut does not reach the app; with Ctrl / Cmd / Alt it does; closed, all reach it", () => {
    const modal = setup();
    const seen = appListener();
    ModalController.show(modal);
    for (const key of ["c", "d", "l", "r", "n", "e", "ArrowDown", "ArrowUp"]) press(document.body, key);
    press(modal.querySelector("[data-help-lang]"), "c");
    expect(seen).toEqual([]);
    press(document.body, "s", { ctrlKey: true });
    press(document.body, "s", { metaKey: true });
    press(document.body, "c", { altKey: true });
    expect(seen).toEqual(["s", "s", "c"]);
    ModalController.hide(modal);
    press(document.body, "c");
    expect(seen).toEqual(["s", "s", "c", "c"]);
  });

  it("AT-HLP-07 a key the modal stops keeps its default (Enter and Space on its buttons still work)", () => {
    const modal = setup();
    ModalController.show(modal);
    expect(press(modal.querySelector("[data-help-lang]"), "Enter").defaultPrevented).toBe(false);
    expect(press(modal.querySelector("[data-help-lang]"), " ").defaultPrevented).toBe(false);
  });

  it("AT-HLP-08 Esc closes the open modal and does not reach the app (no escapePressed behind it)", () => {
    const modal = setup();
    const seen = appListener();
    ModalController.show(modal);
    expect(ModalController.isOpen(modal)).toBe(true);
    press(document.body, "Escape");
    expect(ModalController.isOpen(modal)).toBe(false);
    expect(modal.style.display).toBe("none");
    expect(seen).toEqual([]);
    // closed: Esc is the app's again
    press(document.body, "Escape");
    expect(seen).toEqual(["Escape"]);
  });

  it("AT-HLP-08 only the open modal reacts; a second modal that is closed stays out of the way", () => {
    const help = setup();
    const prompt = setup();
    ModalController.show(prompt);
    press(document.body, "Escape");
    expect(ModalController.isOpen(prompt)).toBe(false);
    expect(ModalController.isOpen(help)).toBe(false);
  });

  it("AT-HLP-09 the real close buttons of the help and the prompt close them on a click", () => {
    for (const id of ["helpModal", "promptModal"]) {
      const modal = setup(realModal(id));
      ModalController.show(modal);
      modal.querySelector(".close-btn").click();
      expect(ModalController.isOpen(modal), id).toBe(false);
    }
  });

  it("AT-HLP-10 on open the focus moves to the pressed language button (help) or the close button (prompt); on close it goes back to the opener", () => {
    const helpBtn = pageButton("helpBtn");
    const help = setup(realModal("helpModal"));
    new HelpLanguageSwitch(help, "en-US");
    helpBtn.focus();
    ModalController.show(help, helpBtn);
    expect(document.activeElement).toBe(help.querySelector('[data-help-lang="en"]'));
    press(document.activeElement, "Escape");
    expect(document.activeElement).toBe(helpBtn);

    const prompt = setup(realModal("promptModal"));
    ModalController.show(prompt, helpBtn);
    expect(document.activeElement).toBe(prompt.querySelector(".close-btn"));
    prompt.querySelector(".close-btn").click();
    expect(document.activeElement).toBe(helpBtn);
  });

  it("AT-HLP-10 a click outside the content closes the modal and returns the focus too; no focus is left in the hidden modal", () => {
    const helpBtn = pageButton("helpBtn");
    const help = setup(realModal("helpModal"));
    new HelpLanguageSwitch(help, "ja-JP");
    ModalController.show(help, helpBtn);
    expect(document.activeElement).toBe(help.querySelector('[data-help-lang="ja"]'));
    help.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ModalController.isOpen(help)).toBe(false);
    expect(help.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(helpBtn);
  });

  it("AT-HLP-11 Tab and Shift+Tab go round inside the open modal and never reach the page behind it", () => {
    pageButton("clearBtn");
    const helpBtn = pageButton("helpBtn");
    const help = setup(realModal("helpModal"));
    new HelpLanguageSwitch(help, "en-US");
    ModalController.show(help, helpBtn);
    const shown = [...help.querySelectorAll("button, a[href], details > summary")].filter((el) => !el.closest("[hidden]"));
    // the folded Licenses' heading takes the focus too (HT-1), last in the English body
    expect(shown.at(-1).tagName).toBe("SUMMARY");
    // English, Japanese, close, then the English body's links
    expect(shown.slice(0, 3).map((el) => el.dataset.helpLang ?? el.className)).toEqual(["en", "ja", "close-btn"]);
    const visited = [];
    for (let i = 0; i < shown.length + 2; i++) {
      const event = tab();
      expect(event.defaultPrevented).toBe(true);
      visited.push(document.activeElement);
    }
    expect(visited.every((el) => help.contains(el) && !el.closest("[hidden]"))).toBe(true);
    expect(visited[shown.length - 1]).toBe(shown[0]); // round: after the last comes the first
    // Shift+Tab from the first goes to the last
    shown[0].focus();
    tab({ shiftKey: true });
    expect(document.activeElement).toBe(shown[shown.length - 1]);
    // from outside (focus left behind somehow), Tab comes back in
    helpBtn.focus();
    tab();
    expect(help.contains(document.activeElement)).toBe(true);
    // closed: Tab is the browser's again
    ModalController.hide(help);
    expect(tab().defaultPrevented).toBe(false);
  });

  it("AT-HLP-11 after switching the language, Tab goes through the shown body only", () => {
    const help = setup(realModal("helpModal"));
    const sw = new HelpLanguageSwitch(help, "en-US");
    ModalController.show(help);
    sw.setLanguage("ja");
    const jaLinks = [...help.querySelectorAll('.help-body[lang="ja"] a[href]')];
    const visited = new Set();
    for (let i = 0; i < 20; i++) {
      tab();
      visited.add(document.activeElement);
    }
    for (const a of jaLinks) expect(visited.has(a)).toBe(true);
    for (const el of visited) expect(el.closest('.help-body[lang="en"]')).toBeNull();
  });

  it("setupModal returns a function that removes its key listener", () => {
    const modal = makeModal();
    const dispose = ModalController.setupModal(modal, []);
    const spy = vi.spyOn(document, "removeEventListener");
    dispose();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    ModalController.show(modal);
    const seen = appListener();
    press(document.body, "c");
    expect(seen).toEqual(["c"]);
  });

  it("AT-HLP-13 onHide is called once each time the open modal closes, however it closes; not for a closed one (INV-89 dialogs)", () => {
    const modal = makeModal();
    const hidden = [];
    cleanups.push(ModalController.setupModal(modal, [modal.querySelector(".close-btn")], () => hidden.push(modal.style.display)));
    ModalController.hide(modal); // not open: nothing
    expect(hidden).toEqual([]);
    ModalController.show(modal);
    modal.querySelector(".close-btn").click();
    ModalController.show(modal);
    press(document.body, "Escape");
    ModalController.show(modal);
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // called after the modal is hidden
    expect(hidden).toEqual(["none", "none", "none"]);
  });

  it("AT-HLP-17 FS-25: the GitHub help over the help takes the keys; Esc closes it first (focus to its entry), then the help (focus to [?])", () => {
    const helpBtn = pageButton("helpBtn");
    const help = setup(realModal("helpModal"));
    const layer = setup(realModal("githubHelpModal"));
    new HelpLanguageSwitch(help, "en-US");
    new HelpLanguageSwitch(layer, "en-US");
    ModalController.show(help, helpBtn);
    const entry = help.querySelector('.help-body[lang="en"] [data-open-github-help]');
    entry.focus();
    ModalController.show(layer, entry);
    expect(document.activeElement).toBe(layer.querySelector('[data-help-lang="en"]'));
    // Tab goes round the layer only, not the help under it
    for (let i = 0; i < 5; i++) {
      tab();
      expect(layer.contains(document.activeElement)).toBe(true);
    }
    const seen = appListener();
    press(document.activeElement, "c");
    expect(seen).toEqual([]);
    press(document.activeElement, "Escape");
    expect(ModalController.isOpen(layer)).toBe(false);
    expect(ModalController.isOpen(help)).toBe(true);
    expect(document.activeElement).toBe(entry);
    press(document.activeElement, "Escape");
    expect(ModalController.isOpen(help)).toBe(false);
    expect(document.activeElement).toBe(helpBtn);
  });

  it("AT-HLP-23 HT-3: More details over the help takes the keys; Esc closes it first (focus to its entry), then the help (focus to [?])", () => {
    const helpBtn = pageButton("helpBtn");
    const help = setup(realModal("helpModal"));
    const guide = setup(realModal("guideModal"));
    new HelpLanguageSwitch(help, "ja");
    new HelpLanguageSwitch(guide, "ja");
    ModalController.show(help, helpBtn);
    const entry = help.querySelector('.help-body[lang="ja"] [data-open-guide]');
    entry.focus();
    ModalController.show(guide, entry);
    expect(document.activeElement).toBe(guide.querySelector('[data-help-lang="ja"]'));
    for (let i = 0; i < 5; i++) {
      tab();
      expect(guide.contains(document.activeElement)).toBe(true);
    }
    const seen = appListener();
    press(document.activeElement, "e");
    expect(seen).toEqual([]);
    press(document.activeElement, "Escape");
    expect(ModalController.isOpen(guide)).toBe(false);
    expect(ModalController.isOpen(help)).toBe(true);
    expect(document.activeElement).toBe(entry);
    press(document.activeElement, "Escape");
    expect(ModalController.isOpen(help)).toBe(false);
    expect(document.activeElement).toBe(helpBtn);
  });

  it("AT-HLP-17 a modal closed under another one leaves the top one taking the keys", () => {
    const lower = setup(makeModal());
    const upper = setup(makeModal());
    ModalController.show(lower);
    ModalController.show(upper);
    ModalController.hide(lower);
    press(document.body, "Escape");
    expect(ModalController.isOpen(upper)).toBe(false);
    // nothing open: Esc is the page's again
    const event = press(document.body, "Escape");
    expect(event.defaultPrevented).toBe(false);
  });
});
