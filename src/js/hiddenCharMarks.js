import { findHiddenRuns, mayHoldHiddenChars } from "./hiddenChars.js";

// The marks of hidden characters in the Markdown preview and the code view
// (INV-101 (4)(5), spec 5.21.4): an empty inline element right before each
// run, its label shown by CSS (style.css, .grsmd-hidden-mark::before). The
// characters stay in their text node; the mark holds no text, so copy,
// search, the Index and the cell text do not see it. The marks are known
// by reference (a document's own span with this class is not one).

export const HIDDEN_MARK_CLASS = "grsmd-hidden-mark";

const MARKS = new WeakSet();

/**
 * Whether node is a mark made here.
 * @purity semi-pure-b
 * @param {Node|null} node
 * @returns {boolean}
 */
export function isHiddenMark(node) {
  return node !== null && MARKS.has(node);
}

/**
 * The first text node under root, or null.
 * @purity semi-pure-b
 * @param {Node} root
 * @returns {Text|null}
 */
export function firstTextNode(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode();
}

/**
 * @purity non-pure
 * @param {string} label
 * @returns {HTMLSpanElement}
 */
function createMark(label) {
  const mark = document.createElement("span");
  mark.className = HIDDEN_MARK_CLASS;
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("data-label", label);
  MARKS.add(mark);
  return mark;
}

/**
 * The text nodes under root that may hold a hidden character, outside the
 * elements skip names and outside the marks.
 * @purity semi-pure-b
 * @param {Node} root
 * @param {string|null} skip - a selector
 * @returns {Text[]}
 */
function candidateTexts(root, skip) {
  /** @purity semi-pure-b */
  const accept = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return mayHoldHiddenChars(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    if (MARKS.has(node) || (skip && node.matches(skip))) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_SKIP;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: accept });
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  return texts;
}

/**
 * Put a mark before each run of hidden characters in the text under root
 * (INV-101 (4)). A run that already has its mark keeps it, so this may run
 * again over marked text. skip: a selector of the elements whose text gets
 * no mark (diagrams, math). textStart: the text node whose index 0 is the
 * start of the whole text (a U+FEFF there is not one, spec 5.21.1), or null.
 * @purity non-pure
 * @param {Node} root
 * @param {{skip?: string|null, textStart?: Text|null}} [options]
 * @returns {number} the marks put in
 */
export function markHiddenChars(root, { skip = null, textStart = null } = {}) {
  if (skip && root.nodeType === Node.ELEMENT_NODE && root.closest(skip)) return 0;
  if (!mayHoldHiddenChars(root.textContent)) return 0;
  let added = 0;
  for (const text of candidateTexts(root, skip)) {
    const runs = findHiddenRuns(text.data, { textStart: text === textStart });
    // from the last run back: splitting keeps the earlier offsets
    for (let i = runs.length - 1; i >= 0; i--) {
      const { start, label } = runs[i];
      if (start === 0 && isHiddenMark(text.previousSibling)) {
        text.previousSibling.setAttribute("data-label", label);
        continue;
      }
      const rest = start === 0 ? text : text.splitText(start);
      rest.before(createMark(label));
      added++;
    }
  }
  return added;
}

/**
 * Take out the marks under root and join the text they split (a table cell
 * opened for editing, INV-63; code about to be colored again).
 * @purity non-pure
 * @param {Element} root
 * @returns {number} the marks taken out
 */
export function unmarkHiddenChars(root) {
  let removed = 0;
  for (const mark of root.querySelectorAll(`span.${HIDDEN_MARK_CLASS}`)) {
    if (!MARKS.has(mark)) continue;
    mark.remove();
    removed++;
  }
  if (removed > 0) root.normalize();
  return removed;
}
