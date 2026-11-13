import { CONFIG } from "../config.js";
import { lineFeedsIn } from "../caretMatching.js";
import { CHUNK_CLASS, COLOR_GROUPS, TOKENS_ATTRIBUTE, editedTokens, layerLineHtml, tokensByLine, tokensFromJson, tokensJson } from "../longLineTokens.js";

// Spec: INV-86 (e).
// Why: a span a token leaves the layer up to 69 px off the textarea's one box in Chromium (spec 5.19.12)
// Why: ranges only near the screen: over a whole 30 KB line they took 420 ms a frame in Chromium, and 87 of them in one text node 885 ms in WebKit

const HIGHLIGHT_PREFIX = "grsmd-code-";

// Section: semi-pure-mutable

/**
 * @purity semi-pure-mutable
 * @param {Element} chunk
 * @returns {number[][]} [group, start, end]
 */
function readTokens(chunk) {
  return tokensFromJson(chunk.getAttribute(TOKENS_ATTRIBUTE));
}

/**
 * @purity semi-pure-mutable
 * @param {Element} chunk
 * @param {number} group
 * @param {number} at - the place of the edit
 * @param {number} length - the chunk's characters before the edit
 * @returns {boolean}
 */
function isContinuedInNextChunk(chunk, group, at, length) {
  if (at !== length) return false;
  const next = chunk.nextSibling;
  if (next?.nodeType !== Node.ELEMENT_NODE || !next.classList.contains(CHUNK_CLASS)) return false;
  const [firstToken] = readTokens(next);
  return firstToken !== undefined && firstToken[0] === group && firstToken[1] === 0;
}

/**
 * Why: a chunk holds no line feed, so the text and the other spans between chunks tell the lines
 * @purity semi-pure-mutable
 * @param {Element[]} elements - the blocks, in order
 * @returns {{chunk: Element, lineIndex: number, chunkIndex: number}[]}
 */
function readChunksByLine(elements) {
  const places = [];
  let lineIndex = 0;
  let chunkIndex = 0;
  for (const block of elements) {
    for (const node of block.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains(CHUNK_CLASS)) {
        places.push({ chunk: node, lineIndex, chunkIndex: chunkIndex++ });
        continue;
      }
      const feeds = lineFeedsIn(node.textContent);
      if (feeds === 0) continue;
      lineIndex += feeds;
      chunkIndex = 0;
    }
  }
  return places;
}

/**
 * @purity semi-pure-mutable
 * @param {Element} chunk
 * @param {number} count
 * @returns {Element[]} the chunk and the elements after it, count of them in all
 */
function readNextChunks(chunk, count) {
  const chunks = [chunk];
  for (let next = chunk.nextElementSibling; next && chunks.length < count; next = next.nextElementSibling) chunks.push(next);
  return chunks;
}

// Section: non-pure

/**
 * @purity non-pure
 * @param {Element} chunk
 * @param {number[][]} tokens - [group, start, end]
 */
function writeTokens(chunk, tokens) {
  chunk.setAttribute(TOKENS_ATTRIBUTE, tokensJson(tokens));
}

/**
 * Spec: INV-86 (e).
 * @purity non-pure
 * @param {Element} chunk
 */
function cutAtLineFeeds(chunk) {
  const node = chunk.firstChild;
  if (!node || !node.data.includes("\n")) return;
  const texts = node.data.split("\n");
  const starts = [];
  const ends = [];
  let at = 0;
  for (const text of texts) {
    starts.push(at);
    ends.push(at + text.length);
    at += text.length + 1;
  }
  const tokens = tokensByLine(readTokens(chunk), starts, ends);
  // Why: one argument however many line feeds: jsdom overflows its stack at 92,000 arguments
  const after = document.createDocumentFragment();
  for (let lineIndex = 1; lineIndex < texts.length; lineIndex++) {
    const part = document.createElement("span");
    part.className = CHUNK_CLASS;
    part.textContent = texts[lineIndex];
    writeTokens(part, tokens[lineIndex]);
    after.append("\n", part);
  }
  node.data = texts[0];
  writeTokens(chunk, tokens[0]);
  chunk.after(after);
}

