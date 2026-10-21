import { escapeHtml } from "../utils.js";
import { CONFIG } from "../config.js";
import ExternalImageGate from "./ExternalImageGate.js";

// DOMPurify defaults, plus the MathML wrappers KaTeX emits:
// <semantics><mrow>...</mrow><annotation encoding="application/x-tex">TeX</annotation></semantics>.
// Without them DOMPurify unwraps <annotation> and leaves the raw TeX as stray
// text inside <math>, which screen readers then read aloud. <annotation> holds
// text only; <annotation-xml> (the HTML integration point) stays forbidden.
// <style> is forbidden: a stylesheet in the document could fetch remote
// resources (@import, url()) and restyle the whole app, including the
// external image placeholders. GitHub drops it too.
export const PURIFY_CONFIG = Object.freeze({
  ADD_TAGS: ["semantics", "annotation"],
  ADD_ATTR: ["encoding"],
  FORBID_TAGS: ["style"],
});

const HIGHLIGHT_SELECTOR =
  "pre code:not(.language-mermaid):not(.language-plantuml):not(.language-puml)";

/**
 * A stable text for the reference link definitions of a model; part of the
 * HTML cache key, so a changed definition re-renders the blocks (INV-42).
 * @purity pure
 * @param {object} links
 * @returns {string}
 */
function linksSignature(links) {
  return JSON.stringify(
    Object.keys(links || {})
      .sort()
      .map((k) => [k, links[k]?.href ?? "", links[k]?.title ?? ""]),
  );
}

export default class MarkdownRenderer {
  /**
   * @param {HTMLElement} preview
   * @param {object} marked
   * @param {object} hljs
   * @param {object} purify - DOMPurify (marked has no built-in sanitizer)
   * @param {ExternalImageGate} [imageGate]
   * @purity non-pure
   */
  constructor(
    preview,
    marked,
    hljs,
    purify,
    imageGate = new ExternalImageGate(preview),
  ) {
    this.preview = preview;
    this.marked = marked;
    this.hljs = hljs;
    // Private DOMPurify instance: mermaid sanitizes its labels with the same
    // bundled DOMPurify, and our hook must not change what mermaid sees.
    this.purify = purify(window);
    // Set once: a config passed per call is cloned and parsed again on every
    // call (DOMPurify), which for the ~15,000 blocks of a 1 MB document cost
    // more than the sanitizing itself. The rules are the same.
    this.purify.setConfig(PURIFY_CONFIG);
    this.imageGate = imageGate;
    /** @purity non-pure */
    this.purify.addHook("afterSanitizeAttributes", (node) => {
      this.imageGate.neutralize(node);
    });
    // Block rendering state. Wrappers are known by reference only (Q1): a
    // user-written class="md-block" or data-block-id is never trusted.
    this._htmlCache = new Map(); // key: raw + links signature -> sanitized HTML
    this._wrapperById = new Map(); // block id -> wrapper element
    this._htmlById = new Map(); // block id -> HTML shown in that wrapper
    this._idByWrapper = new WeakMap(); // wrapper element -> block id
    this._staleIds = new Set(); // kept wrappers that show older HTML (Q-d1)
    this._tabById = new Map(); // table block id -> its "Markdown" tab (INV-29 (b))
    this._writtenKeys = new Map(); // held block id -> raw + links written in place (INV-47)
    this._tabs = new WeakSet(); // the tabs this renderer made
    this._emptyBlock = null;
  }

  /**
   * Forget external image consent (Clear, or a new document was loaded).
   * @purity non-pure
   */
  resetExternalImageConsent() {
    this.imageGate.revoke();
  }

  // ---- HTML generation (no DOM writes) ----

