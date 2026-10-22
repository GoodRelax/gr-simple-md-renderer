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
 * The longest form of a token raw that the body has at pos: the raw itself, or
 * the raw without trailing newlines that are not in the body. null if none.
 * @purity pure
 * @param {string} body
 * @param {number} pos
 * @param {string} raw
 * @returns {string|null}
 */
function rawAt(body, pos, raw) {
  let candidate = raw;
  while (candidate.length > 0) {
    if (body.startsWith(candidate, pos)) return candidate;
    if (!candidate.endsWith("\n")) return null;
    candidate = candidate.slice(0, -1);
  }
  return null;
}

// A skipped definition ends at the next blank line at the latest (a title
// cannot contain one). Its gap is lexed on its own from a window up to that
// blank line; a window that would be longer than this is not used.
const GAP_WINDOW_MAX = 4096;

/**
 * The token that fills a gap at pos: the first token of a short window of the
 * body (up to and including the next blank line), lexed on its own, when it is
 * a reference definition or a blank. null when there is no such window or
 * token.
 * @purity pure
 * @param {string} body
 * @param {number} pos
 * @param {(src: string) => object[]} lexer
 * @returns {object|null}
 */
function gapToken(body, pos, lexer) {
  const blank = body.slice(pos, pos + GAP_WINDOW_MAX).indexOf("\n\n");
  if (blank < 0 && pos + GAP_WINDOW_MAX < body.length) return null;
  const end = blank < 0 ? body.length : pos + blank + 2;
  const first = lexer(body.slice(pos, end))[0];
  if (!first || (first.type !== "def" && first.type !== "space")) return null;
  const raw = rawAt(body, pos, first.raw);
  return raw === null ? null : { ...first, raw };
}

/**
 * Line up the tokens of one lexing (part, lexed from start) with the body.
 * A gap that marked left (a skipped definition, or the blank after it) is
 * filled with gap tokens, and the tokens of part go on after it. Stops where
 * a gap cannot be filled that way.
 * @purity pure
 * @param {string} body
 * @param {number} start
 * @param {object[]} part
 * @param {(src: string) => object[]} lexer
 * @returns {{tokens: object[], pos: number}}
 */
function alignPart(body, start, part, lexer) {
  const tokens = [];
  let pos = start;
  for (const token of part) {
    let raw = rawAt(body, pos, token.raw);
    while (raw === null) {
      const filler = gapToken(body, pos, lexer);
      if (!filler) return { tokens, pos };
      tokens.push(filler);
      pos += filler.raw.length;
      raw = rawAt(body, pos, token.raw);
    }
    tokens.push(raw === token.raw ? token : { ...token, raw });
    pos += raw.length;
  }
  while (pos < body.length) {
    const filler = gapToken(body, pos, lexer);
    if (!filler) break;
    tokens.push(filler);
    pos += filler.raw.length;
  }
  return { tokens, pos };
}

/**
 * Top-level tokens whose raws join back to the body (INV-41), or null.
 * marked skips a reference definition whose label is already defined
 * (case-insensitive) and adds the newline after it to a neighbouring token,
 * so the raws no longer cover the body. Each such gap is lexed on its own
 * from a short window and becomes a token of its own (one per skipped
 * definition, as marked gives one token per definition); the tokens of the
 * whole-body lexing go on after it, so the body is lexed about once
 * (R5.1). Only where a gap cannot be filled that way is the rest of the body
 * lexed again. The first definition of a label wins in links, as in one
 * parse of the whole body.
 * @purity pure
 * @param {string} body
 * @param {(src: string) => object[]} lexer
 * @returns {{tokens: object[], links: object}|null}
 */
function lexAligned(body, lexer) {
  let tokens = [];
  const links = {};
  let pos = 0;
  while (pos < body.length) {
    const part = lexer(body.slice(pos));
    for (const [label, link] of Object.entries(part.links || {})) {
      if (!(label in links)) links[label] = link;
    }
    const aligned = alignPart(body, pos, part, lexer);
    if (aligned.pos === pos) return null;
    tokens = tokens.concat(aligned.tokens);
    pos = aligned.pos;
  }
  return { tokens, links };
}

/**
 * Split a body into blocks. If the blocks cannot reproduce the body (or the
 * lexer throws), the whole body becomes one block, so the body is never
 * rewritten (INV-41).
 * @purity pure
 * @param {string} body
 * @param {(src: string) => object[]} lexer
 * @returns {{leading: string, blocks: object[], links: object, isWholeDocument: boolean}}
 */
