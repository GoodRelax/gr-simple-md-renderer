import BlockDiff from "./BlockDiff.js";
import MarkdownTextOps from "./MarkdownTextOps.js";

// HTML elements that never have an end tag: they do not open a nesting level (INV-41).
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>/g;
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * Net nesting change of the non-void tags in one html token (comments ignored).
 * @purity pure
 * @param {string} raw
 * @returns {number}
 */
function tagBalance(raw) {
  let depth = 0;
  for (const m of raw.replace(COMMENT_RE, "").matchAll(TAG_RE)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing || VOID_ELEMENTS.has(name.toLowerCase())) continue;
    depth += closing ? -1 : 1;
  }
  return depth;
}

/**
 * Turn top-level tokens into blocks (INV-41): space tokens become the
 * separator after the previous block (or the leading text), and an html token
 * whose tags are not closed is merged with the following tokens until they are.
 * @purity pure
 * @param {object[]} tokens - marked.lexer() output
 * @returns {{leading: string, blocks: {type: string, raw: string, separatorAfter: string}[]}}
 */
function tokensToBlocks(tokens) {
  let leading = "";
  const blocks = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "space") {
      if (blocks.length === 0) leading += t.raw;
      else blocks[blocks.length - 1].separatorAfter += t.raw;
      continue;
    }
    let raw = t.raw;
    if (t.type === "html") {
      const first = i;
      let depth = tagBalance(t.raw);
      while (depth > 0 && i + 1 < tokens.length) {
        i++;
        raw += tokens[i].raw;
        if (tokens[i].type === "html") depth += tagBalance(tokens[i].raw);
      }
      // Never closed: blank lines merged in at the end belong to the separator.
      if (i > first && tokens[i].type === "space") {
        const sep = tokens[i].raw;
        blocks.push({ type: t.type, raw: raw.slice(0, raw.length - sep.length), separatorAfter: sep });
        continue;
      }
    }
    blocks.push({ type: t.type, raw, separatorAfter: "" });
  }
  return { leading, blocks };
}

/**
 * Markdown source as a list of blocks (Entity, immutable value; spec 5.14.2).
 * Invariant: toBody() === leading + every (raw + separatorAfter) (INV-41).
 * Block ids are never reused: new blocks take ids from nextBlockId (INV-48).
 */
export default class MarkdownBlockModel {
  /**
   * @purity pure
   * @param {string} leading - blank lines before the first block
   * @param {{id: number, type: string, raw: string, separatorAfter: string}[]} blocks
   * @param {number} nextBlockId
   * @param {object} links - reference link definitions (marked tokens.links)
   */
  constructor(leading, blocks, nextBlockId, links) {
    this._leading = leading;
    this._blocks = Object.freeze(blocks.map((b) => Object.freeze({ ...b })));
    this._nextBlockId = nextBlockId;
    this.links = Object.freeze({ ...(links || {}) });
    Object.freeze(this);
  }

  /**
   * Build a model from a body, numbering blocks from firstBlockId.
   * @purity pure
   * @param {string} bodyText - LF body
   * @param {(src: string) => object[]} lexer - marked.lexer
   * @param {number} [firstBlockId=1]
   * @returns {MarkdownBlockModel}
   */
  static fromBody(bodyText, lexer, firstBlockId = 1) {
    const tokens = lexer(bodyText);
    const { leading, blocks } = tokensToBlocks(tokens);
    let id = firstBlockId;
    const numbered = blocks.map((b) => ({ id: id++, ...b }));
    return new MarkdownBlockModel(leading, numbered, id, tokens.links);
  }

  /**
   * The text shown in a block editor: the raw without its trailing newlines.
   * replaceBlock() puts the original trailing newlines back.
   * @purity pure
   * @param {string} raw
   * @returns {string}
   */
  static toEditableText(raw) {
    return raw.replace(/\n+$/, "");
  }

  /**
   * @purity pure
   * @returns {ReadonlyArray<{id: number, type: string, raw: string, separatorAfter: string}>}
   */
  getBlocks() {
    return this._blocks;
  }

  /**
   * @purity pure
   * @returns {number} the id the next new block will get
   */
  getNextBlockId() {
    return this._nextBlockId;
  }

  /**
   * The same blocks with a next id at least n, so that ids given later never
   * repeat an id given elsewhere (Undo keeps the app-wide counter, INV-48).
   * @purity pure
   * @param {number} n
   * @returns {MarkdownBlockModel}
   */
  withNextBlockId(n) {
    if (n <= this._nextBlockId) return this;
    return new MarkdownBlockModel(this._leading, this._blocks, n, this.links);
  }

  /**
   * @purity pure
   * @param {number} blockId
   * @returns {number} index of the block, or -1
   */
  findIndexById(blockId) {
    return this._blocks.findIndex((b) => b.id === blockId);
  }