/**
 * Spec: INV-86 (e).
 * Why: a scroll runs this in its own task, before the frame, so no frame shows a chunk uncolored, whichever element scrolls
 */
export default class LongLineColors {
  // Section: semi-pure-mutable

  /**
   * @purity semi-pure-mutable
   * @returns {boolean} the browser colors by CSS Custom Highlights (Safari: 17.2)
   */
  static isSupported() {
    return Boolean(globalThis.CSS?.highlights) && typeof Highlight === "function" && typeof StaticRange === "function" && typeof Intl.Segmenter === "function";
  }

  /**
   * Spec: INV-86 (e).
   * @purity semi-pure-mutable
   * @param {string} html - a line's highlight.js HTML
   * @returns {string}
   */
  makeLayerLine(html) {
    return layerLineHtml(html, this._graphemes);
  }

  /**
   * Spec: INV-86 (e).
   * @purity semi-pure-mutable
   * @param {Element[]} elements - the blocks, in order
   * @returns {Map<number, Set<number>>} the colored chunks: a line, from the first block's first line -> the chunks' places in it
   */
  readColoredPlaces(elements) {
    const coloredPlaces = new Map();
    if (this._chunks.length === 0) return coloredPlaces;
    for (const { chunk, lineIndex, chunkIndex } of readChunksByLine(elements)) {
      if (!this._coloredChunks.has(chunk)) continue;
      if (!coloredPlaces.has(lineIndex)) coloredPlaces.set(lineIndex, new Set());
      coloredPlaces.get(lineIndex).add(chunkIndex);
    }
    return coloredPlaces;
  }

  // Section: non-pure

  /**
   * @purity non-pure
   * @param {HTMLElement} layer - holds the chunks
   */
  constructor(layer) {
    this._layer = layer;
    this._chunks = layer.getElementsByClassName(CHUNK_CLASS); // Why: live, and only its length is read
    this._graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    this._highlights = new Map(); // Why: registered only while it has ranges: a registered one costs every text box a look (40 KB of lines: WebKit 19 -> 73 ms a frame)
    /** @type {Map<Element, {group: number, range: StaticRange}[]>} */
    this._coloredChunks = new Map();
    /** @type {number} the id of the frame asked for; 0: none is waiting */
    this._frame = 0;
    /** @purity non-pure */
    this._onFrame = () => {
      this._frame = 0;
      this.colorNearScreen();
    };
    /** @purity non-pure */
    this._onViewChanged = () => this.colorNearScreen();
    document.addEventListener("scroll", this._onViewChanged, { capture: true, passive: true });
    window.addEventListener("resize", this._onViewChanged);
  }

  /**
   * Spec: INV-86 (e).
   * @purity non-pure
   */
  colorNearScreen() {
    const { chunkMarginXPx: marginXPx, chunkMarginYPx: marginYPx } = CONFIG.codeEdit;
    const chunks = this._layer.querySelectorAll(`.${CHUNK_CLASS}`); // Why: a list made once: jsdom walks a live one again at each item
    const nearFlags = [];
    for (const chunk of chunks) {
      const { left, right, top, bottom } = chunk.getBoundingClientRect();
      nearFlags.push(right > -marginXPx && left < window.innerWidth + marginXPx && bottom > -marginYPx && top < window.innerHeight + marginYPx);
    }
    for (const [index, chunk] of chunks.entries()) {
      if (nearFlags[index]) this._color(chunk);
      else this._uncolor(chunk);
    }
  }

  /**
   * Spec: INV-86 (e).
   * Why: a frame callback runs before the paint, and the places it reads are the layout that frame needs anyway
   * @purity non-pure
   */
  colorNearScreenSoon() {
    if (this._chunks.length === 0 || this._frame !== 0) return;
    this._frame = requestAnimationFrame(this._onFrame);
  }

