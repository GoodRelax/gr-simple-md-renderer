import { describe, it, expect, afterEach, vi } from "vitest";
import InvisibleCharOverlay from "../js/classes/InvisibleCharOverlay.js";

// INV-70: marks behind the block editor for characters that look like a
// space or nothing, and for the line break marks (two spaces at a line end).

const MARKED = ["\u00a0", "\u2007", "\u202f", "\u200b", "\u200c", "\u2060", "\ufeff", "\u00ad"];

describe("AT-ICO segments (pure)", () => {
  it.each(MARKED.map((ch) => [ch.codePointAt(0).toString(16), ch]))("AT-ICO-01 U+%s is marked", (_hex, ch) => {
    expect(InvisibleCharOverlay.segments(`a${ch}b`, [])).toEqual([
      { text: "a", mark: false },
      { text: ch, mark: true },
      { text: "b", mark: false },
    ]);
  });

  it("AT-ICO-02 ZWJ and variation selectors are not marked (emoji stay whole)", () => {
    const text = "\ud83d\udc68\u200d\ud83d\udc69 \u2764\ufe0f";
    expect(InvisibleCharOverlay.segments(text, [])).toEqual([{ text, mark: false }]);
  });

  it("AT-ICO-03 line end spaces (two or more) only on the flagged lines", () => {
    expect(InvisibleCharOverlay.segments("abc   \ndef  \ng ", [true, false, true])).toEqual([
      { text: "abc", mark: false },
      { text: "   ", mark: true },
      { text: "\ndef  \ng ", mark: false },
    ]);
  });

  it("AT-ICO-04 marked characters next to each other share one segment", () => {
    expect(InvisibleCharOverlay.segments("\u00a0\u200b", [])).toEqual([{ text: "\u00a0\u200b", mark: true }]);
  });
});

describe("AT-ICO the layer behind the editor", () => {
  let wrapper;
  let frames;
  afterEach(() => wrapper?.remove());

  function setup(value, options = {}) {
    wrapper = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.value = value;
    wrapper.append(textarea);
    document.body.append(wrapper);
    frames = [];
    const overlay = new InvisibleCharOverlay(textarea, {
      maxChars: 50,
      lineEndMarks: () => [],
      requestFrame: (fn) => frames.push(fn),
      ...options,
    });
    return { textarea, overlay };
  }
  const flush = () => frames.splice(0).forEach((fn) => fn());
  const layer = () => wrapper.querySelector(".md-invisible-overlay");

  it("AT-ICO-05 attach puts an inert, hidden layer before the editor and marks the characters", () => {
    const { textarea, overlay } = setup("a\u00a0b");
    overlay.attach();
    flush();
    const el = layer();
    expect(el.nextElementSibling).toBe(textarea);
    expect(el.hasAttribute("inert")).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(true);
    expect([...el.querySelectorAll("span.grsmd-invisible")].map((s) => s.textContent)).toEqual(["\u00a0"]);
    expect(el.textContent).toBe("a\u00a0b");
  });

  it("AT-ICO-06 the user's text is never read as HTML", () => {
    const { overlay } = setup("<b>x</b>\u200b<img src=x>");
    overlay.attach();
    flush();
    expect(layer().querySelector("b, img")).toBe(null);
    expect(layer().textContent).toBe("<b>x</b>\u200b<img src=x>");
  });

  it("AT-ICO-07 an input is drawn again once per frame", () => {
    const { textarea, overlay } = setup("a\u200b");
    overlay.attach();
    flush();
    textarea.value = "a\u200b\u00a0";
    textarea.dispatchEvent(new Event("input"));
    textarea.dispatchEvent(new Event("input"));
    expect(frames).toHaveLength(1);
    expect(layer().textContent).toBe("a\u200b");
    flush();
    expect(layer().textContent).toBe("a\u200b\u00a0");
  });

  it("AT-ICO-08 line end marks come from lineEndMarks(text)", () => {
    const { overlay } = setup("a   \nb", { lineEndMarks: () => [true, false] });
    overlay.attach();
    flush();
    expect([...layer().querySelectorAll("span.grsmd-invisible")].map((s) => s.textContent)).toEqual(["   "]);
  });

  it("AT-ICO-09 above maxChars there is no layer, and the editor keeps its own background", () => {
    const { textarea, overlay } = setup("x".repeat(51));
    overlay.attach();
    flush();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
    textarea.value = "short\u00a0";
    textarea.dispatchEvent(new Event("input"));
    flush();
    expect(layer()).not.toBe(null);
    textarea.value = "y".repeat(60);
    textarea.dispatchEvent(new Event("input"));
    flush();
    expect(layer()).toBe(null);
  });

  it("AT-ICO-10 detach removes the layer, the class and the listener", () => {
    const { textarea, overlay } = setup("a\u00a0");
    overlay.attach();
    flush();
    expect(layer()).not.toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(true);
    overlay.detach();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
    textarea.dispatchEvent(new Event("input"));
    expect(frames).toHaveLength(0);
  });

  it("AT-ICO-15 the first draw is in the next frame too: attach changes no layout in its own task (P-1, INV-51)", () => {
    const { textarea, overlay } = setup("a\u00a0b");
    overlay.attach();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
    expect(frames).toHaveLength(1);
    flush();
    expect(layer().textContent).toBe("a\u00a0b");
  });

  it("AT-ICO-18 no mark: no layer, and the editor keeps its own background; a mark brings the layer, none again removes it (INV-51)", () => {
    // the layer would show only the editor's own background, and laying out
    // a copy of a large text (a 1,000-row table's source) costs a frame
    const { textarea, overlay } = setup("| a | b |");
    overlay.attach();
    flush();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
    textarea.value = "| a\u00a0| b |";
    textarea.dispatchEvent(new Event("input"));
    flush();
    expect(layer().querySelectorAll("span.grsmd-invisible")).toHaveLength(1);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(true);
    textarea.value = "| a | b |";
    textarea.dispatchEvent(new Event("input"));
    flush();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
  });

  it("AT-ICO-19 line end spaces alone are marks (a layer); a size change without a layer draws none", () => {
    const observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const { textarea, overlay } = setup("ab  ", { lineEndMarks: () => [true] });
      overlay.attach();
      flush();
      expect([...layer().querySelectorAll("span.grsmd-invisible")].map((s) => s.textContent)).toEqual(["  "]);
      textarea.value = "ab";
      textarea.dispatchEvent(new Event("input"));
      flush();
      expect(layer()).toBe(null);
      observers[0].cb([]); // the editor's size changed: only a placing, and there is no layer
      expect(frames).toHaveLength(1);
      expect(() => flush()).not.toThrow();
      expect(layer()).toBe(null);
      expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
      overlay.detach();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AT-ICO-16 above maxMarks marks there is no layer; fewer again brings it back (P-3)", () => {
    const { textarea, overlay } = setup("a\u00a0b\u00a0c\u00a0d", { maxMarks: 2 });
    overlay.attach();
    flush();
    expect(layer()).toBe(null);
    expect(textarea.classList.contains("md-block-editor-overlaid")).toBe(false);
    textarea.value = "a\u00a0b\u00a0\u00a0c"; // two runs of marks
    textarea.dispatchEvent(new Event("input"));
    flush();
    expect(layer().querySelectorAll("span.grsmd-invisible")).toHaveLength(2);
  });

  it("AT-ICO-11 a frame that runs after detach draws nothing", () => {
    const { textarea, overlay } = setup("a\u00a0");
    overlay.attach();
    flush();
    expect(layer()).not.toBe(null);
    textarea.dispatchEvent(new Event("input"));
    overlay.detach();
    flush();
    expect(layer()).toBe(null);
  });
});

