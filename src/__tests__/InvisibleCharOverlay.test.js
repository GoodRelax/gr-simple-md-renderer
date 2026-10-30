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

  it("AT-ICO-21 the layer takes the text style the editor took from its block (INV-83)", () => {
    const { textarea, overlay, frames } = setup();
    Object.assign(textarea.style, { fontFamily: "BodySans", fontSize: "24px", fontWeight: "700", lineHeight: "normal", paddingLeft: "16px" });
    overlay.attach();
    frames.splice(0).forEach((fn) => fn());
    const style = wrapper.querySelector(".md-invisible-overlay").style;
    expect([style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.paddingLeft]).toEqual(["BodySans", "24px", "700", "normal", "16px"]);
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

// The line end spaces are found from the first of their run (review of the
// render hang): linear in the line. Runs always, as AT-FR-65.
const LONG_RUN_BUDGET_MS = 1000;

describe("AT-ICO a long run of spaces inside a line (linear line-end-space search)", () => {
  it("AT-ICO-20 segments: 100,000 spaces inside a flagged line are not marked; its end spaces are, within 1,000 ms", () => {
    const run = " ".repeat(100000);
    const t0 = performance.now();
    const parts = InvisibleCharOverlay.segments(`a${run}x  `, [true]);
    const ms = performance.now() - t0;
    expect(parts).toEqual([
      { text: `a${run}x`, mark: false },
      { text: "  ", mark: true },
    ]);
    expect(ms).toBeLessThan(LONG_RUN_BUDGET_MS);
  });
});

// INV-70 extended on 2026-10-30 (owner ruling AQ10): the tag and the direction
// characters; the tags of an RGI flag stay unmarked (INV-101 (2) (b)).
const ICO22_tags = (ascii) => String.fromCodePoint(...[...ascii].map((c) => 0xe0000 + c.charCodeAt(0)));
const ICO22_CANCEL = "\u{E007F}";
const ICO22_BLACK_FLAG = "\u{1F3F4}";
const ICO22_ENGLAND = ICO22_BLACK_FLAG + ICO22_tags("gbeng") + ICO22_CANCEL;
const ICO22_SCOTLAND = ICO22_BLACK_FLAG + ICO22_tags("gbsct") + ICO22_CANCEL;
const ICO22_WALES = ICO22_BLACK_FLAG + ICO22_tags("gbwls") + ICO22_CANCEL;
const ICO22_MAN = "\u{1F468}";
const ICO22_WOMAN = "\u{1F469}";
const ICO22_GIRL = "\u{1F467}";
const ICO22_ZWJ = "\u200d";
const ICO22_FAMILY = ICO22_MAN + ICO22_ZWJ + ICO22_WOMAN + ICO22_ZWJ + ICO22_GIRL;

describe("AT-ICO-22 INV-70 (AQ10), INV-101 (2) (b): tag and direction characters are marked in the editor and the cell; a flag's tags are not", () => {
  const marked = (text) => InvisibleCharOverlay.segments(text).filter((p) => p.mark).map((p) => p.text);

  it("the direction characters", () => {
    for (const ch of ["\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069", "\u200e", "\u200f"]) {
      expect(marked(`a${ch}b`), JSON.stringify(ch)).toEqual([ch]);
    }
  });

  it("the tag characters, as one mark with their neighbours", () => {
    expect(marked(`a${ICO22_tags("hi")}b`)).toEqual([ICO22_tags("hi")]);
    expect(marked(`a\u200b${ICO22_tags("hi")}\u202eb`)).toEqual([`\u200b${ICO22_tags("hi")}\u202e`]);
    expect(marked(`a\u{E0000}\u{E007F}b`)).toEqual(["\u{E0000}\u{E007F}"]);
  });

  it("the England, Scotland and Wales flags stay unmarked; tags after one, or another code, are marked", () => {
    for (const flag of [ICO22_ENGLAND, ICO22_SCOTLAND, ICO22_WALES]) expect(marked(`a${flag}b`)).toEqual([]);
    expect(marked(`${ICO22_ENGLAND}${ICO22_tags("x")}`)).toEqual([ICO22_tags("x")]);
    expect(marked(`${ICO22_BLACK_FLAG}${ICO22_tags("usca")}${ICO22_CANCEL}`)).toEqual([ICO22_tags("usca") + ICO22_CANCEL]);
    const parts = InvisibleCharOverlay.segments(`a${ICO22_ENGLAND}b`);
    expect(parts.map((p) => p.text).join("")).toBe(`a${ICO22_ENGLAND}b`); // nothing lost
  });

  it("ZWJ stays unmarked (an emoji is one glyph)", () => {
    expect(marked(ICO22_FAMILY)).toEqual([]);
    expect(marked(`a${ICO22_ZWJ}${ICO22_ZWJ}b`)).toEqual([]);
  });
});
