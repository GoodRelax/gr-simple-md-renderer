import { countLines, countText, isSpace, renderedPlaceFor } from "../caretMatching.js";

// INV-84: where a place in a rendered block is, read from the DOM: the
// rendered text as the caret walks it, the caret at a point, the top of a
// line in the block and in an editor. Matching the rendered text to the
// source is caretMatching.js (pure); this class reads and measures.

// Text that is not the block's own: KaTeX's MathML copy, a table's tab, a
// diagram's copy bar, controls and drawings.
const SKIP_SELECTOR = ".katex-mathml, .grsmd-table-tab, .diagram-copy-bar, button, svg, script, style, textarea";
// A mark with no width: a place in the measuring copy, not a character.
const ZERO_WIDTH = "\u200b";
// Copied to the measuring copy of an editor: what places its text.
const MIRROR_PROPS = [
  "boxSizing",
  "width",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "textIndent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
];

export default class BlockCaretMap {
  /**
   * The text of a rendered block, as the caret walks it.
   * @purity semi-pure-b
   * @param {Element} element
   * @returns {string}
   */
  static textOf(element) {
    return BlockCaretMap._textNodes(element)
      .map((node) => node.data)
      .join("");
  }

  /**
   * The caret at a point of the page (caretPositionFromPoint, or WebKit's
   * caretRangeFromPoint), or null.
   * @purity semi-pure-b
   * @param {number} x
   * @param {number} y
   * @returns {{node: Node, offset: number}|null}
   */
  static caretAt(x, y) {
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return null;
  }

  /**
   * Where a point is in a rendered block: how many characters that are not
   * whitespace are before the caret there, whether whitespace is right
   * before it, and the top of its line from the block's top. null when the
   * point is not on the block's text.
   * @purity semi-pure-b
   * @param {Element} element
   * @param {number} x
   * @param {number} y
   * @returns {{count: number, afterSpace: boolean, lineOffset: number, index: number, text: string}|null}
   *   index: the caret's index in text, which is textOf(element) at the press
   */
  static pointAt(element, x, y) {
    const caret = BlockCaretMap.caretAt(x, y);
    if (!caret || !element.contains(caret.node) || caret.node.nodeType !== Node.TEXT_NODE) return null;
    let count = 0;
    let index = 0;
    let last = -1; // the last character before the caret (its code)
    let found = false;
    const nodes = BlockCaretMap._textNodes(element);
    for (const node of nodes) {
      const end = node === caret.node ? caret.offset : node.data.length;
      count += countText(node.data, end);
      index += end;
      if (end > 0) last = node.data.charCodeAt(end - 1);
      if (node === caret.node) {
        found = true;
        break;
      }
    }
    if (!found) return null;
    const afterSpace = last < 0 || isSpace(last);
    // the character measured is in the caret's own text node when it can be
    const data = caret.node.data;
    let at = -1;
    if (!afterSpace && caret.offset > 0) at = caret.offset - 1;
    else for (let i = caret.offset; i < data.length && at < 0; i++) if (!isSpace(data.charCodeAt(i))) at = i;
    const lineOffset = at >= 0 ? BlockCaretMap._charTop(element, caret.node, at) : BlockCaretMap.lineOffsetOf(element, count, afterSpace);
    if (lineOffset === null) return null;
    return { count, afterSpace, lineOffset, index, text: nodes.map((node) => node.data).join("") };
  }

  /**
   * The top of the line of a rendered place, from the block's top: the
   * character the caret is after (afterSpace false), else the one it is
   * before (the last one at the end). null when there is none.
   * @purity semi-pure-b
   * @param {Element} element
   * @param {number} count
   * @param {boolean} afterSpace
   * @returns {number|null}
   */
  static lineOffsetOf(element, count, afterSpace) {
    const wanted = !afterSpace && count > 0 ? count - 1 : count;
    let seen = 0;
    let last = null;
    for (const node of BlockCaretMap._textNodes(element)) {
      const data = node.data;
      const inNode = countText(data, data.length);
      if (inNode === 0) continue;
      if (seen + inNode <= wanted) {
        // the whole node is before it: only its last character is kept
        seen += inNode;
        last = node;
        continue;
      }
      for (let i = 0; i < data.length; i++) {
        if (isSpace(data.charCodeAt(i))) continue;
        if (seen === wanted) return BlockCaretMap._charTop(element, node, i);
        seen++;
      }
    }
    if (!last) return null;
    let i = last.data.length - 1;
    while (i > 0 && isSpace(last.data.charCodeAt(i))) i--;
    return BlockCaretMap._charTop(element, last, i);
  }

  /**
   * The top of the caret's line in a textarea, from the textarea's top: the
   * line of the character the caret is after, else of the one it is before
   * (the last one at the end), as pointAt and lineOffsetOf take it in the
   * rendered block (a caret at a wrap is then on the same line in both).
   * When no line wraps (most code), it is counted: the top of the first line
   * plus the lines before that character, each as high as one line of a
   * small hidden copy with the same text box. Otherwise the copy holds the
   * text up to the end of that character's word, the character in a mark
   * (the text after that word does not move it), and the mark is measured;
   * when more than maxChars come before the caret, it is not measured (null:
   * laying out the copy costs as much as the editor itself). The copy is
   * added to the page for the measure and removed.
   * @purity non-pure
   * @param {HTMLTextAreaElement} textarea
   * @param {number} offset
   * @param {number} [maxChars]
   * @returns {number|null}
   */
  static caretOffsetIn(textarea, offset, maxChars = Infinity) {
    const value = textarea.value;
    const style = getComputedStyle(textarea);
    const one = BlockCaretMap._measureCopy(style, ["x"], ZERO_WIDTH, "x\nx");
    const at = BlockCaretMap._lineCharIn(value, offset);
    const lines = countLines(value, value.length);
    const content = textarea.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (Math.abs(content - lines * one.lineHeight) < one.lineHeight / 2) {
      return one.firstTop + (countLines(value, at < 0 ? offset : at) - 1) * one.lineHeight;
    }
    if (offset > maxChars) return null;
    // no character at all: the caret's place itself
    if (at < 0) return BlockCaretMap._measureCopy(style, [value.slice(0, offset)], ZERO_WIDTH, "").markTop;
    let end = at + 1;
    while (end < value.length && !isSpace(value.charCodeAt(end))) end++;
    return BlockCaretMap._measureCopy(style, [value.slice(0, at)], value[at], value.slice(at + 1, end)).markTop;
  }

