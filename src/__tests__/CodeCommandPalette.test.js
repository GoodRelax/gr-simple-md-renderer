import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CodeCommandPalette from "../js/classes/CodeCommandPalette.js";
import { CONFIG } from "../js/config.js";
import { keydown, pointer, trackListeners } from "./helpers/editDom.js";

// AT-CCP: the code view's command palette (INV-92, NE-13): the box under
// [Commands], its two commands, Esc / a press outside, the focus.

const L = CONFIG.messages.codeCommands;

let button;
let box;
let other;
let host;
let palette;

beforeEach(() => {
  button = Object.assign(document.createElement("button"), { id: "commandsBtn" });
  box = Object.assign(document.createElement("div"), { id: "codeCommandPalette" });
  other = document.createElement("button");
  document.body.append(button, box, other);
  host = { runCommand: vi.fn() };
});

afterEach(() => {
  palette?.hide();
  palette = null;
  button.remove();
  box.remove();
  other.remove();
  vi.restoreAllMocks();
});

function make(isApple = false) {
  palette = new CodeCommandPalette({ button, box }, host, L, { isApple });
  return palette;
}

const commands = () => [...box.querySelectorAll("button.code-command")];

describe("CodeCommandPalette (INV-92, NE-13)", () => {
  it("AT-CCP-01 a dialog with its name, closed; Fold and Unfold with the Ctrl keys (Apple: Option)", () => {
    make();
    expect([box.getAttribute("role"), box.getAttribute("aria-label"), box.hidden, button.getAttribute("aria-expanded")]).toEqual([
      "dialog",
      L.title,
      true,
      "false",
    ]);
    expect(commands().map((b) => [b.dataset.command, b.textContent])).toEqual([
      ["fold", "Fold one level (Ctrl+Left)"],
      ["unfold", "Unfold one level (Ctrl+Right)"],
    ]);
    palette = null;
    box.replaceChildren();
    make(true);
    expect(commands().map((b) => b.textContent)).toEqual(["Fold one level (Option+Left)", "Unfold one level (Option+Right)"]);
  });

  it("AT-CCP-02 the button opens it under itself with the focus on the first command; again: closed, the focus back", () => {
    make();
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ left: 300, right: 380, top: 10, bottom: 40, width: 80, height: 30 });
    Object.defineProperty(box, "offsetWidth", { configurable: true, value: 200 });
    other.focus();
    button.click();
    expect([palette.isShown(), button.getAttribute("aria-expanded"), box.style.left, box.style.top]).toEqual([true, "true", "180px", "44px"]);
    expect(document.activeElement).toBe(commands()[0]);
    palette.toggle();
    expect([palette.isShown(), button.getAttribute("aria-expanded")]).toEqual([false, "false"]);
    expect(document.activeElement).toBe(other);
  });

  it("AT-CCP-03 a command runs and the box stays open (to fold again)", () => {
    make();
    palette.show();
    commands()[0].click();
    commands()[0].click();
    commands()[1].click();
    expect(host.runCommand.mock.calls).toEqual([["fold"], ["fold"], ["unfold"]]);
    expect(palette.isShown()).toBe(true);
  });

  it("AT-CCP-04 Esc in the box closes it, goes no further, and gives the focus back; not during IME composition", () => {
    make();
    other.focus();
    palette.show();
    expect(keydown(commands()[0], "Escape", { isComposing: true }).defaultPrevented).toBe(false);
    expect(palette.isShown()).toBe(true);
    const e = keydown(commands()[0], "Escape");
    expect([e.defaultPrevented, palette.isShown(), document.activeElement === other]).toEqual([true, false, true]);
  });

  it("AT-CCP-05 a press outside closes it (no focus moved); a press in the box or on the button does not", () => {
    make();
    palette.show();
    pointer(commands()[1], "pointerdown");
    pointer(button, "pointerdown");
    expect(palette.isShown()).toBe(true);
    pointer(document.body, "pointerdown");
    expect(palette.isShown()).toBe(false);
  });

  it("AT-CCP-06 off (not a JSON file, not the code view): the button is disabled, the box closes and does not open", () => {
    make();
    palette.setAvailable(true);
    palette.show();
    palette.setAvailable(false);
    expect([button.disabled, palette.isShown()]).toEqual([true, false]);
    palette.show();
    expect(palette.isShown()).toBe(false);
  });

  it("AT-CCP-07 closed, it leaves no document or window listener", () => {
    const listeners = trackListeners();
    make();
    palette.show();
    palette.hide();
    expect(listeners.active((t) => t === document || t === window)).toBe(0);
    listeners.restore();
  });
});