function splitBody(body, lexer) {
  let aligned = null;
  try {
    aligned = lexAligned(body, lexer);
  } catch {
    aligned = null;
  }
  if (aligned) {
    const { leading, blocks } = tokensToBlocks(aligned.tokens);
    const joined = leading + blocks.map((b) => b.raw + b.separatorAfter).join("");
    if (joined === body) return { leading, blocks, links: aligned.links, isWholeDocument: false };
  }
  const whole = body === "" ? [] : [{ type: "document", raw: body, separatorAfter: "" }];
  return { leading: "", blocks: whole, links: aligned ? aligned.links : {}, isWholeDocument: body !== "" };
}

/**
 * A deep, frozen copy of the reference definitions: no entry is shared
 * with the lexer's own objects.
 * @purity pure
 * @param {object} links
 * @returns {object}
 */
function freezeLinks(links) {
  const copy = {};
  for (const [label, link] of Object.entries(links || {})) {
    copy[label] = Object.freeze({ href: link.href, title: link.title });
  }
  return Object.freeze(copy);
}

// The body of each model, joined on the first toBody() (the model is frozen).
const BODIES = new WeakMap();

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
   * @param {boolean} [isWholeDocument] - the body could not be split (one block)
   */
  constructor(leading, blocks, nextBlockId, links, isWholeDocument = false) {
    this._leading = leading;
    this._blocks = Object.freeze(blocks.map((b) => Object.freeze({ ...b })));
    this._nextBlockId = nextBlockId;
    this.links = freezeLinks(links);
    this.isWholeDocument = isWholeDocument;
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
    const { leading, blocks, links, isWholeDocument } = splitBody(bodyText, lexer);
    let id = firstBlockId;
    const numbered = blocks.map((b) => ({ id: id++, ...b }));
    return new MarkdownBlockModel(leading, numbered, id, links, isWholeDocument);
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
    return new MarkdownBlockModel(this._leading, this._blocks, n, this.links, this.isWholeDocument);
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
   * The body text. A model does not change, so the text is joined once
   * (the unsaved check and the commits ask for it many times, INV-51).
   * @purity pure
   * @returns {string}
   */
  toBody() {
    let body = BODIES.get(this);
    if (body === undefined) {
      body = this._leading + this._blocks.map((b) => b.raw + b.separatorAfter).join("");
      BODIES.set(this, body);
    }
    return body;
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
    const { body, start } = this._bodyReplacing(index, newRaw);
    if (body === this.toBody()) return { model: this, isChanged: false, anchorBlockId: blockId };
    const model = this._relex(body, lexer, maxCells);
    return { model, isChanged: true, anchorBlockId: model._blockIdAt(start) };
  }

  /**
   * replaceBlock() for a table block edited by cell or by a table operation
   * (INV-42, INV-62): when, after the equal blocks at the start and at the
   * end are left out (as BlockDiff matches them), one old block (the table)
   * stands against one new block of type table, the new block keeps the
   * table's id (keptId true). Otherwise the blocks are matched as usual
   * (keptId false). Nothing is applied: the plan is the guard of 11-c
   * (canKeepTableId) and, unchanged, the change the commit applies.
   * @purity pure
   * @param {number} blockId
   * @param {string} newRaw - the table's new text
   * @param {(src: string) => object[]} lexer
   * @param {number} maxCells
   * @returns {{model: MarkdownBlockModel, isChanged: boolean, anchorBlockId: number|null, keptId: boolean}}
   */
  planTableReplace(blockId, newRaw, lexer, maxCells) {
    const index = this.findIndexById(blockId);
    if (index < 0) return { model: this, isChanged: false, anchorBlockId: null, keptId: false };
    const { body, start } = this._bodyReplacing(index, newRaw);
    if (body === this.toBody()) return { model: this, isChanged: false, anchorBlockId: blockId, keptId: true };
    const local = this._localTableModel(index, newRaw, lexer);
    if (local) return { model: local, isChanged: true, anchorBlockId: blockId, keptId: true };
    const split = splitBody(body, lexer);
    const kept = this._keptTableBlocks(index, split.blocks);
    if (!kept) {
      const model = this._relex(body, lexer, maxCells);
      return { model, isChanged: true, anchorBlockId: model._blockIdAt(start), keptId: false };
    }
    const model = new MarkdownBlockModel(split.leading, kept, this._nextBlockId, split.links, split.isWholeDocument);
    return { model, isChanged: true, anchorBlockId: blockId, keptId: true };
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
   * The body with block index's raw replaced by an editor text (its
   * trailing newlines kept); an empty text removes the block and its
   * separator. start: the block's offset.
   * @purity pure
   * @returns {{body: string, start: number}}
   */
  _bodyReplacing(index, newRaw) {
    const block = this._blocks[index];
    const start = this._offsetOf(index);
    const text = MarkdownBlockModel.toEditableText(newRaw);
    const oldBody = this.toBody();
    if (text === "") {
      return { body: oldBody.slice(0, start) + oldBody.slice(start + block.raw.length + block.separatorAfter.length), start };
    }
    const trailing = /\n*$/.exec(block.raw)[0];
    return { body: oldBody.slice(0, start) + text + trailing + oldBody.slice(start + block.raw.length), start };
  }

  /**
   * planTableReplace() without lexing the whole body (INV-51): when the
   * table starts after a blank line (or at the start), and its new text
   * lexed alone is one table block and nothing else, the whole body would
   * split the same way: a table's text decides neither where the block
   * before it ends nor where it ends (the line after it does, and that line
   * does not change), and it holds no reference definition. The blocks,
   * the definitions and the ids stay; only the table's raw changes. null
   * when that does not hold (the whole body is lexed then).
   * @purity pure
   * @param {number} index - a table block
   * @param {string} newRaw - its editor text
   * @param {(src: string) => object[]} lexer
   * @returns {MarkdownBlockModel|null}
   */
  _localTableModel(index, newRaw, lexer) {
    const block = this._blocks[index];
    const text = MarkdownBlockModel.toEditableText(newRaw);
    if (block.type !== "table" || text === "") return null;
    const before = index === 0 ? this._leading : this._blocks[index - 1].raw + this._blocks[index - 1].separatorAfter;
    if (index > 0 && !/\n[ \t]*\n$/.test(before)) return null;
    const raw = text + /\n*$/.exec(block.raw)[0];
    let split;
    try {
      split = splitBody(raw, lexer);
    } catch {
      return null;
    }
    const only = split.blocks[0];
    if (split.leading !== "" || split.blocks.length !== 1 || only.type !== "table" || only.raw !== raw) return null;
    if (Object.keys(split.links).length > 0) return null;
    const blocks = this._blocks.map((b, i) => (i === index ? { ...b, raw } : b));
    return new MarkdownBlockModel(this._leading, blocks, this._nextBlockId, this.links, this.isWholeDocument);
  }

  /**
   * The new blocks numbered with the old ids when the only difference is
   * block index (a table) against one new table block, else null.
   * @purity pure
   * @param {number} index
   * @param {{type: string, raw: string}[]} blocks - the new blocks
   * @returns {object[]|null}
   */
  _keptTableBlocks(index, blocks) {
    const old = this._blocks;
    let head = 0;
    while (head < Math.min(old.length, blocks.length) && old[head].raw === blocks[head].raw) head++;
    let tail = 0;
    while (tail < Math.min(old.length, blocks.length) - head && old[old.length - 1 - tail].raw === blocks[blocks.length - 1 - tail].raw) tail++;
    if (head !== index || old.length - head - tail !== 1 || blocks.length - head - tail !== 1) return null;
    if (blocks[head].type !== "table") return null;
    /** @purity pure */
    return blocks.map((b, i) => {
      if (i < head) return { id: old[i].id, ...b };
      if (i === head) return { id: old[index].id, ...b };
      return { id: old[i - blocks.length + old.length].id, ...b };
    });
  }

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
    const { leading, blocks, links, isWholeDocument } = splitBody(bodyText, lexer);
    const matches = BlockDiff.diffBlocks(this._blocks, blocks, maxCells);
    const keep = new Map(matches.map((m) => [m.newIndex, this._blocks[m.oldIndex].id]));
    let next = this._nextBlockId;
    const numbered = blocks.map((b, i) => ({ id: keep.has(i) ? keep.get(i) : next++, ...b }));
    return new MarkdownBlockModel(leading, numbered, next, links, isWholeDocument);
  }
}