  /**
   * @purity pure
   * @returns {string}
   */
  toBody() {
    return this._leading + this._blocks.map((b) => b.raw + b.separatorAfter).join("");
  }

  /**
   * Re-lex a new body and keep the ids of blocks whose raw did not change.
   * The anchor is the first block (INV-46).
   * @purity pure
   * @param {string} bodyText
   * @param {(src: string) => object[]} lexer
   * @param {number} maxCells
   * @returns {{model: MarkdownBlockModel, isChanged: boolean, anchorBlockId: number|null}}
   */
  withBody(bodyText, lexer, maxCells) {
    const model = this._relex(bodyText, lexer, maxCells);
    const first = model._blocks[0];
    return { model, isChanged: bodyText !== this.toBody(), anchorBlockId: first ? first.id : null };
  }

  /**
   * Replace one block with new text from its editor (trailing newlines of the
   * old raw are kept). Empty text removes the block and its separator.
   * Returns isChanged false (and this model) when the body would not change.
   * @purity pure
   * @param {number} blockId
   * @param {string} newRaw - editor text
   * @param {(src: string) => object[]} lexer
   * @param {number} maxCells
   * @returns {{model: MarkdownBlockModel, isChanged: boolean, anchorBlockId: number|null}}
   */
  replaceBlock(blockId, newRaw, lexer, maxCells) {
    const index = this.findIndexById(blockId);
    if (index < 0) return { model: this, isChanged: false, anchorBlockId: null };
    const block = this._blocks[index];
    const start = this._offsetOf(index);
    const text = MarkdownBlockModel.toEditableText(newRaw);
    const oldBody = this.toBody();
    let newBody;
    if (text === "") {
      newBody = oldBody.slice(0, start) + oldBody.slice(start + block.raw.length + block.separatorAfter.length);
    } else {
      const trailing = /\n*$/.exec(block.raw)[0];
      newBody = oldBody.slice(0, start) + text + trailing + oldBody.slice(start + block.raw.length);
    }
    if (newBody === oldBody) return { model: this, isChanged: false, anchorBlockId: blockId };
    const model = this._relex(newBody, lexer, maxCells);
    return { model, isChanged: true, anchorBlockId: model._blockIdAt(start) };
  }

  /**
   * Insert a block after the given block (or at the end when it is null or
   * unknown), adding blank lines only where needed (INV-52).
   * The anchor is the inserted block.
   * @purity pure
   * @param {number|null} blockId
   * @param {string} raw
   * @param {(src: string) => object[]} lexer
   * @param {number} maxCells
   * @returns {{model: MarkdownBlockModel, isChanged: boolean, anchorBlockId: number|null}}
   */
  insertAfter(blockId, raw, lexer, maxCells) {
    const oldBody = this.toBody();
    const index = blockId === null ? -1 : this.findIndexById(blockId);
    const offset = index < 0 ? oldBody.length : this._offsetOf(index + 1);
    const edit = MarkdownTextOps.insertBlockText(oldBody, offset, raw);
    const model = this._relex(edit.text, lexer, maxCells);
    const insertedStart = edit.selEnd - raw.length;
    return { model, isChanged: true, anchorBlockId: model._blockIdAt(insertedStart) };
  }

  // ---- internals (pure) ----

  /**
   * Start offset of block i in the body (i may be the block count: end of body).
   * @purity pure
   */
  _offsetOf(i) {
    let pos = this._leading.length;
    for (let k = 0; k < i && k < this._blocks.length; k++) {
      pos += this._blocks[k].raw.length + this._blocks[k].separatorAfter.length;
    }
    return pos;
  }

  /**
   * Id of the block whose span (raw + separator) holds the offset; the last
   * block when the offset is at the end; null when there are no blocks.
   * @purity pure
   */
  _blockIdAt(offset) {
    if (this._blocks.length === 0) return null;
    let pos = this._leading.length;
    for (const b of this._blocks) {
      const end = pos + b.raw.length + b.separatorAfter.length;
      if (offset < end) return b.id;
      pos = end;
    }
    return this._blocks[this._blocks.length - 1].id;
  }

  /**
   * New model for bodyText; matched blocks keep their ids, others get new ones.
   * @purity pure
   */
  _relex(bodyText, lexer, maxCells) {
    const tokens = lexer(bodyText);
    const { leading, blocks } = tokensToBlocks(tokens);
    const matches = BlockDiff.diffBlocks(this._blocks, blocks, maxCells);
    const keep = new Map(matches.map((m) => [m.newIndex, this._blocks[m.oldIndex].id]));
    let next = this._nextBlockId;
    const numbered = blocks.map((b, i) => ({ id: keep.has(i) ? keep.get(i) : next++, ...b }));
    return new MarkdownBlockModel(leading, numbered, next, tokens.links);
  }
}