  /**
   * Top-level tokens of a body, with the same marked setup as rendering:
   * block tokens only. The block model needs the block boundaries and the
   * link definitions (INV-41); each block's HTML comes from a full lexing of
   * that block (blockHtml), so the inline pass here was wasted work (about
   * two thirds of the lexing of a commit on a 1 MB document).
   * @purity semi-pure-a
   * @param {string} src
   * @returns {object[]} tokens, with tokens.links
   */
  lex(src) {
    const lexer = new this.marked.Lexer(this.marked.defaults);
    lexer.blockTokens(src.replace(/\r\n?/g, "\n"), lexer.tokens);
    return lexer.tokens;
  }

  /**
   * Inline tokens of one inline range (INV-67 (7)), with the reference
   * definitions of the document (links).
   * @purity semi-pure-a
   * @param {string} src
   * @param {object} [links] - MarkdownBlockModel.links
   * @returns {object[]}
   */
  lexInline(src, links) {
    const lexer = new this.marked.Lexer(this.marked.defaults);
    Object.assign(lexer.tokens.links, links || {});
    return lexer.inlineTokens(src);
  }

  /**
   * Block and inline tokens of one block's text (INV-71 (6)).
   * @purity semi-pure-a
   * @param {string} src
   * @returns {object[]}
   */
  lexFull(src) {
    return new this.marked.Lexer(this.marked.defaults).lex(src);
  }

  /**
   * marked.walkTokens over tokens (INV-71 (6)).
   * @purity semi-pure-a
   * @param {object[]} tokens
   * @param {(token: object) => void} fn
   */
  walkTokens(tokens, fn) {
    this.marked.walkTokens(tokens, fn);
  }

  /**
   * Sanitized HTML of a whole document (marked.parse + private DOMPurify).
   * A parse error becomes an escaped error message (the caller logs it).
   * Generation only: it writes nothing to the page (F-A1). The DOMPurify hook
   * changes only the nodes of the fragment being sanitized.
   * @purity semi-pure-a
   * @param {string} markdownText
   * @returns {{html: string, error: Error|null}}
   */
  documentHtml(markdownText) {
    try {
      return { html: this.purify.sanitize(this.marked.parse(markdownText)), error: null };
    } catch (error) {
      return { html: this._errorHtml(error), error };
    }
  }

  /**
   * Sanitized HTML of one block. Reference links resolve against the whole
   * document's definitions (links), as in a whole-document parse.
   * @purity semi-pure-a
   * @param {string} raw
   * @param {object} links - MarkdownBlockModel.links
   * @returns {{html: string, error: Error|null}}
   */
  blockHtml(raw, links) {
    try {
      const lexer = new this.marked.Lexer(this.marked.defaults);
      Object.assign(lexer.tokens.links, links || {});
      const tokens = lexer.lex(raw);
      const walk = this.marked.defaults?.walkTokens;
      if (typeof walk === "function") this.marked.walkTokens(tokens, walk);
      return { html: this.purify.sanitize(this.marked.parser(tokens)), error: null };
    } catch (error) {
      return { html: this._errorHtml(error), error };
    }
  }

  /**
   * Sanitized HTML of one table cell's text (INV-62, INV-47): an escaped
   * pipe is a pipe, as marked's tables read a cell; the inline tokens use
   * the same marked setup (KaTeX included) and the document's reference
   * definitions, and the same private DOMPurify with its hook. Generation
   * only: the caller writes it and then runs the image gate on it.
   * @purity semi-pure-a
   * @param {string} cellRaw
   * @param {object} [links] - MarkdownBlockModel.links
   * @returns {string}
   */
  inlineHtml(cellRaw, links) {
    try {
      const lexer = new this.marked.Lexer(this.marked.defaults);
      Object.assign(lexer.tokens.links, links || {});
      const tokens = lexer.inlineTokens(cellRaw.replace(/\\\|/g, "|"));
      const walk = this.marked.defaults?.walkTokens;
      if (typeof walk === "function") this.marked.walkTokens(tokens, walk);
      return this.purify.sanitize(new this.marked.Parser(this.marked.defaults).parseInline(tokens));
    } catch (error) {
      console.error("Markdown parse error:", error);
      return escapeHtml(cellRaw);
    }
  }