  /**
   * The rendered place of a caret line of a commit (INV-84) in the block
   * rendered after it: line.sourceOffset is the caret in the source. null
   * when the caret is past the source (the block was cut).
   * @purity semi-pure-b
   * @param {{offset: number, sourceOffset: number}} line
   * @param {Element} element
   * @param {string} source - the block's source (as the editor showed it)
   * @param {string|null} type
   * @returns {{count: number, afterSpace: boolean}|null}
   */
  static placeOfLine(line, element, source, type) {
    if (line.sourceOffset > source.length) return null;
    return renderedPlaceFor(source, BlockCaretMap.textOf(element), type, line.sourceOffset);
  }

  /**
   * An anchor for a block rendered after a commit (INV-84): the block's top
   * goes where the line of the caret is then kept where it was in the
   * editor. anchor.line: {offset: the line's top from the block's top in
   * the editor, ...}; place: placeOfLine of that line in element. Without a
   * line or a place, or when the place has no character, the block's top
   * stays where it was (INV-46).
   * @purity semi-pure-b
   * @param {{offsetTop: number, line?: {offset: number}}|null} anchor
   * @param {Element|null} element
   * @param {{count: number, afterSpace: boolean}|null} place
   * @returns {{offsetTop: number}|null}
   */
  static lineAnchor(anchor, element, place) {
    if (!anchor || !anchor.line || !element) return anchor;
    const plain = { offsetTop: anchor.offsetTop };
    if (!place) return plain;
    const offset = BlockCaretMap.lineOffsetOf(element, place.count, place.afterSpace);
    if (offset === null) return plain;
    return { offsetTop: anchor.offsetTop + anchor.line.offset - offset };
  }

  // ---- internals ----

  /**
   * The character whose line is the caret's (see caretOffsetIn): the one
   * before the caret when it is not whitespace, else the next one that is
   * not, else the last one that is not; -1 when there is none.
   * @purity pure
   * @param {string} value
   * @param {number} offset
   * @returns {number}
   */
  static _lineCharIn(value, offset) {
    if (offset > 0 && !isSpace(value.charCodeAt(offset - 1))) return offset - 1;
    for (let i = offset; i < value.length; i++) if (!isSpace(value.charCodeAt(i))) return i;
    for (let i = offset - 1; i >= 0; i--) if (!isSpace(value.charCodeAt(i))) return i;
    return -1;
  }

  /**
   * A hidden copy of a textarea's text box (style), holding the parts of
   * before, a mark (one character, or a zero-width one for a place), then
   * after: where the mark is from the copy's top, and with "x" before and
   * "x\nx" after, the top of the first line and the height of one line.
   * The copy is added to the page and removed.
   * @purity non-pure
   * @param {CSSStyleDeclaration} style
   * @param {string[]} before
   * @param {string} markText
   * @param {string} after
   * @returns {{markTop: number, firstTop: number, lineHeight: number}}
   */
  static _measureCopy(style, before, markText, after) {
    const copy = document.createElement("div");
    for (const prop of MIRROR_PROPS) copy.style[prop] = style[prop];
    Object.assign(copy.style, {
      position: "absolute",
      visibility: "hidden",
      top: "0",
      left: "0",
      height: "auto",
      overflow: "hidden",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
    });
    const mark = document.createElement("span");
    mark.textContent = markText;
    const tail = document.createElement("span");
    tail.textContent = after;
    copy.append(...before.map((text) => document.createTextNode(text)), mark, tail);
    document.body.append(copy);
    const top = copy.getBoundingClientRect().top;
    const markTop = mark.getBoundingClientRect().top - top;
    const rects = tail.getClientRects();
    // "x\nx" after the mark: its two lines give the line height
    const lineHeight = rects.length > 1 ? rects[rects.length - 1].top - rects[0].top : 0;
    copy.remove();
    return { markTop, firstTop: markTop, lineHeight };
  }

  /**
   * The text nodes of a rendered block, in order, without those of SKIP_SELECTOR.
   * @purity semi-pure-b
   * @param {Element} element
   * @returns {Text[]}
   */
  static _textNodes(element) {
    const nodes = [];
    // elements are visited too, so that a skipped one skips its whole
    // subtree (one check per element, not one per text node)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      /** @purity semi-pure-b */
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        return node.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    return nodes;
  }

  /**
   * @purity semi-pure-b
   * @returns {number|null} the top of one character, from the block's top
   */
  static _charTop(element, node, index) {
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    if (typeof range.getClientRects !== "function") return null; // no layout (jsdom)
    const rects = range.getClientRects();
    if (rects.length === 0) return null;
    return rects[0].top - element.getBoundingClientRect().top;
  }
}
