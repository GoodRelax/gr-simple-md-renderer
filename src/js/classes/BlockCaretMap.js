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
   * source character it matches, or -1. It stops after maxCount characters,
   * or at the first match at or past stopAt (included).
   * @purity pure
   * @param {string} source - the block's source (as the editor shows it)
   * @param {string} rendered - the block's rendered text
   * @param {string|null} type - the block's type ("code": its fence line is
   *   passed over, and its lines have no markers)
   * @param {number} [maxCount]
   * @param {number} [stopAt]
   * @returns {number[]}
   */
  static align(source, rendered, type, maxCount = Infinity, stopAt = Infinity) {
    const code = type === "code";
    const hidden = code ? null : BlockCaretMap._hiddenMask(source);
    const out = [];
    let from = code ? BlockCaretMap._afterFence(source) : BlockCaretMap._skipPrefix(source, 0);
    for (let i = 0; i < rendered.length && out.length < maxCount; i++) {
      const ch = rendered.charCodeAt(i);
      if (BlockCaretMap._isSpace(ch)) continue;
      const limit = Math.min(source.length, from + SEARCH_WINDOW);
      let found = -1;
      for (let k = from; k < limit; k++) {
        const at = source.charCodeAt(k);
        if (at === 10 && !code) {
          k = BlockCaretMap._skipPrefix(source, k + 1) - 1;
          continue;
        }
        if (at === ch && !(hidden && hidden[k])) {
          found = k;
          break;
        }
      }
      out.push(found);
      if (found >= 0) {
        from = found + 1;
        if (found >= stopAt) break;
      }
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
   * @param {number} [index] - the caret's index in rendered: a code block
   *   shows its source as it is, so the source offset is found at once when
   *   the text before the caret is the same in both
   * @returns {number}
   */
  static sourceOffsetFor(source, rendered, type, count, afterSpace, index = -1) {
    if (type === "code" && index >= 0) {
      const start = BlockCaretMap._afterFence(source);
      if (source.startsWith(rendered.slice(0, index), start)) return start + index;
    }
    // the characters up to the caret, and a few after it to find the next match
    const matches = BlockCaretMap.align(source, rendered, type, count + SEARCH_WINDOW);
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
    if (type === "code") {
      const start = BlockCaretMap._afterFence(source);
      const index = offset - start;
      if (index >= 0 && index <= rendered.length && source.startsWith(rendered.slice(0, index), start)) {
        return { count: BlockCaretMap._countText(rendered, index), afterSpace: index === 0 || BlockCaretMap._isSpace(rendered.charCodeAt(index - 1)) };
      }
    }
    const matches = BlockCaretMap.align(source, rendered, type, Infinity, offset);
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
    return BlockCaretMap._textNodes(element)
      .map((node) => node.data)
      .join("");
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
    const caret = BlockCaretMap._caretFromPoint(x, y);
    if (!caret || !element.contains(caret.node) || caret.node.nodeType !== Node.TEXT_NODE) return null;
    let count = 0;
    let index = 0;
    let last = -1; // the last character before the caret (its code)
    let found = false;
    const nodes = BlockCaretMap._textNodes(element);
    for (const node of nodes) {
      const end = node === caret.node ? caret.offset : node.data.length;
      count += BlockCaretMap._countText(node.data, end);
      index += end;
      if (end > 0) last = node.data.charCodeAt(end - 1);
      if (node === caret.node) {
        found = true;
        break;
      }
    }
    if (!found) return null;
    const afterSpace = last < 0 || BlockCaretMap._isSpace(last);
    // the character measured is in the caret's own text node when it can be
    const data = caret.node.data;
    let at = -1;
    if (!afterSpace && caret.offset > 0) at = caret.offset - 1;
    else for (let i = caret.offset; i < data.length && at < 0; i++) if (!BlockCaretMap._isSpace(data.charCodeAt(i))) at = i;
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
      const inNode = BlockCaretMap._countText(data, data.length);
      if (inNode === 0) continue;
      if (seen + inNode <= wanted) {
        // the whole node is before it: only its last character is kept
        seen += inNode;
        last = node;
        continue;
      }
      for (let i = 0; i < data.length; i++) {
        if (BlockCaretMap._isSpace(data.charCodeAt(i))) continue;
        if (seen === wanted) return BlockCaretMap._charTop(element, node, i);
        seen++;
      }
    }
    if (!last) return null;
    let i = last.data.length - 1;
    while (i > 0 && BlockCaretMap._isSpace(last.data.charCodeAt(i))) i--;
    return BlockCaretMap._charTop(element, last, i);
  }

  /**
   * The top of the caret's line in a textarea, from the textarea's top. When
   * no line wraps (most code), it is counted: the top of the first line
   * plus the lines before it, each as high as one line of a small hidden
   * copy with the same text box. Otherwise the copy holds the text up to
   * the end of the caret's word, with the caret a mark in it (the text
   * after that word does not move it), and the mark is measured; when more
   * than maxChars come before the caret, it is not measured (null: laying
   * out the copy costs as much as the editor itself).
   * @purity semi-pure-b
   * @param {HTMLTextAreaElement} textarea
   * @param {number} offset
   * @param {number} [maxChars]
   * @returns {number|null}
   */
  static caretOffsetIn(textarea, offset, maxChars = Infinity) {
    const value = textarea.value;
    const style = getComputedStyle(textarea);
    const one = BlockCaretMap._measureCopy(style, ["x"], "x\nx");
    const lines = BlockCaretMap._countLines(value, value.length);
    const content = textarea.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (Math.abs(content - lines * one.lineHeight) < one.lineHeight / 2) {
      return one.firstTop + (BlockCaretMap._countLines(value, offset) - 1) * one.lineHeight;
    }
    if (offset > maxChars) return null;
    let end = offset;
    while (end < value.length && !BlockCaretMap._isSpace(value.charCodeAt(end))) end++;
    return BlockCaretMap._measureCopy(style, [value.slice(0, offset)], value.slice(offset, end)).markTop;
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
    // the place is found once per rendered block (the anchor is restored
    // again when the DOM is stable)
    const line = anchor.line;
    if (!line.found || line.found.element !== element) {
      line.found = { element, place: BlockCaretMap.renderedPlaceFor(source, BlockCaretMap.textOf(element), type, line.sourceOffset) };
    }
    const place = line.found.place;
    const offset = BlockCaretMap.lineOffsetOf(element, place.count, place.afterSpace);
    if (offset === null) return plain;
    return { offsetTop: anchor.offsetTop + anchor.line.offset - offset };
  }

  // ---- internals ----

  /**
   * Whitespace as /\s/ sees it (by its code, to keep long texts fast).
   * @purity pure
   * @param {number} code
   * @returns {boolean}
   */
  static _isSpace(code) {
    if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
    if (code < 160) return false;
    return code === 160 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
  }

  /**
   * @purity pure
   * @param {string} text
   * @param {number} end
   * @returns {number} the characters before end that are not whitespace
   */
  static _countText(text, end) {
    let count = 0;
    for (let i = 0; i < end; i++) if (!BlockCaretMap._isSpace(text.charCodeAt(i))) count++;
    return count;
  }

  /**
   * @purity pure
   * @param {string} text
   * @param {number} end
   * @returns {number} the lines of text before end (1 when there is no line break)
   */
  static _countLines(text, end) {
    let lines = 1;
    for (let i = text.indexOf("\n"); i >= 0 && i < end; i = text.indexOf("\n", i + 1)) lines++;
    return lines;
  }

  /**
   * A hidden copy of a textarea's text box (style), holding the parts of
   * before, a zero-width mark (the caret), then after: where the mark is
   * from the copy's top, and with "x" before and "x\nx" after, the top of
   * the first line and the height of one line.
   * @purity semi-pure-b
   * @param {CSSStyleDeclaration} style
   * @param {string[]} before
   * @param {string} after
   * @returns {{markTop: number, firstTop: number, lineHeight: number}}
   */
  static _measureCopy(style, before, after) {
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
    mark.textContent = "\u200b"; // zero width: the caret's place
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