  /**
   * @purity pure
   * @param {Error} error
   * @returns {string}
   */
  _errorHtml(error) {
    return `<pre style="color:red;">Markdown Parse Error: ${escapeHtml(String(error?.message))}</pre>`;
  }

  // ---- DOM writes ----

  /**
   * Whole-document render into the preview (no block wrappers).
   * @purity non-pure
   * @param {string} markdownText
   */
  async render(markdownText) {
    this._forgetBlocks();
    const { html, error } = this.documentHtml(markdownText);
    if (error) console.error("Markdown parse error:", error);
    this.preview.innerHTML = html;
    this._afterInsert(this.preview);
  }

  /**
   * Full render by block (spec 5.14.4): one div.md-block per block, each
   * filled with its own sanitized HTML. The HTML cache starts empty.
   * @purity non-pure
   * @param {MarkdownBlockModel} model
   */
  renderBlocks(model) {
    this._forgetBlocks();
    const signature = linksSignature(model.links);
    const elements = model
      .getBlocks()
      .map((block) => this._createWrapper(block, this._cachedHtml(block, model.links, signature)));
    if (elements.length === 0) {
      this._emptyBlock = this._createEmptyBlock();
      elements.push(this._emptyBlock);
    }
    this.preview.replaceChildren(...elements);
    this._afterInsert(this.preview);
  }

  /**
   * Partial render (spec 5.14.3 step 6): wrappers are matched by block id;
   * a block whose HTML did not change keeps its element (and its diagrams,
   * zoom state and images). Changed and new blocks get new wrappers; removed
   * blocks leave the DOM. Returns the new wrappers only.
   * The kept block (an open editor, Q-d1) keeps its wrapper even when its
   * HTML changed; it stays stale until a later call without keepBlockId.
   * @purity non-pure
   * @param {MarkdownBlockModel} renderedModel - the model now on screen
   * @param {MarkdownBlockModel} currentModel - the model to show
   * @param {number|null} [keepBlockId]
   * @returns {HTMLElement[]}
   */
  replaceBlocks(renderedModel, currentModel, keepBlockId = null) {
    void renderedModel; // the wrappers on screen are tracked by id
    const signature = linksSignature(currentModel.links);
    const replaced = [];
    const order = [];
    const keep = new Set();
    for (const block of currentModel.getBlocks()) {
      let el = this._wrapperById.get(block.id);
      const written = this._writtenKeys.get(block.id);
      if (el && written !== undefined) {
        if (written === `${block.raw}\u0000${signature}`) {
          // written in place for this very text (markWrittenInPlace): it is
          // current, and its HTML is not made (a big table's, INV-51)
          this._staleIds.delete(block.id);
          keep.add(block.id);
          order.push(el);
          continue;
        }
        // it shows an older text: compared as changed below
        this._writtenKeys.delete(block.id);
        this._htmlById.delete(block.id);
      }
      const html = this._cachedHtml(block, currentModel.links, signature);
      const changed = !el || this._htmlById.get(block.id) !== html;
      if (changed && el && block.id === keepBlockId) {
        this._staleIds.add(block.id);
      } else if (changed) {
        if (el) {
          el.remove();
          this._dropWrapper(block.id);
        }
        el = this._createWrapper(block, html);
        replaced.push(el);
      }
      if (!changed) this._staleIds.delete(block.id);
      keep.add(block.id);
      order.push(el);
    }
    for (const id of [...this._wrapperById.keys()]) {
      if (!keep.has(id)) {
        this._wrapperById.get(id).remove();
        this._dropWrapper(id);
      }
    }
    this._pruneCache(currentModel, signature);

    if (order.length === 0) {
      if (!this._emptyBlock) this._emptyBlock = this._createEmptyBlock();
      order.push(this._emptyBlock);
    } else if (this._emptyBlock) {
      this._emptyBlock.remove();
      this._emptyBlock = null;
    }
    this._placeInOrder(order);
    for (const el of replaced) this._afterInsert(el);
    return replaced;
  }

