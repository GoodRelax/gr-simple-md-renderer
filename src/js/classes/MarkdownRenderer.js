import { escapeHtml } from "../utils.js";
import { CONFIG } from "../config.js";
import ExternalImageGate from "./ExternalImageGate.js";
import { APP_ID_PREFIX } from "../libraryNames.js";
import { markHiddenChars, unmarkHiddenChars, firstTextNode } from "../hiddenCharMarks.js";

// DOMPurify defaults, plus the MathML wrappers KaTeX emits:
// <semantics><mrow>...</mrow><annotation encoding="application/x-tex">TeX</annotation></semantics>.
// Without them DOMPurify unwraps <annotation> and leaves the raw TeX as stray
// text inside <math>, which screen readers then read aloud. <annotation> holds
// text only; <annotation-xml> (the HTML integration point) stays forbidden.
// <style> is forbidden: a stylesheet in the document could fetch remote
// resources (@import, url()) and restyle the whole app, including the
// external image placeholders. GitHub drops it too. Frozen to the lists.
export const PURIFY_CONFIG = Object.freeze({
  ADD_TAGS: Object.freeze(["semantics", "annotation"]),
  ADD_ATTR: Object.freeze(["encoding"]),
  FORBID_TAGS: Object.freeze(["style"]),
});

const HIGHLIGHT_SELECTOR =
  "pre code:not(.language-mermaid):not(.language-plantuml):not(.language-puml)";

