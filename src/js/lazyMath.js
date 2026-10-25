// Math with KaTeX run on demand (INV-81 (3)). marked-katex-extension finds
// the math ($...$, $$...$$) as it always does, so the tokens, the blocks and
// the edit model are the same with or without KaTeX; only drawing waits.
// Until KaTeX has run, a formula is shown as its TeX source in a pending
// box (owner ruling 2026-10-25), and the renderer draws it again later.

import { escapeHtml } from "./utils.js";

/** The class of a formula shown as its TeX source until KaTeX runs. */
export const MATH_PENDING_CLASS = "math-pending";

/**
 * The marked extension with drawing that waits for KaTeX.
 * @purity non-pure
 * @param {Function} markedKatex - marked-katex-extension
 * @param {object} options - KaTeX options, as for markedKatex
 * @param {object|null} [katex] - KaTeX, when it is there from the start
 * @returns {{extension: object, useKatex: Function, isReady: Function, takePending: Function}}
 */
export function lazyMath(markedKatex, options, katex = null) {
  let current = katex;
  let pending = false;
  const extension = markedKatex(options);
  for (const ext of extension.extensions) {
    const block = ext.level === "block";
    // as marked-katex-extension draws it, with the KaTeX of now
    /** @purity non-pure */
    ext.renderer = (token) => {
      if (current) return current.renderToString(token.text, { ...options, displayMode: token.displayMode }) + (block ? "\n" : "");
      pending = true;
      const tag = block ? "div" : "span";
      return `<${tag} class="${MATH_PENDING_CLASS}">${escapeHtml(token.raw.trim())}</${tag}>${block ? "\n" : ""}`;
    };
  }
  return {
    extension,
    /**
     * @param {object} library - KaTeX
     * @purity non-pure
     */
    useKatex(library) {
      current = library;
    },
    /**
     * @returns {boolean}
     * @purity semi-pure-b
     */
    isReady() {
      return current !== null;
    },
    /**
     * Whether a formula was drawn pending since the last call.
     * @returns {boolean}
     * @purity non-pure
     */
    takePending() {
      const was = pending;
      pending = false;
      return was;
    },
  };
}