  // ---- Block identity (Q1): by reference, never by attributes ----

  /**
   * Id of the block whose renderer-created wrapper (a direct child of the
   * preview) holds the node, or null.
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {number|null}
   */
  findBlockIdAt(node) {
    let el = node;
    while (el && el.parentNode !== this.preview) el = el.parentNode;
    if (!el) return null;
    const id = this._idByWrapper.get(el);
    return id === undefined ? null : id;
  }

  /**
   * @purity semi-pure-b
   * @param {number} blockId
   * @returns {HTMLElement|null} the wrapper on screen for that block
   */
  getBlockElement(blockId) {
    return this._wrapperById.get(blockId) ?? null;
  }

  /**
   * The empty block shown for an empty document (INV-49), or null. Only the
   * element this renderer created counts (a user-written .md-block-empty
   * does not).
   * @purity semi-pure-b
   * @returns {HTMLElement|null}
   */
  getEmptyBlockElement() {
    return this._emptyBlock;
  }

  /**
   * The table element this renderer made for a table block (a direct child
   * of its wrapper; INV-29, INV-62), or null.
   * @purity semi-pure-b
   * @param {number} blockId
   * @returns {HTMLTableElement|null}
   */
  getTableElement(blockId) {
    if (!this._tabById.has(blockId)) return null;
    const wrapper = this._wrapperById.get(blockId);
    for (const child of wrapper?.children ?? []) if (child.tagName === "TABLE") return child;
    return null;
  }

  /**
   * The node is (inside) a table tab this renderer made, by reference: a
   * user-written class="grsmd-table-tab" is not one (INV-29 (b), UIR-11).
   * @purity semi-pure-b
   * @param {Node|null} node
   * @returns {boolean}
   */
  isTableTab(node) {
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    return Boolean(el) && this._tabs.has(el);
  }

  /**
   * The external image gate on HTML the caller has just written (a held
   * table's cell or table element; INV-47, INV-43).
   * @purity non-pure
   * @param {HTMLElement} root
   */
  applyImageGate(root) {
    this.imageGate.apply(root);
  }

  /**
   * A held block was written in place to show the model's block (INV-47
   * exception): partial renders take its wrapper as showing that block for
   * as long as its text and the link definitions stay the same, so it is
   * not drawn again when it is released. Only the text is recorded: the
   * block's HTML is not made for it (a big table's, INV-51); when the text
   * changes later, the block is drawn as changed.
   * @purity non-pure
   * @param {{id: number, raw: string}} block
   * @param {object} links - MarkdownBlockModel.links
   */
  markWrittenInPlace(block, links) {
    if (!this._wrapperById.has(block.id)) return;
    this._writtenKeys.set(block.id, `${block.raw}\u0000${linksSignature(links)}`);
    this._staleIds.delete(block.id);
  }

  /**
   * One block's sanitized HTML through the cache (a table drawn again in
   * place after a table operation, INV-65).
   * @purity non-pure
   * @param {{raw: string}} block
   * @param {object} links - MarkdownBlockModel.links
   * @returns {string}
   */
  cachedBlockHtml(block, links) {
    return this._cachedHtml(block, links, linksSignature(links));
  }

  /**
   * A kept block whose wrapper shows older HTML (Q-d1).
   * @purity semi-pure-b
   * @param {number} blockId
   * @returns {boolean}
   */
  isStale(blockId) {
    return this._staleIds.has(blockId);
  }

  // ---- internals ----

  /**
   * @purity non-pure
   */
  _cachedHtml(block, links, signature) {
    const key = `${block.raw}\u0000${signature}`;
    let html = this._htmlCache.get(key);
    if (html === undefined) {
      const result = this.blockHtml(block.raw, links);
      if (result.error) console.error("Markdown parse error:", result.error);
      html = result.html;
      this._htmlCache.set(key, html);
    }
    return html;
  }

