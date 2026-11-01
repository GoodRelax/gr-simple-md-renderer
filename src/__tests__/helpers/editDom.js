import { vi } from "vitest";

/**
 * Dispatch one PointerEvent on el (jsdom reports offsetX/offsetY = clientX/clientY).
 * @returns {PointerEvent}
 */
export function pointer(el, type, { x = 10, y = 10, pointerType = "mouse", button = 0, pointerId = 1 } = {}) {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerType,
    button,
    pointerId,
  });
  el.dispatchEvent(e);
  return e;
}

/**
 * pointerdown on downEl, then pointerup on upEl moved by (dx, dy).
 */
export function tap(downEl, { upEl = downEl, dx = 0, dy = 0, pointerType = "mouse", button = 0 } = {}) {
  pointer(downEl, "pointerdown", { x: 10, y: 10, pointerType, button });
  pointer(upEl, "pointerup", { x: 10 + dx, y: 10 + dy, pointerType, button });
}

/**
 * Dispatch a keydown on el and return the event (defaultPrevented tells if it was taken).
 * @returns {KeyboardEvent}
 */
export function keydown(el, key, init = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

/**
 * Count addEventListener / removeEventListener pairs per target.
 * Call restore() in afterEach (vi.restoreAllMocks also does it).
 */
export function trackListeners() {
  const add = vi.spyOn(EventTarget.prototype, "addEventListener");
  const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
  const key = (args) => {
    const opt = args[2];
    const capture = typeof opt === "boolean" ? opt : Boolean(opt?.capture);
    return `${args[0]}|${capture}`;
  };
  /**
   * Listeners added on target and not removed yet (same type, function and capture).
   * @param {(target: EventTarget) => boolean} match
   * @returns {number}
   */
  function active(match) {
    const live = [];
    const events = [];
    add.mock.calls.forEach((args, i) => events.push({ order: add.mock.invocationCallOrder[i], kind: "add", target: add.mock.contexts[i], args }));
    remove.mock.calls.forEach((args, i) => events.push({ order: remove.mock.invocationCallOrder[i], kind: "remove", target: remove.mock.contexts[i], args }));
    events.sort((a, b) => a.order - b.order);
    for (const ev of events) {
      if (!match(ev.target)) continue;
      const found = live.findIndex((l) => l.target === ev.target && l.fn === ev.args[1] && l.key === key(ev.args));
      if (ev.kind === "add" && found < 0) live.push({ target: ev.target, fn: ev.args[1], key: key(ev.args) });
      if (ev.kind === "remove" && found >= 0) live.splice(found, 1);
    }
    return live.length;
  }
  return { active, restore: () => { add.mockRestore(); remove.mockRestore(); } };
}
