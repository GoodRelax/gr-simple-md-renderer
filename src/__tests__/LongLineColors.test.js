import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import LongLineColors from "../js/classes/LongLineColors.js";
import { lineFeedsIn } from "../js/caretMatching.js";
import { editedTokens, isChunkedLine, layerLineHtml as chunkedLineHtml, lineTokens, tokensByLine, tokensFromJson, tokensJson } from "../js/longLineTokens.js";
import { CONFIG } from "../js/config.js";

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const layerLineHtml = (html) => chunkedLineHtml(html, GRAPHEMES);
const STRING = 3; // Why: COLOR_GROUPS is private; this is the index of its string group
const KEYWORD = 0;
const span = (name, text) => `<span class="${name}">${text}</span>`;
const LONG = CONFIG.codeEdit.longLineChars;
const CHUNK = CONFIG.codeEdit.lineChunkChars;

function chunksOf(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return [...holder.querySelectorAll(".code-edit-chunk")];
}

describe("AT-LLC-01 (INV-86 (e)) lineTokens: the text of a line's HTML and its colored runs", () => {
  it("(b-2) the text after the last closing tag stays in the line", () => {
    // Spec: INV-86 (e)
    expect(lineTokens(`${span("hljs-keyword", "if")};`)).toEqual({ text: "if;", tokens: [[KEYWORD, 0, 2]] });
  });

  it("(a) tokens with offsets in the text, entities counted as one character", () => {
    const { text, tokens } = lineTokens(`a ${span("hljs-string", "&quot;x&amp;y&quot;")} b &lt;${span("hljs-keyword", "if")}`);
    expect(text).toBe('a "x&y" b <if');
    expect(tokens).toEqual([
      [STRING, 2, 7],
      [KEYWORD, 11, 13],
    ]);
  });

  it("(b) the innermost colored span gives the color; a span with no color of its own shows the one around it", () => {
    const html = span("hljs-string", `a${span("hljs-subst", "b")}c${span("language-css", "d")}`);
    const subst = 7;
    expect(lineTokens(html).tokens).toEqual([
      [STRING, 0, 1],
      [subst, 1, 2],
      [STRING, 2, 4],
    ]);
  });

  it("(c) runs of one color that touch are one token; hljs-variable language_ is the keyword's color; both entity spellings of the quote", () => {
    expect(lineTokens(`${span("hljs-string", "a")}${span("hljs-string", "b")}`).tokens).toEqual([[STRING, 0, 2]]);
    expect(lineTokens(span("hljs-variable language_", "this")).tokens).toEqual([[KEYWORD, 0, 4]]);
    expect(lineTokens("&#x27;&#39;").text).toBe("''");
  });
});