describe("AT-ICO geometry and size", () => {
  let wrapper;
  afterEach(() => {
    wrapper?.remove();
    vi.unstubAllGlobals();
  });

  function setup() {
    wrapper = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.value = "a\u00a0b";
    for (const [key, value] of Object.entries({ offsetTop: 4, offsetLeft: 2, offsetWidth: 300, offsetHeight: 50 })) {
      Object.defineProperty(textarea, key, { configurable: true, get: () => value });
    }
    wrapper.append(textarea);
    document.body.append(wrapper);
    const frames = [];
    const overlay = new InvisibleCharOverlay(textarea, { maxChars: 50, requestFrame: (fn) => frames.push(fn) });
    return { textarea, overlay, frames };
  }

  it("AT-ICO-12 the layer covers the editor exactly", () => {
    const { overlay, frames } = setup();
    overlay.attach();
    frames.splice(0).forEach((fn) => fn());
    const style = wrapper.querySelector(".md-invisible-overlay").style;
    expect([style.top, style.left, style.width, style.height]).toEqual(["4px", "2px", "300px", "50px"]);
  });

  it("AT-ICO-13 a ResizeObserver on the editor draws it again; detach disconnects it", () => {
    const observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb) {
          this.cb = cb;
          this.targets = [];
          this.disconnected = false;
          observers.push(this);
        }
        observe(el) {
          this.targets.push(el);
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    );
    const { textarea, overlay, frames } = setup();
    overlay.attach();
    frames.splice(0).forEach((fn) => fn());
    expect(observers[0].targets).toEqual([textarea]);
    observers[0].cb([]);
    expect(frames).toHaveLength(1);
    overlay.detach();
    expect(observers[0].disconnected).toBe(true);
  });

  it("AT-ICO-17 a size change with the text unchanged only places the layer; an input in the same frame draws it (P-2)", () => {
    const observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb) {
          this.cb = cb;
          observers.push(this);
        }
        observe() {}
        disconnect() {}
      },
    );
    const lineEndMarks = vi.fn(() => []);
    wrapper = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.value = "a\u00a0b";
    let width = 300;
    Object.defineProperty(textarea, "offsetWidth", { configurable: true, get: () => width });
    wrapper.append(textarea);
    document.body.append(wrapper);
    const frames = [];
    const run = () => frames.splice(0).forEach((fn) => fn());
    const overlay = new InvisibleCharOverlay(textarea, { maxChars: 50, lineEndMarks, requestFrame: (fn) => frames.push(fn) });
    overlay.attach();
    observers[0].cb([]); // the first notice after observe: the draw already asked for covers it
    expect(frames).toHaveLength(1);
    run();
    expect(lineEndMarks).toHaveBeenCalledTimes(1);
    const el = wrapper.querySelector(".md-invisible-overlay");
    const mark = el.querySelector("span.grsmd-invisible");
    width = 280;
    observers[0].cb([]);
    run();
    expect(lineEndMarks).toHaveBeenCalledTimes(1); // not drawn again
    expect(el.querySelector("span.grsmd-invisible")).toBe(mark);
    expect(el.style.width).toBe("280px");
    observers[0].cb([]);
    textarea.dispatchEvent(new Event("input"));
    expect(frames).toHaveLength(1);
    run();
    expect(lineEndMarks).toHaveBeenCalledTimes(2);
    overlay.detach();
  });

  it("AT-ICO-14 without a ResizeObserver the window's resize draws it again", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { overlay, frames } = setup();
    overlay.attach();
    frames.splice(0).forEach((fn) => fn());
    window.dispatchEvent(new Event("resize"));
    expect(frames).toHaveLength(1);
    overlay.detach();
    window.dispatchEvent(new Event("resize"));
    expect(frames).toHaveLength(1);
  });
});