  /**
   * Drop cache keys that the current model does not use (spec 5.14.3).
   * @purity non-pure
   */
  _pruneCache(model, signature) {
    const live = new Set(model.getBlocks().map((b) => `${b.raw}\u0000${signature}`));
    for (const key of [...this._htmlCache.keys()]) {
      if (!live.has(key)) this._htmlCache.delete(key);
    }
  }

  /**
   * The wrapper is built in code; only its content is sanitized HTML.
   * @purity non-pure
   */
  _createWrapper(block, html) {
    const el = document.createElement("div");
    el.className = "md-block";
    el.dataset.blockId = String(block.id);
    el.innerHTML = html;
    const kind = this._hiddenKind(block, html);
    if (kind) {
      el.classList.add("md-block-hidden");
      el.dataset.hiddenKind = kind;
      el.title =
        kind === "link"
          ? CONFIG.messages.edit.hiddenLinkDefinition
          : CONFIG.messages.edit.hiddenHtml;
    }
    if (block.type === "table") this._addTableTab(el, block.id);
    this._wrapperById.set(block.id, el);
    this._htmlById.set(block.id, html);
    this._idByWrapper.set(el, block.id);
    return el;
  }

  /**
   * The "Markdown" tab of a table block (7.1): it opens the table's source
   * (INV-29 (b)). Made in code and known by reference; the class is for the
   * look only. It is shown in edit mode only (style.css).
   * @purity non-pure
   */
  _addTableTab(wrapper, blockId) {
    wrapper.classList.add("md-block-table"); // positions the tab (style.css)
    const tab = document.createElement("span");
    tab.className = "grsmd-table-tab";
    tab.textContent = "Markdown";
    tab.title = CONFIG.messages.edit.tableSourceTab;
    wrapper.appendChild(tab);
    this._tabById.set(blockId, tab);
    this._tabs.add(tab);
  }

  /**
   * "link" for a reference definition, "html" for HTML that shows nothing
   * (only whitespace or comments after sanitizing), null otherwise (INV-41).
   * @purity pure
   */
  _hiddenKind(block, html) {
    if (block.type === "def") return "link";
    if (block.type === "html" && html.replace(/<!--[\s\S]*?-->/g, "").trim() === "") return "html";
    return null;
  }

  /**
   * The single empty block shown for an empty document (INV-49).
   * @purity non-pure
   */
  _createEmptyBlock() {
    const el = document.createElement("div");
    el.className = "md-block md-block-empty";
    return el;
  }

  /**
   * @purity non-pure
   */
  _dropWrapper(id) {
    const el = this._wrapperById.get(id);
    if (el) this._idByWrapper.delete(el);
    this._wrapperById.delete(id);
    this._htmlById.delete(id);
    this._staleIds.delete(id);
    this._tabById.delete(id);
    this._writtenKeys.delete(id);
  }

  /**
   * Forget all block state (whole-document render, or a new full render).
   * @purity non-pure
   */
  _forgetBlocks() {
    this._htmlCache.clear();
    this._wrapperById.clear();
    this._htmlById.clear();
    this._idByWrapper = new WeakMap();
    this._staleIds.clear();
    this._tabById.clear();
    this._writtenKeys.clear();
    this._emptyBlock = null;
  }

  /**
   * Put the elements in this order as the preview's children, moving only
   * the ones that are out of place (kept wrappers are not re-inserted).
   * @purity non-pure
   */
  _placeInOrder(elements) {
    let cursor = this.preview.firstChild;
    for (const el of elements) {
      if (el === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.preview.insertBefore(el, cursor);
      }
    }
    while (cursor) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
  }

  /**
   * External image gate and syntax highlighting for newly inserted HTML.
   * @purity non-pure
   * @param {HTMLElement} root
   */
  _afterInsert(root) {
    this.imageGate.apply(root);
    try {
      /** @purity non-pure */
      root.querySelectorAll(HIGHLIGHT_SELECTOR).forEach((block) => {
        this.hljs.highlightElement(block);
      });
    } catch (hljsError) {
      console.error("Syntax highlighting error:", hljsError);
    }
  }
}