describe("AT-LLC-02 (INV-86 (e)) layerLineHtml: chunks for a long colored line", () => {
  // Why: through the product's own Segmenter, so a wrong granularity there fails these cuts
  let productColors;
  const layerLineHtml = (html) => productColors.makeLayerLine(html);
  beforeAll(() => {
    productColors = new LongLineColors(document.createElement("div"));
  });
  afterAll(() => productColors.stop());
  const long = (n) => span("hljs-string", "y".repeat(n));

  it("(a) up to CONFIG.codeEdit.longLineChars characters, and a line with no span: as it is", () => {
    expect(layerLineHtml(long(LONG))).toBe(long(LONG));
    expect(layerLineHtml("y".repeat(LONG + 1))).toBe("y".repeat(LONG + 1));
  });

  it("(b) over it: chunks of CONFIG.codeEdit.lineChunkChars characters, no token span, the same text; a token over a cut is in both chunks", () => {
    const chunks = chunksOf(layerLineHtml(long(CHUNK * 2 + 5)));
    expect(chunks.map((chunk) => chunk.textContent.length)).toEqual([CHUNK, CHUNK, 5]);
    expect(chunks.map((chunk) => chunk.getAttribute("data-tokens"))).toEqual([`[[${STRING},0,${CHUNK}]]`, `[[${STRING},0,${CHUNK}]]`, `[[${STRING},0,5]]`]);
    expect(chunks.every((chunk) => chunk.children.length === 0)).toBe(true);
  });

  it("(c) the text escaped; the tokens of a chunk are local to it", () => {
    const html = `${"&lt;".repeat(CHUNK)}${span("hljs-keyword", "if")}`;
    const [first, second] = chunksOf(layerLineHtml(html));
    expect(first.textContent).toBe("<".repeat(CHUNK));
    expect(second.getAttribute("data-tokens")).toBe(`[[${KEYWORD},0,2]]`);
    expect(layerLineHtml(html)).toContain("&lt;");
  });

  it("(d) a cut leaves a surrogate pair and a combining mark with their characters", () => {
    const pair = String.fromCodePoint(0x1f600);
    const texts = chunksOf(layerLineHtml(span("hljs-string", pair.repeat(CHUNK)))).map((chunk) => chunk.textContent);
    expect(texts.join("")).toBe(pair.repeat(CHUNK));
    for (const text of texts) expect(text.length % 2).toBe(0);
    const mark = String.fromCharCode(0x3099);
    const [first] = chunksOf(layerLineHtml(span("hljs-string", `${"y".repeat(CHUNK - 1)}a${mark}${"y".repeat(10)}`)));
    expect(first.textContent.endsWith(mark)).toBe(true);
  });

  it("(e) a zero-width joiner and a variation selector stay with their characters, in a line of wide characters too", () => {
    const kana = String.fromCharCode(0x3042);
    const joiner = String.fromCharCode(0x200d);
    const selector = String.fromCharCode(0xfe0f);
    const texts = chunksOf(layerLineHtml(span("hljs-string", `${kana.repeat(CHUNK - 1)}${joiner}${kana}${selector}${kana.repeat(10)}`))).map((chunk) => chunk.textContent);
    expect(texts[0].endsWith(selector)).toBe(true);
    expect(texts[1].startsWith(kana)).toBe(true);
  });

  it.each([
    ["an emoji and its skin tone", String.fromCodePoint(0x1f44d, 0x1f3fd)],
    ["a flag (two regional indicators)", String.fromCodePoint(0x1f1ef, 0x1f1f5)],
    ["a keycap", `1${String.fromCharCode(0xfe0f, 0x20e3)}`],
    ["a letter and a mark of U+1AB0..", `a${String.fromCharCode(0x1ab0)}`],
    ["a Thai letter and its vowel mark", String.fromCharCode(0x0e01, 0x0e34)],
    ["a Devanagari letter and its vowel sign", String.fromCharCode(0x0915, 0x093f)],
  ])("(g) a cut leaves %s together", (_name, cluster) => {
    // Why: the cluster's first character is the last one before the cut, where a cut would split it
    const text = `${"y".repeat(CHUNK - 1)}${cluster}${"y".repeat(10)}`;
    const [first, second] = chunksOf(layerLineHtml(span("hljs-string", text))).map((chunk) => chunk.textContent);
    expect(first.endsWith(cluster)).toBe(true);
    expect(first + second).toBe(text);
  });

  it.each([0, 1, 2, 3])("(h) a row of flags after %i characters: every cut falls between two flags", (lead) => {
    // Spec: INV-86 (e)
    const flag = String.fromCodePoint(0x1f1ef, 0x1f1f5);
    const text = `${"y".repeat(lead)}${flag.repeat(400)}`;
    const texts = chunksOf(layerLineHtml(span("hljs-string", text))).map((chunk) => chunk.textContent);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.join("")).toBe(text);
    const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ index }) => index));
    let cut = 0;
    for (const part of texts) {
      cut += part.length;
      expect(cut === text.length || boundaries.has(cut)).toBe(true);
    }
  });

  it("(f) isChunkedLine tells a chunked line", () => {
    expect(isChunkedLine(layerLineHtml(long(LONG + 1)))).toBe(true);
    expect(isChunkedLine(long(10))).toBe(false);
  });
});

describe("AT-LLC-03 (INV-86 (e)) editedTokens: a chunk's tokens after an edit in its text", () => {
  it("(z) tokens go through data-tokens as JSON: none, one and two; no attribute reads as none", () => {
    // Spec: INV-86 (e)
    for (const tokens of [[], [[3, 0, 5]], [[3, 0, 5], [0, 6, 8]]]) expect(tokensFromJson(tokensJson(tokens))).toEqual(tokens);
    expect(tokensFromJson(null)).toEqual([]);
  });

  it("(y) lineFeedsIn counts the line feeds of a text", () => {
    // Spec: INV-86 (a)
    expect(["", "ab", "a"+String.fromCharCode(10), String.fromCharCode(10).repeat(3)].map(lineFeedsIn)).toEqual([0, 0, 1, 3]);
  });

  const tokens = [
    [STRING, 2, 5],
    [KEYWORD, 8, 10],
  ];

  it("(a) a character typed in a token takes its color; those after it move", () => {
    expect(editedTokens(tokens, 3, 0, 1)).toEqual([
      [STRING, 2, 6],
      [KEYWORD, 9, 11],
    ]);
  });

  it("(b) at a token's start it stays out of the token; at its end too", () => {
    expect(editedTokens(tokens, 2, 0, 1)[0]).toEqual([STRING, 3, 6]);
    expect(editedTokens(tokens, 5, 0, 1)[0]).toEqual([STRING, 2, 5]);
  });

  it("(c) a removal over a token's end cuts it; one over a whole token drops it", () => {
    expect(editedTokens(tokens, 4, 3, 0)).toEqual([
      [STRING, 2, 4],
      [KEYWORD, 5, 7],
    ]);
    expect(editedTokens(tokens, 1, 6, 0)).toEqual([[KEYWORD, 2, 4]]);
  });
});

