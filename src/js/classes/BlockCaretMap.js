// INV-84: where a place in a rendered block is in the block's source,
// and back, and where a line is on screen. The rendered text is matched to
// the source character by character, whitespace left out: what the markup
// adds (list and quote markers, heading marks, a code fence, emphasis marks,
// link destinations, HTML tags) is passed over, and a rendered character
// with no match nearby (an entity, math drawn by KaTeX) is left unmatched.
// A heuristic: a link destination or a tag it does not see as one can take
// a few characters; the caret then lands a few characters off, never
// outside the block.

// Text that is not the block's own: KaTeX's MathML copy, a table's tab, a
// diagram's copy bar, controls and drawings.
const SKIP_SELECTOR = ".katex-mathml, .grsmd-table-tab, .diagram-copy-bar, button, svg, script, style, textarea";
// How far past the last match a rendered character is looked for.
const SEARCH_WINDOW = 64;
// What starts a line of the source and is not rendered as text: indent,
// quote markers, a list marker, a task box, heading marks.
const LINE_PREFIX = /^[ \t>]*(?:[-*+][ \t]+|\d{1,9}[.)][ \t]+)?(?:\[[ xX]\][ \t]+)?(?:#{1,6}(?:[ \t]+|$))?/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})[^\n]*(?:\n|$)/;
// A link's destination (from its "(" to its ")"; one pair of parentheses
// inside it, and a quoted title), and an HTML tag (not an autolink, whose
// text is shown). No nested quantifier (AT-STA-18).
const HIDDEN_PARTS = /\]\([^()\s]*(?:\([^()]*\)[^()\s]*)?(?:\s+(?:"[^"]*"|'[^']*'))?\)|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
const WHITESPACE = /\s/;
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
   * For each character of rendered that is not whitespace, the index of the
   * source character it matches, or -1.
   * @purity pure
   * @param {string} source - the block's source (as the editor shows it)
   * @param {string} rendered - the block's rendered text
   * @param {string|null} type - the block's type ("code": its fence line is passed over)
   * @returns {number[]}
   */
  static align(source, rendered, type) {
    const hidden = BlockCaretMap._hiddenMask(source);
    const out = [];
    let from = type === "code" ? BlockCaretMap._afterFence(source) : BlockCaretMap._skipPrefix(source, 0);
    for (let i = 0; i < rendered.length; i++) {
      const ch = rendered[i];
      if (WHITESPACE.test(ch)) continue;
      const limit = Math.min(source.length, from + SEARCH_WINDOW);
      let found = -1;
      for (let k = from; k < limit; k++) {
        if (source[k] === "\n") {
          k = BlockCaretMap._skipPrefix(source, k + 1) - 1;
          continue;
        }
        if (!hidden[k] && source[k] === ch) {
          found = k;
          break;
        }
      }
      out.push(found);
      if (found >= 0) from = found + 1;
    }
    return out;
  }

  /**
   * The source offset for a caret in the rendered text: count characters
   * that are not whitespace are before it; afterSpace: whitespace (or the
   * start) is right before it, so it goes before the next character, else
   * right after the one before (outside the markup between them).
   * @purity pure
   * @param {string} source
   * @param {string} rendered
   * @param {string|null} type
   * @param {number} count
   * @param {boolean} afterSpace
   * @returns {number}
   */
  static sourceOffsetFor(source, rendered, type, count, afterSpace) {
    const matches = BlockCaretMap.align(source, rendered, type);
    if (afterSpace || count === 0) {
      for (let i = count; i < matches.length; i++) if (matches[i] >= 0) return matches[i];
    }
    for (let i = Math.min(count, matches.length) - 1; i >= 0; i--) if (matches[i] >= 0) return matches[i] + 1;
    return type === "code" ? BlockCaretMap._afterFence(source) : BlockCaretMap._skipPrefix(source, 0);
  }

  /**
   * The rendered place for a source offset: how many rendered characters
   * that are not whitespace come before it, and whether it is right after
   * one of them (false) or before the next (true: the offset is not right
   * after a matched character).
   * @purity pure
   * @param {string} source
   * @param {string} rendered
   * @param {string|null} type
   * @param {number} offset
   * @returns {{count: number, afterSpace: boolean}}
   */
  static renderedPlaceFor(source, rendered, type, offset) {
    const matches = BlockCaretMap.align(source, rendered, type);
    let count = 0;
    let last = -1;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i] < 0) continue;
      if (matches[i] >= offset) break;
      count = i + 1;
      last = matches[i];
    }
    return { count, afterSpace: last < 0 || last + 1 !== offset };
  }

  /**
   * The text of a rendered block, as the caret walks it.
   * @purity semi-pure-b
   * @param {Element} element
   * @returns {string}
   */
  static textOf(element) {
    let text = "";
    for (const node of BlockCaretMap._textNodes(element)) text += node.data;
    return text;
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
   * @returns {{count: number, afterSpace: boolean, lineOffset: number}|null}
   */
  static pointAt(element, x, y) {
    const caret = BlockCaretMap._caretFromPoint(x, y);
    if (!caret || !element.contains(caret.node) || caret.node.nodeType !== Node.TEXT_NODE) return null;
    let before = "";
    let found = false;
    for (const node of BlockCaretMap._textNodes(element)) {
      if (node === caret.node) {
        before += node.data.slice(0, caret.offset);
        found = true;
        break;
      }
      before += node.data;
    }
    if (!found) return null;
    let count = 0;
    for (const ch of before) if (!WHITESPACE.test(ch)) count++;
    const afterSpace = before.length === 0 || WHITESPACE.test(before[before.length - 1]);
    const lineOffset = BlockCaretMap.lineOffsetOf(element, count, afterSpace);
    return lineOffset === null ? null : { count, afterSpace, lineOffset };
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
      for (let i = 0; i < data.length; i++) {
        if (WHITESPACE.test(data[i])) continue;
        last = { node, i };
        if (seen === wanted) return BlockCaretMap._charTop(element, node, i);
        seen++;
      }
    }
    return last ? BlockCaretMap._charTop(element, last.node, last.i) : null;
  }

  /**
   * The top of the caret's line in a textarea, from the textarea's top: a
   * hidden copy with the same text box is measured (the caret is a mark
   * there, with the rest of the text after it, so the wrapping is the same).
   * @purity semi-pure-b
   * @param {HTMLTextAreaElement} textarea
   * @param {number} offset
   * @returns {number}
   */
  static caretOffsetIn(textarea, offset) {
    const style = getComputedStyle(textarea);
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
    const value = textarea.value;
    const mark = document.createElement("span");
    mark.textContent = "\u200b"; // zero width: the caret's place
    copy.append(document.createTextNode(value.slice(0, offset)), mark, document.createTextNode(value.slice(offset)));
    document.body.append(copy);
    const top = mark.getBoundingClientRect().top - copy.getBoundingClientRect().top;
    copy.remove();
    return top;
  }

  /**
   * An anchor for a block rendered after a commit (INV-84): the block's top
   * goes where the line of the caret is then kept where it was in the
   * editor. line: {offset: the line's top from the block's top in the
   * editor, sourceOffset: the caret in the source}. Without a line, or when
   * the caret is not found in the block, the anchor as it was (the block's
   * top, INV-46).
   * @purity semi-pure-b
   * @param {{offsetTop: number, line?: {offset: number, sourceOffset: number}}|null} anchor
   * @param {Element|null} element
   * @param {string} source - the block's source (as the editor showed it)
   * @param {string|null} type
   * @returns {{offsetTop: number}|null}
   */
  static lineAnchor(anchor, element, source, type) {
    if (!anchor || !anchor.line || !element) return anchor;
    const plain = { offsetTop: anchor.offsetTop };
    if (anchor.line.sourceOffset > source.length) return plain;
    const place = BlockCaretMap.renderedPlaceFor(source, BlockCaretMap.textOf(element), type, anchor.line.sourceOffset);
    const offset = BlockCaretMap.lineOffsetOf(element, place.count, place.afterSpace);
    if (offset === null) return plain;
    return { offsetTop: anchor.offsetTop + anchor.line.offset - offset };
  }

  // ---- internals ----

  /**
   * @purity pure
   * @param {string} source
   * @returns {Uint8Array} 1 where a character is in a link destination or a tag
   */
  static _hiddenMask(source) {
    const mask = new Uint8Array(source.length);
    for (const m of source.matchAll(HIDDEN_PARTS)) {
      // a link's "]" is shown text's end: only from its "(" on
      const start = m[0][0] === "]" ? m.index + 1 : m.index;
      mask.fill(1, start, m.index + m[0].length);
    }
    return mask;
  }

  /**
   * @purity pure
   * @param {string} source
   * @param {number} at - the start of a line
   * @returns {number} past the line's prefix
   */
  static _skipPrefix(source, at) {
    const m = LINE_PREFIX.exec(source.slice(at, at + 64));
    return at + (m ? m[0].length : 0);
  }

  /**
   * @purity pure
   * @param {string} source
   * @returns {number} past the opening fence line, or 0 (an indented block)
   */
  static _afterFence(source) {
    const m = FENCE_LINE.exec(source);
    return m ? m[0].length : 0;
  }

  /**
   * The text nodes of a rendered block, in order, without those of SKIP_SELECTOR.
   * @purity semi-pure-b
   * @param {Element} element
   * @returns {Text[]}
   */
  static _textNodes(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      /** @purity semi-pure-b */
      acceptNode: (node) => (node.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

  /**
   * The caret at a point (caretPositionFromPoint, or WebKit's caretRangeFromPoint).
   * @purity semi-pure-b
   * @returns {{node: Node, offset: number}|null}
   */
  static _caretFromPoint(x, y) {
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
}