  /**
   * @purity non-pure
   * @param {Element} chunk
   */
  _color(chunk) {
    if (this._coloredChunks.has(chunk)) return;
    const node = chunk.firstChild;
    if (!node) return;
    const ranges = [];
    for (const [group, start, end] of readTokens(chunk)) {
      const range = new StaticRange({ startContainer: node, startOffset: start, endContainer: node, endOffset: Math.min(end, node.data.length) });
      this._registerHighlight(group);
      this._highlights.get(group).add(range);
      ranges.push({ group, range });
    }
    this._coloredChunks.set(chunk, ranges);
  }

  /**
   * @purity non-pure
   * @param {Element} chunk
   */
  _uncolor(chunk) {
    for (const { group, range } of this._coloredChunks.get(chunk) ?? []) {
      const highlight = this._highlights.get(group);
      highlight.delete(range);
      if (highlight.size > 0) continue;
      CSS.highlights.delete(HIGHLIGHT_PREFIX + COLOR_GROUPS[group][0]);
      this._highlights.delete(group);
    }
    this._coloredChunks.delete(chunk);
  }

  /**
   * @purity non-pure
   * @param {number} group
   */
  _registerHighlight(group) {
    if (this._highlights.has(group)) return;
    const highlight = new Highlight();
    highlight.priority = -1; // Why: under the Search's marks and the IME's underline
    CSS.highlights.set(HIGHLIGHT_PREFIX + COLOR_GROUPS[group][0], highlight);
    this._highlights.set(group, highlight);
  }

  /**
   * Spec: INV-86 (e).
   * @purity non-pure
   * @param {Element[]} elements - the blocks, in order
   */
  releaseChunks(elements) {
    if (this._chunks.length === 0) return;
    for (const { chunk } of readChunksByLine(elements)) this._uncolor(chunk);
  }

  /**
   * Spec: INV-86 (e).
   * @purity non-pure
   * @param {Element[]} elements - the blocks, in order
   * @param {Map<number, Set<number>>} coloredPlaces - from readColoredPlaces
   * @param {{first: number, replaced: number, added: number}} edit - the lines the edit replaced and those it made, from the first block's first line
   */
  putChunks(elements, coloredPlaces, { first, replaced, added }) {
    for (const { chunk, lineIndex, chunkIndex } of readChunksByLine(elements)) {
      const oldLineIndex = lineIndex < first ? lineIndex : lineIndex - added + replaced;
      if ((lineIndex >= first && lineIndex < first + added) || coloredPlaces.get(oldLineIndex)?.has(chunkIndex)) this._color(chunk);
    }
  }

  /**
   * Why: a chunk's open tag would be carried to the next line, among its text, if a chunk spanned two lines
   * @purity non-pure
   * @param {Text} node
   * @param {number} at
   * @param {number} removed
   * @param {number} inserted
   */
  noteEdit(node, at, removed, inserted) {
    const chunk = node.parentElement;
    if (!chunk?.classList.contains(CHUNK_CLASS)) return;
    const hadColor = this._coloredChunks.has(chunk);
    this._uncolor(chunk);
    const oldTokens = readTokens(chunk);
    const tokens = editedTokens(oldTokens, at, removed, inserted);
    // Why: typed at a cut inside a word, the word goes on in the next chunk
    const last = tokens.at(-1);
    if (last && last[2] === at && inserted > 0 && removed === 0 && isContinuedInNextChunk(chunk, last[0], at, node.data.length - inserted)) last[2] += inserted;
    writeTokens(chunk, tokens);
    const partCount = lineFeedsIn(node.data) + 1;
    cutAtLineFeeds(chunk);
    if (hadColor) for (const part of readNextChunks(chunk, partCount)) this._color(part);
  }

  /**
   * @purity non-pure
   */
  colorAll() {
    for (const chunk of this._layer.querySelectorAll(`.${CHUNK_CLASS}`)) this._color(chunk);
  }

  /**
   * @purity non-pure
   */
  clear() {
    for (const chunk of [...this._coloredChunks.keys()]) this._uncolor(chunk);
  }

  /**
   * @purity non-pure
   */
  stop() {
    document.removeEventListener("scroll", this._onViewChanged, { capture: true });
    window.removeEventListener("resize", this._onViewChanged);
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    this.clear();
  }
}
