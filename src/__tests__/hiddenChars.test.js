import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findHiddenRuns, countHiddenRuns, hiddenRunLabel, mayHoldHiddenChars, HIDDEN_CHAR_NAMES } from "../js/hiddenChars.js";

// INV-101 (1)(2), spec 5.21.1 / 5.21.2 (owner rulings AQ6 (5), AQ10, AQ14;
// the emoji exceptions follow owner ruling AQ16).

const here = dirname(fileURLToPath(import.meta.url));

/** The tag characters of an ASCII text (U+E0000 + the code). */
const tags = (ascii) => String.fromCodePoint(...[...ascii].map((c) => 0xe0000 + c.charCodeAt(0)));
const CANCEL = "\u{E007F}";
const BLACK_FLAG = "\u{1F3F4}";
const ENGLAND = BLACK_FLAG + tags("gbeng") + CANCEL;
const SCOTLAND = BLACK_FLAG + tags("gbsct") + CANCEL;
const WALES = BLACK_FLAG + tags("gbwls") + CANCEL;
const MAN = "\u{1F468}";
const WOMAN = "\u{1F469}";
const GIRL = "\u{1F467}";
const ZWJ = "\u200d";
const FAMILY = MAN + ZWJ + WOMAN + ZWJ + GIRL;

const labels = (text, options) => findHiddenRuns(text, options).map((r) => r.label);

describe("AT-HID-01 INV-101 (1): every character of the set is a run with its label (5.21.2)", () => {
  it.each(Object.entries(HIDDEN_CHAR_NAMES))("U+%s", (hex, name) => {
    const ch = String.fromCharCode(Number(hex));
    expect(findHiddenRuns(`a${ch}b`)).toEqual([{ start: 1, end: 2, label: name }]);
  });

  it("the names of 5.21.2, sixteen of them", () => {
    expect(HIDDEN_CHAR_NAMES).toEqual({
      0x200b: "ZWSP", 0x200c: "ZWNJ", 0x200d: "ZWJ", 0x2060: "WJ", 0xfeff: "BOM",
      0x202a: "LRE", 0x202b: "RLE", 0x202c: "PDF", 0x202d: "LRO", 0x202e: "RLO",
      0x2066: "LRI", 0x2067: "RLI", 0x2068: "FSI", 0x2069: "PDI", 0x200e: "LRM", 0x200f: "RLM",
    });
  });

  it("a tag character is one (a surrogate pair: the run's end is after both halves)", () => {
    expect(findHiddenRuns(`a${tags("x")}b`)).toEqual([{ start: 1, end: 3, label: "hidden: x" }]);
  });

  it("characters that only look like a space are not (INV-70 marks them in editing only)", () => {
    for (const ch of ["\u00a0", "\u2007", "\u202f", "\u00ad", "\ufe0f", "\u200a", " "]) {
      expect(findHiddenRuns(`a${ch}b`), JSON.stringify(ch)).toEqual([]);
    }
    expect(mayHoldHiddenChars("plain text\u00a0")).toBe(false);
  });
});

describe("AT-HID-02 INV-101 (1): neighbours are one run; the label joins the parts with a space", () => {
  it("ZWSP, a tag sentence and RLO side by side are one place", () => {
    expect(findHiddenRuns(`x\u200b${tags("run this")}\u202ey`)).toEqual([{ start: 1, end: 19, label: "ZWSP hidden: run this RLO" }]);
  });

  it("two tag stretches split by a name are two parts in one label", () => {
    expect(labels(`${tags("a")}\u2066${tags("b")}`)).toEqual(["hidden: a LRI hidden: b"]);
  });

  it("a visible character splits runs", () => {
    expect(findHiddenRuns("a\u200bb\u200bc").map((r) => [r.start, r.label])).toEqual([[1, "ZWSP"], [3, "ZWSP"]]);
    expect(countHiddenRuns("a\u200b\u200cb\u202e\u202cc")).toBe(2);
  });
});

describe("AT-HID-03 INV-101 (2) (a): one ZWJ between emoji is not hidden; other ZWJs are", () => {
  it.each([
    ["a family", FAMILY],
    ["a skin tone before the ZWJ", `${WOMAN}\u{1F3FD}${ZWJ}\u{1F4BB}`],
    ["U+FE0F before the ZWJ", `\u{1F3F3}\ufe0f${ZWJ}\u{1F308}`],
    ["U+FE0F and a skin tone before the ZWJ", `\u{1F3C3}\u{1F3FB}\ufe0f${ZWJ}\u2640\ufe0f`],
    ["a heart on fire", `\u2764\ufe0f${ZWJ}\u{1F525}`],
  ])("%s", (_name, text) => {
    expect(findHiddenRuns(`a ${text} b`)).toEqual([]);
    expect(countHiddenRuns(text)).toBe(0);
  });

  it.each([
    ["two ZWJs in a row", `${MAN}${ZWJ}${ZWJ}${WOMAN}`, ["ZWJ ZWJ"]],
    ["a ZWJ at the start", `${ZWJ}${MAN}`, ["ZWJ"]],
    ["a ZWJ at the end", `${MAN}${ZWJ}`, ["ZWJ"]],
    ["a ZWJ between letters", `a${ZWJ}b`, ["ZWJ"]],
    ["a ZWJ between an emoji and a letter", `${MAN}${ZWJ}b`, ["ZWJ"]],
    ["a ZWJ after a skin tone alone", `a\u{1F3FD}${ZWJ}${MAN}`, ["ZWJ"]],
    ["a ZWJ then a ZWSP", `${MAN}${ZWJ}\u200b${WOMAN}`, ["ZWJ ZWSP"]],
  ])("%s", (_name, text, expected) => {
    expect(labels(text)).toEqual(expected);
  });
});