describe("AT-LLC-04 (INV-86 (e)) tokensByLine: a chunk's tokens cut at its line feeds", () => {
  it("(a) a token over a line feed is in both lines, the line feed outside it; a token on the line feed alone is in none", () => {
    const starts = [0, 3, 6, 7];
    const ends = [2, 5, 6, 9];
    const tokens = [
      [STRING, 1, 4],
      [KEYWORD, 5, 6],
      [STRING, 6, 9],
    ];
    expect(tokensByLine(tokens, starts, ends)).toEqual([[[STRING, 1, 2]], [[STRING, 0, 1]], [], [[STRING, 0, 2]]]);
  });

  it("(b) one token over 12,000 lines: a part in each line, in one pass", () => {
    const starts = Array.from({ length: 12000 }, (_, i) => i * 2);
    const ends = starts.map((start) => start + 1);
    const lines = tokensByLine([[STRING, 0, 24000]], starts, ends);
    expect(lines).toHaveLength(12000);
    expect(lines.every((line) => line.length === 1 && line[0][1] === 0 && line[0][2] === 1)).toBe(true);
  });
});

describe("AT-LLC-05 (INV-86 (e)) LongLineColors: chunks near the screen colored by highlights", () => {
  let registry;
  let colors;
  let root;
  let places;

  class FakeHighlight extends Set {
    priority = 0;
  }
  class FakeRange {
    constructor(init) {
      Object.assign(this, init);
    }
  }

  const longLine = () => span("hljs-string", "y".repeat(CHUNK + 5));
  const stringRanges = () => registry.get("grsmd-code-string");
  const write = (html) => {
    root.innerHTML = layerLineHtml(html);
  };
  const putAt = (chunk, left, top = 0) => places.set(chunk, { left, right: left + 100, top, bottom: top + 20 });

  beforeEach(() => {
    registry = new Map();
    places = new Map();
    vi.stubGlobal("CSS", { highlights: registry });
    vi.stubGlobal("Highlight", FakeHighlight);
    vi.stubGlobal("StaticRange", FakeRange);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      return places.get(this) ?? { left: 0, right: 100, top: 0, bottom: 20 };
    });
    root = document.createElement("div");
    document.body.append(root);
    colors = new LongLineColors(root);
  });

  afterEach(() => {
    colors.stop();
    root.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("(a) isSupported asks for highlights and static ranges", () => {
    expect(LongLineColors.isSupported()).toBe(true);
    for (const name of ["Highlight", "StaticRange"]) {
      vi.stubGlobal(name, undefined);
      expect(LongLineColors.isSupported()).toBe(false);
      vi.stubGlobal(name, FakeHighlight);
    }
    vi.stubGlobal("CSS", {});
    expect(LongLineColors.isSupported()).toBe(false);
    vi.stubGlobal("CSS", { highlights: registry });
  });

  it("(b) no highlight is registered until a chunk has ranges, and none stays when no chunk has (a registered one costs every text box a look)", () => {
    write(longLine());
    expect(registry.size).toBe(0);
    const [first, second] = root.children;
    putAt(second, 90000);
    colors.colorNearScreen();
    expect(registry.size).toBe(1);
    expect(stringRanges().size).toBe(1);
    expect(stringRanges().priority).toBe(-1);
    const [range] = stringRanges();
    expect([range.startContainer, range.startOffset, range.endOffset]).toEqual([first.firstChild, 0, CHUNK]);
    putAt(first, 90000);
    colors.colorNearScreen();
    expect(registry.size).toBe(0);
  });

  it.each([
    ["right of the screen", (w) => [w + CONFIG.codeEdit.chunkMarginXPx, 0]],
    ["left of the screen", () => [-CONFIG.codeEdit.chunkMarginXPx - 100, 0]],
    ["below the screen", (w, h) => [0, h + CONFIG.codeEdit.chunkMarginYPx]],
    ["above the screen", () => [0, -CONFIG.codeEdit.chunkMarginYPx - 20]],
  ])("(c) a chunk just outside the margin, %s, has no ranges; a pixel nearer, it has", (_name, place) => {
    write(longLine());
    const [first, second] = root.children;
    putAt(second, 90000);
    const [left, top] = place(window.innerWidth, window.innerHeight);
    putAt(first, left, top);
    colors.colorNearScreen();
    expect(registry.size).toBe(0);
    putAt(first, left + Math.sign(window.innerWidth / 2 - left) * (left === 0 ? 0 : 1), top + Math.sign(window.innerHeight / 2 - top) * (top === 0 ? 0 : 1));
    colors.colorNearScreen();
    expect(registry.size).toBe(1);
  });

  it("(d) a scroll of any element and a resize color the chunks at once, in the event's own task; stop ends that", () => {
    write(longLine());
    const scroller = document.createElement("div");
    root.append(scroller);
    scroller.dispatchEvent(new Event("scroll"));
    expect(stringRanges().size).toBe(2);
    const [first] = root.children;
    putAt(first, 90000);
    window.dispatchEvent(new Event("resize"));
    expect(stringRanges().size).toBe(1);
    colors.stop();
    expect(registry.size).toBe(0);
    document.dispatchEvent(new Event("scroll"));
    expect(registry.size).toBe(0);
  });

  it("(e) readColoredPlaces, releaseChunks and putChunks: a block written again keeps its chunks colored at once, by their line and place in it; the old ones lose their ranges", () => {
    write(longLine());
    const [first, second] = root.children;
    putAt(first, 90000);
    colors.colorNearScreen();
    const taken = colors.readColoredPlaces([root]);
    expect(taken).toEqual(new Map([[0, new Set([1])]]));
    expect(registry.size).toBeGreaterThan(0);
    colors.releaseChunks([root]);
    expect(registry.size).toBe(0);
    write(longLine());
    colors.putChunks([root], taken, { first: 1, replaced: 0, added: 0 });
    const [range] = stringRanges();
    expect(range.startContainer).toBe(root.children[1].firstChild);
    expect(second.isConnected).toBe(false);
  });

  it("(e-2) putChunks: every chunk of the lines the edit made is colored, more chunks than before too; a line after them keeps its own chunks' state, moved by the lines added", () => {
    const block = (...lines) => lines.map((html) => `${layerLineHtml(html)}\n`).join("");
    root.innerHTML = block(span("hljs-string", "y".repeat(LONG + 1)), longLine());
    const [, far, near] = root.children;
    putAt(far, 90000);
    for (const chunk of root.children) if (chunk !== far) putAt(chunk, 0);
    colors.colorNearScreen();
    const taken = colors.readColoredPlaces([root]);
    expect(taken).toEqual(new Map([[0, new Set([0])], [1, new Set([1])]]));
    colors.releaseChunks([root]);
    root.innerHTML = block(span("hljs-string", "y".repeat(CHUNK * 2 + 5)), "x", longLine());
    colors.putChunks([root], taken, { first: 0, replaced: 1, added: 2 });
    const colored = new Set([...stringRanges()].map((range) => range.startContainer.parentElement));
    const chunks = [...root.querySelectorAll(".code-edit-chunk")];
    expect(chunks.map((chunk) => colored.has(chunk))).toEqual([true, true, true, false, true]);
    expect(near.isConnected).toBe(false);
  });

  it("(f) readColoredPlaces with no chunk in the layer gives none", () => {
    expect(colors.readColoredPlaces([root]).size).toBe(0);
  });

  it("(g) noteEdit: the chunk's tokens follow an edit in its text, colored again if it was; a chunk not colored only keeps them", () => {
    write(longLine());
    const [first, second] = root.children;
    putAt(second, 90000);
    colors.colorNearScreen();
    first.firstChild.data = `${first.firstChild.data.slice(0, 3)}a${first.firstChild.data.slice(3)}`;
    colors.noteEdit(first.firstChild, 3, 0, 1);
    expect(first.getAttribute("data-tokens")).toBe(`[[${STRING},0,${CHUNK + 1}]]`);
    expect([...stringRanges()][0].endOffset).toBe(CHUNK + 1);
    second.firstChild.data = `ab${second.firstChild.data}`;
    colors.noteEdit(second.firstChild, 0, 0, 2);
    expect(second.getAttribute("data-tokens")).toBe(`[[${STRING},2,7]]`);
    expect(stringRanges().size).toBe(1);
  });

  it("(h) noteEdit in text outside a chunk does nothing", () => {
    const holder = document.createElement("div");
    holder.textContent = "abc";
    expect(() => colors.noteEdit(holder.firstChild, 0, 0, 1)).not.toThrow();
  });

  it("(i) noteEdit of a line feed cuts the chunk: one line a chunk, the line feed between them, the tokens with their parts, the parts colored", () => {
    write(span("hljs-string", "y".repeat(LONG + 11)));
    const [chunk] = root.children;
    colors.colorNearScreen();
    const text = chunk.firstChild.data;
    chunk.firstChild.data = `${text.slice(0, 5)}\n${text.slice(5)}`;
    colors.noteEdit(chunk.firstChild, 5, 0, 1);
    const parts = [...root.children];
    expect(parts.map((part) => part.textContent)).toEqual([text.slice(0, 5), text.slice(5)]);
    expect(root.textContent).toBe(`${text.slice(0, 5)}\n${text.slice(5)}`);
    expect(parts[0].nextSibling.data).toBe("\n");
    expect(parts.map((part) => part.getAttribute("data-tokens"))).toEqual([`[[${STRING},0,5]]`, `[[${STRING},0,${text.length - 5}]]`]);
    expect(stringRanges().size).toBe(2);
  });

  it("(j) two line feeds in one edit: three parts", () => {
    write(span("hljs-string", "y".repeat(LONG + 11)));
    const [chunk] = root.children;
    const text = chunk.firstChild.data;
    chunk.firstChild.data = `ab\ncd\n${text}`;
    colors.noteEdit(chunk.firstChild, 0, 0, 6);
    expect([...root.children].map((part) => part.textContent)).toEqual(["ab", "cd", text]);
  });

  it("(k) a key at the cut inside a word: the word goes on in the next chunk, so the character takes its color", () => {
    write(longLine());
    const [first] = root.children;
    first.firstChild.data = `${first.firstChild.data}z`;
    colors.noteEdit(first.firstChild, CHUNK, 0, 1);
    expect(first.getAttribute("data-tokens")).toBe(`[[${STRING},0,${CHUNK + 1}]]`);
  });

  it("(l) a key at the end of a token that ends the line stays out of it", () => {
    write(`${span("hljs-string", "y".repeat(LONG + 1))}`);
    const [chunk] = root.children;
    chunk.firstChild.data = `${chunk.firstChild.data}z`;
    colors.noteEdit(chunk.firstChild, LONG + 1, 0, 1);
    expect(chunk.getAttribute("data-tokens")).toBe(`[[${STRING},0,${LONG + 1}]]`);
  });

  it("(m) a range ends at the text's end when a token runs past it, and an emptied chunk has none", () => {
    write(longLine());
    const [first, second] = root.children;
    first.firstChild.data = "abc";
    second.textContent = "";
    colors.colorNearScreen();
    const [range] = stringRanges();
    expect(stringRanges().size).toBe(1);
    expect(range.endOffset).toBe(3);
  });

  it("(n) print: colorAll colors every chunk, near the screen or not; colorNearScreen goes back", () => {
    write(longLine());
    const [first] = root.children;
    putAt(first, 90000);
    colors.colorAll();
    expect(stringRanges().size).toBe(2);
    colors.colorNearScreen();
    expect(stringRanges().size).toBe(1);
  });

  it("(p) colorNearScreenSoon: the frame's callback colors the chunks near the screen and takes the others' ranges, once however many edits; nothing with no chunk; stop cancels it", () => {
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", (id) => frames.splice(id - 1, 1));
    colors.colorNearScreenSoon();
    expect(frames).toHaveLength(0);
    write(span("hljs-string", "y".repeat(CHUNK * 5)));
    const parts = [...root.children];
    putAt(parts[0], 90000);
    colors.colorAll();
    colors.colorNearScreenSoon();
    colors.colorNearScreenSoon();
    expect(frames).toHaveLength(1);
    frames.shift()();
    expect(stringRanges().size).toBe(4);
    colors.colorNearScreenSoon();
    colors.stop();
    expect(frames).toHaveLength(0);
  });

  it("(q) colorNearScreen reads every place before it changes a range (a read after a change could ask for a layout again)", () => {
    write(span("hljs-string", "y".repeat(CHUNK * 3)));
    const order = [];
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(() => (order.push("read"), { left: 0, right: 100, top: 0, bottom: 20 }));
    const add = FakeHighlight.prototype.add;
    vi.spyOn(FakeHighlight.prototype, "add").mockImplementation(function (range) {
      order.push("color");
      return add.call(this, range);
    });
    colors.colorNearScreen();
    expect(order).toEqual(["read", "read", "read", "color", "color", "color"]);
  });

  it("(r) noteEdit of 12,000 line feeds in one paste: 12,001 parts, the tokens with their lines, in one pass (no recursion: 10,000 overflowed the stack)", () => {
    write(span("hljs-string", "y".repeat(LONG + 11)));
    const chunk = root.firstElementChild; // Why: not root.children: jsdom keeps a live collection up to date on every node inserted
    colors.colorNearScreen();
    const pasted = "1\n".repeat(12000);
    chunk.firstChild.data = `ab${pasted}${chunk.firstChild.data.slice(2)}`;
    // Why: the CPU time of this process, not the clock: other work on the machine stretches the clock up to tenfold
    const cpuMs = () => (process.cpuUsage().user + process.cpuUsage().system) / 1000;
    const began = cpuMs();
    colors.noteEdit(chunk.firstChild, 2, 0, pasted.length);
    expect(cpuMs() - began).toBeLessThan(2000);
    const parts = [...root.querySelectorAll(".code-edit-chunk")];
    expect(parts).toHaveLength(12001);
    expect(root.textContent).toBe(`ab${pasted}${"y".repeat(LONG + 9)}`);
    expect(parts[0].getAttribute("data-tokens")).toBe(`[[${STRING},0,3]]`);
    expect(parts[1].getAttribute("data-tokens")).toBe(`[[${STRING},0,1]]`);
    expect(parts.at(-1).getAttribute("data-tokens")).toBe(`[[${STRING},0,${LONG + 9}]]`);
    expect(stringRanges().size).toBe(12001);
  });

  it("(s) noteEdit of many line feeds: the parts go in by one call with one argument", () => {
    // Spec: INV-86 (e)
    // Why: 46,000 line feeds as arguments overflow jsdom's stack, and take 10 s here on a loaded machine; the e2e pastes that many
    write(span("hljs-string", "y".repeat(3000)));
    const chunk = root.firstElementChild;
    const before = root.querySelectorAll(".code-edit-chunk").length;
    const after = vi.spyOn(chunk, "after");
    const pasted = "\n".repeat(2000);
    chunk.firstChild.data = `ab${pasted}${chunk.firstChild.data.slice(2)}`;
    colors.noteEdit(chunk.firstChild, 2, 0, pasted.length);
    expect(after.mock.calls.map((args) => args.length)).toEqual([1]);
    expect(root.querySelectorAll(".code-edit-chunk")).toHaveLength(before + 2000);
    expect(root.textContent).toBe(`ab${pasted}${"y".repeat(2998)}`);
  });

  it("(o) clear leaves no range and no highlight", () => {
    write(longLine());
    colors.colorNearScreen();
    colors.clear();
    expect(registry.size).toBe(0);
  });
});

describe("AT-LLC-06 (INV-86 (e)) style.css: a long line has the colors of the rest of the text", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../css/style.css"), "utf8").replace(/\r\n/g, "\n");
  const declarations = (selector) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    return Object.fromEntries([...body.matchAll(/(color|background-color): ([^;]+);/g)].map((m) => [m[1], m[2]]));
  };
  const GROUPS = [
    ["keyword", "variable.language_"],
    ["title", "title.function_"],
    ["attr", "selector-id"],
    ["string", "meta .hljs-string"],
    ["built-in", "symbol"],
    ["comment", "formula"],
    ["name", "selector-pseudo"],
    ["subst", "subst"],
    ["section", "section"],
    ["bullet", "bullet"],
    ["emphasis", "emphasis"],
    ["strong", "strong"],
    ["addition", "addition"],
    ["deletion", "deletion"],
  ];

  it.each(GROUPS)("%s: light and dark the same as .hljs-%s", (group, name) => {
    expect(declarations(`.code-edit-chunk::highlight(grsmd-code-${group})`)).toEqual(declarations(`.hljs-${name}`));
    expect(declarations(`body.dark .code-edit-chunk::highlight(grsmd-code-${group})`)).toEqual(declarations(`body.dark .hljs-${name}`));
  });
});