// No hidden character marks inside these (INV-101 (4), spec 5.21.4): the
// source of a diagram (Mermaid, PlantUML) and what is drawn from it, and
// math (KaTeX, or its source waiting for KaTeX). Their characters count in
// the toast only. Nor in the placeholder of an image from another site: its
// text is made from the image's alt, an attribute.
const NO_HIDDEN_MARKS =
  "code.language-mermaid, code.language-plantuml, code.language-puml, .mermaid, .plantuml-loading, " +
  ".plantuml-pending, .plantuml-wrapper, .plantuml-error, .katex, .math-pending, svg, .external-image-placeholder";

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
   * @param {object|null} hljs - null until highlight.js has run (useLibrary, INV-81)
   * @param {object} purify - DOMPurify (marked has no built-in sanitizer)
   * @param {ExternalImageGate} [imageGate]
   * @param {object|null} [math] - the lazyMath of marked's math extension, when KaTeX runs on demand
   * @purity non-pure
   */
  constructor(
    preview,
    marked,
    hljs,
    purify,
    imageGate = new ExternalImageGate(preview),
    math = null,
  ) {
    this.preview = preview;
    this.marked = marked;
    this.hljs = hljs;
    this.math = math;
    this._missing = new Set(); // libraries a render needed and did not have (INV-81)
    // HTML with a formula shown pending (until KaTeX runs, INV-81 (3)): the
    // cache entries and the wrappers to make again then, chosen by these
    // sets, not by the text (a document may write the same class)
    this._mathPendingHtml = new Set(); // the HTML strings
    this._mathPendingWritten = new Set(); // block ids written in place with one
    this._mathCountAtWrite = 0; // math.pendingCount() at the last markWrittenInPlace
    this._mathCountSeen = 0; // math.pendingCount() at the last takeMissingLibraries
    // Private DOMPurify instance: mermaid sanitizes its labels with the same
    // bundled DOMPurify, and our hook must not change what mermaid sees.
    this.purify = purify(window);
    // Set once: a config passed per call is cloned and parsed again on every
    // call (DOMPurify), which for the ~15,000 blocks of a 1 MB document cost
    // more than the sanitizing itself. The rules are the same.
    this.purify.setConfig(PURIFY_CONFIG);
    this.imageGate = imageGate;
    this._resolveRelative = null; // (value, "image"|"link") -> URL|null (GitHub documents, SC-28)
    /** @purity non-pure */
    this.purify.addHook("afterSanitizeAttributes", (node) => {
      // the app keeps these ids for itself (INV-81 (5)): a document's own
      // id like a library's data block id is dropped
      // (the attribute is read: a form's "id" property may be a field of it)
      if (node.getAttribute?.("id")?.toLowerCase().startsWith(APP_ID_PREFIX)) node.removeAttribute("id");
      if (this._resolveRelative) this._rewriteRelative(node);
      this.imageGate.neutralize(node); // after the rewrite: a resolved image is still gated (INV-19)
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
    this._gap = null; // { element, afterBlockId }: the open gap editor's wrapper (INV-73)
    this._blockElements = null; // the wrappers in order, made again after the order changes
    this._bodyStartsWithBom = false; // the shown body starts with U+FEFF (not a hidden character there, 5.21.1)
  }

  /**
   * How relative image and link URLs resolve (a document opened from
   * GitHub), or null to leave them as written. Read on every sanitize; the
   * caller makes the value follow the current document, and a document
   * change renders in full, which drops the HTML cache.
   * @purity non-pure
   * @param {Function|null} resolve - (value, "image"|"link") -> string|null
   */
  setRelativeUrlResolver(resolve) {
    this._resolveRelative = resolve;
  }

  /**
   * @purity non-pure
   * @param {Element} node
   */
  _rewriteRelative(node) {
    const tag = node.nodeName;
    const attr = tag === "IMG" ? "src" : tag === "A" ? "href" : null;
    if (!attr || !node.hasAttribute(attr)) return;
    const url = this._resolveRelative(node.getAttribute(attr), tag === "IMG" ? "image" : "link");
    if (url) node.setAttribute(attr, url);
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
   * @purity semi-pure-a
   * @param {Error} error
   * @returns {string}
   */
  _errorHtml(error) {
    return `<pre style="color:red;">${escapeHtml(CONFIG.messages.markdown.parseError(String(error?.message)))}</pre>`;
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
    this._bodyStartsWithBom = markdownText.charCodeAt(0) === 0xfeff;
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
    this._bodyStartsWithBom = model.toBody?.().charCodeAt(0) === 0xfeff; // a model made in a test may have no body
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
    this._bodyStartsWithBom = currentModel.toBody?.().charCodeAt(0) === 0xfeff;
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

    if (this._gap) {
      // the open gap editor stays where it was opened (INV-73)
      const after = this._gap.afterBlockId === null ? -1 : order.indexOf(this._wrapperById.get(this._gap.afterBlockId));
      order.splice(after < 0 && this._gap.afterBlockId !== null ? order.length : after + 1, 0, this._gap.element);
    }
    if (order.length === 0) {
      if (!this._emptyBlock) this._emptyBlock = this._createEmptyBlock();
      order.push(this._emptyBlock);
    } else if (this._emptyBlock) {
      this._emptyBlock.remove();
      this._emptyBlock = null;
    }
    this._placeInOrder(order);
    this._blockElements = null;
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
   * The wrappers of the blocks on screen, in their order (the gaps between
   * them, INV-73). The empty block and an open gap editor are not blocks.
   * The list is kept until the order changes (a render; or the preview was
   * written by another view): the mouse asks for it on every frame (INV-51).
   * @purity semi-pure-b
   * @returns {ReadonlyArray<HTMLElement>}
   */
  getBlockElements() {
    const kept = this._blockElements;
    if (kept && (kept.length === 0 || kept[0].parentNode === this.preview)) return kept;
    this._blockElements = Object.freeze(Array.prototype.filter.call(this.preview.children, (el) => this._idByWrapper.has(el)));
    return this._blockElements;
  }

  /**
   * Put the wrapper of a gap editor in the gap after a block (null: before
   * the first block), and keep it there through partial renders until
   * removeGapEditor(). The block after it is nextBlockId: when the wrapper
   * of afterBlockId is not drawn yet (a commit just before), it goes before
   * that one (INV-73).
   * @purity non-pure
   * @param {HTMLElement} element
   * @param {number|null} afterBlockId
   * @param {number|null} nextBlockId
   */
  placeGapEditor(element, afterBlockId, nextBlockId) {
    this._gap = { element, afterBlockId };
    const after = afterBlockId === null ? null : this._wrapperById.get(afterBlockId);
    const next = nextBlockId === null ? null : this._wrapperById.get(nextBlockId);
    if (after) after.after(element);
    else if (next) next.before(element);
    else if (afterBlockId === null) this.preview.prepend(element);
    else this.preview.append(element);
  }

  /**
   * The gap editor closed: its wrapper leaves the preview.
   * @purity non-pure
   */
  removeGapEditor() {
    this._gap?.element.remove();
    this._gap = null;
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
   * user-written class="grsmd-table-tab" is not one (INV-29 (b)).
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
   * Mark the hidden characters in HTML the caller has just written (a held
   * table's cell or table element, a cell closed unchanged; INV-101 (4)).
   * Not for an open cell: it shows the INV-70 marks only.
   * @purity non-pure
   * @param {HTMLElement} root
   */
  markHiddenChars(root) {
    const textStart = this._bodyStartsWithBom ? firstTextNode(this.preview) : null;
    markHiddenChars(root, { skip: NO_HIDDEN_MARKS, textStart });
  }

  /**
   * Take the hidden character marks out of root (a cell about to open for
   * editing: its text and HTML are read without them, INV-63).
   * @purity non-pure
   * @param {HTMLElement} root
   */
  unmarkHiddenChars(root) {
    unmarkHiddenChars(root);
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
    // a formula drawn pending since the last mark is in what was written
    const count = this.math?.pendingCount() ?? 0;
    if (count > this._mathCountAtWrite) this._mathPendingWritten.add(block.id);
    this._mathCountAtWrite = count;
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

  // ---- Libraries that run on demand (INV-81) ----

  /**
   * A library has run: "hljs" colors the code from now on, "katex" draws the
   * math (the HTML that shows a formula pending is made again).
   * @purity non-pure
   * @param {string} name
   * @param {object} library
   */
  useLibrary(name, library) {
    if (name === "hljs") this.hljs = library;
    if (name !== "katex" || !this.math) return;
    this.math.useKatex(library);
    // the HTML that shows a formula pending is made again (spec 5.17.3)
    for (const [key, html] of [...this._htmlCache]) {
      if (this._mathPendingHtml.has(html)) this._htmlCache.delete(key);
    }
    for (const [id, html] of [...this._htmlById]) {
      if (this._mathPendingHtml.has(html)) this._htmlById.delete(id);
    }
    for (const id of this._mathPendingWritten) {
      if (!this._writtenKeys.delete(id)) continue;
      this._htmlById.delete(id);
    }
    this._mathPendingHtml.clear();
    this._mathPendingWritten.clear();
  }

  /**
   * The libraries the renders since the last call needed and did not have.
   * @purity non-pure
   * @returns {string[]}
   */
  takeMissingLibraries() {
    const count = this.math?.pendingCount() ?? 0;
    if (count > this._mathCountSeen) this._missing.add("katex");
    this._mathCountSeen = count;
    const names = [...this._missing];
    this._missing.clear();
    return names;
  }

  /**
   * Whether HTML that shows a formula waiting for KaTeX is kept (the
   * preview, the cache or a block written in place): spec 11-g isShownWithout.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasPendingMath() {
    return this._mathPendingHtml.size > 0 || this._mathPendingWritten.size > 0;
  }

  /**
   * Whether the preview shows code drawn before highlight.js had run
   * (spec 11-g isShownWithout).
   * @purity semi-pure-b
   * @returns {boolean}
   */
  hasPendingHighlight() {
    if (this.hljs) return false;
    return [...this.preview.querySelectorAll(HIGHLIGHT_SELECTOR)].some((block) => !block.classList.contains("hljs"));
  }

  /**
   * Color the code blocks drawn before highlight.js had run.
   * @purity non-pure
   */
  highlightPending() {
    if (!this.hljs) return;
    try {
      /** @purity non-pure */
      this.preview.querySelectorAll(HIGHLIGHT_SELECTOR).forEach((block) => {
        if (!block.classList.contains("hljs")) this._highlight(block);
      });
    } catch (hljsError) {
      console.error("Syntax highlighting error:", hljsError);
    }
  }

  // ---- internals ----

  /**
   * @purity non-pure
   */
  _cachedHtml(block, links, signature) {
    const key = `${block.raw}\u0000${signature}`;
    let html = this._htmlCache.get(key);
    if (html === undefined) {
      const before = this.math?.pendingCount() ?? 0;
      const result = this.blockHtml(block.raw, links);
      if (result.error) console.error("Markdown parse error:", result.error);
      html = result.html;
      this._htmlCache.set(key, html);
      if ((this.math?.pendingCount() ?? 0) > before) this._mathPendingHtml.add(html);
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
    if (this._mathPendingHtml.size === 0) return;
    const shown = new Set([...this._htmlCache.values(), ...this._htmlById.values()]);
    for (const html of this._mathPendingHtml) {
      if (!shown.has(html)) this._mathPendingHtml.delete(html);
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
    tab.textContent = CONFIG.messages.edit.tableTab;
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
    this._mathPendingHtml.clear();
    this._mathPendingWritten.clear();
    this._wrapperById.clear();
    this._htmlById.clear();
    this._idByWrapper = new WeakMap();
    this._staleIds.clear();
    this._tabById.clear();
    this._writtenKeys.clear();
    this._emptyBlock = null;
    this._gap = null;
    this._blockElements = null;
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
      const blocks = root.querySelectorAll(HIGHLIGHT_SELECTOR);
      if (!this.hljs) {
        // colored when highlight.js has run (highlightPending, INV-81)
        if (blocks.length > 0) this._missing.add("hljs");
      } else {
        /** @purity non-pure */
        blocks.forEach((block) => this._highlight(block));
      }
    } catch (hljsError) {
      console.error("Syntax highlighting error:", hljsError);
    }
    this.markHiddenChars(root); // INV-101 (4): after the colors, which write the code again
  }

  /**
   * Highlight one code block (5.8.1). A block longer than
   * CONFIG.rendering.highlightMaxChars stays plain text: highlight.js has
   * language patterns that are quadratic in a long block. A block without
   * a language takes the one detected from its first highlightDetectChars
   * characters (detection runs every language over the text), and the whole
   * block is highlighted in it.
   * @purity non-pure
   * @param {HTMLElement} block - a code element
   */
  _highlight(block) {
    const { highlightDetectChars, highlightMaxChars } = CONFIG.rendering;
    const text = block.textContent;
    if (text.length > highlightMaxChars) {
      block.classList.add("hljs"); // the code color of a highlighted block, no tokens
      return;
    }
    if (!this._hasLanguage(block)) {
      const detected = this.hljs.highlightAuto(text.slice(0, highlightDetectChars)).language;
      block.classList.add(`language-${detected || "plaintext"}`);
    }
    // the code is written again from its text: the marks of code drawn
    // before highlight.js had run go first (no element in it), and come back
    unmarkHiddenChars(block);
    this.hljs.highlightElement(block);
    this.markHiddenChars(block);
  }

  /**
   * Whether highlight.js takes the block's language (or no-highlight) from
   * its classes or its pre's, as highlightElement reads them: language-* /
   * lang-* (the same pattern as its languageDetectRe, so "language--" of a
   * fence whose info string is "-" is no language), or a class that names
   * a language.
   * @purity semi-pure-b
   * @param {HTMLElement} block
   * @returns {boolean}
   */
  _hasLanguage(block) {
    const classes = `${block.className} ${block.parentNode?.className ?? ""}`;
    if (/\blang(?:uage)?-([\w-]+)\b/i.test(classes)) return true;
    return classes.split(/\s+/).some((name) => /^no-?highlight$/i.test(name) || (name !== "" && Boolean(this.hljs.getLanguage(name))));
  }
}