describe("AT-HID-04 INV-101 (2) (b): the tags of the England, Scotland and Wales flags are not hidden; other tags are", () => {
  it.each([
    ["England", ENGLAND],
    ["Scotland", SCOTLAND],
    ["Wales", WALES],
  ])("%s", (_name, flag) => {
    expect(findHiddenRuns(`flag ${flag} ok`)).toEqual([]);
  });

  it.each([
    ["another code (usca)", `${BLACK_FLAG}${tags("usca")}${CANCEL}`, ["hidden: usca?"]],
    ["no U+E007F at the end", `${BLACK_FLAG}${tags("gbeng")}x`, ["hidden: gbeng"]],
    ["no U+1F3F4 before", `x${tags("gbeng")}${CANCEL}`, ["hidden: gbeng?"]],
    ["another character between U+1F3F4 and the tags", `${BLACK_FLAG}\u200b${tags("gbeng")}${CANCEL}`, ["ZWSP hidden: gbeng?"]],
    ["a longer code that starts like a flag", `${BLACK_FLAG}${tags("gbengx")}${CANCEL}`, ["hidden: gbengx?"]],
  ])("%s", (_name, text, expected) => {
    expect(labels(text)).toEqual(expected);
  });

  it("tags right after a flag are a run of their own, after the flag", () => {
    const text = `${ENGLAND}${tags("hi")}`;
    expect(findHiddenRuns(text)).toEqual([{ start: ENGLAND.length, end: text.length, label: "hidden: hi" }]);
  });
});

describe("AT-HID-05 5.21.2: a tag stretch is read back as ASCII; the rest of the tag block is ?", () => {
  it("U+E0020..U+E007E are ASCII 0x20..0x7E", () => {
    const ascii = Array.from({ length: 0x5f }, (_, i) => String.fromCharCode(0x20 + i)).join("");
    expect(labels(`a${tags(ascii)}b`)).toEqual([`hidden: ${ascii}`]);
  });

  it.each([0xe0000, 0xe0001, 0xe0002, 0xe001f, 0xe007f])("U+%s is ?", (cp) => {
    expect(hiddenRunLabel([cp])).toBe("hidden: ?");
  });

  it("the whole sentence, not cut", () => {
    const sentence = "This sentence is hidden from you. ".repeat(30);
    expect(labels(`a${tags(sentence)}b`)).toEqual([`hidden: ${sentence}`]);
  });
});

describe("AT-HID-06 5.21.1: U+FEFF at the start of the text is not one; anywhere else it is", () => {
  it("the start of the whole text", () => {
    expect(findHiddenRuns("\ufeffabc")).toEqual([]);
    expect(countHiddenRuns("\ufeffabc")).toBe(0);
    expect(labels("\ufeff\u200babc")).toEqual(["ZWSP"]);
    expect(labels("\ufeff\ufeffabc")).toEqual(["BOM"]);
  });

  it("inside the text, and at the start of a piece that is not the text's start", () => {
    expect(labels("a\ufeffb")).toEqual(["BOM"]);
    expect(labels("\ufeffabc", { textStart: false })).toEqual(["BOM"]);
  });

  it("no hidden character: no run, a count of 0", () => {
    expect(findHiddenRuns("")).toEqual([]);
    expect(countHiddenRuns("plain\ntext")).toBe(0);
  });
});

describe("AT-HID-12 5.21.4: the mark's style (style.css)", () => {
  const css = readFileSync(resolve(here, "../css/style.css"), "utf8");
  const ruleBody = (text, selector) => {
    const at = text.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return text.slice(text.indexOf("{", at) + 1, text.indexOf("}", at));
  };
  // the bodies of the @media print blocks (braces matched)
  const printCss = [...css.matchAll(/@media print\s*\{/g)]
    .map((m) => {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      return css.slice(m.index, i);
    })
    .join("\n");

  it("the label is generated content between U+27EA and U+27EB, written in ASCII escapes", () => {
    expect(ruleBody(css, ".grsmd-hidden-mark::before")).toContain('content: "\\27EA" attr(data-label) "\\27EB";');
    expect([...css].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
  });

  it("a thin frame in the color of the text around it, a clear ground, monospace and smaller, in both themes", () => {
    const body = ruleBody(css, ".grsmd-hidden-mark::before");
    expect(body).toMatch(/border: 1px solid currentColor;/);
    expect(body).toMatch(/color: currentColor;/);
    expect(body).toMatch(/background: transparent;/);
    expect(body).toMatch(/font-family: monospace;/);
    expect(body).toMatch(/font-size: 0\.75em;/);
    expect(css).not.toMatch(/\.dark [^{]*grsmd-hidden-mark/); // no theme of its own
  });

  it("isolated: an override in the text around it does not turn the label around", () => {
    expect(ruleBody(css, ".grsmd-hidden-mark")).toMatch(/unicode-bidi: isolate;/);
  });

  it("printed: no print rule names it", () => {
    expect(printCss).not.toContain("grsmd-hidden-mark");
  });
});
