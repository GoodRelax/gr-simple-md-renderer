/** Spec: INV-110 (4). The ASCII whitespace of the HTML standard: TAB, LF, FF, CR and SPACE. */
const ASCII_WHITESPACE = /[\t\n\f\r ]/;

/**
 * Spec: INV-19, INV-110 (4). The candidates of a srcset value, split by the steps of the HTML srcset parser: a
 * URL is a run of characters other than ASCII whitespace, commas at its end end the candidate, and descriptors
 * run to the next comma outside parentheses, where the first ")" closes the parentheses.
 * @purity pure
 * @param {string} srcset
 * @returns {{url: string, descriptors: string}[]} descriptors is "" when the candidate has none
 */
export function srcsetCandidates(srcset) {
  const candidates = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && (ASCII_WHITESPACE.test(srcset[i]) || srcset[i] === ",")) i++;
    if (i >= srcset.length) break;
    let end = i;
    while (end < srcset.length && !ASCII_WHITESPACE.test(srcset[end])) end++;
    let url = srcset.slice(i, end);
    i = end;
    let descriptors = "";
    if (url.endsWith(",")) {
      while (url.endsWith(",")) url = url.slice(0, -1);
    } else {
      let inParentheses = false;
      const start = i;
      while (i < srcset.length && !(srcset[i] === "," && !inParentheses)) {
        if (inParentheses) {
          if (srcset[i] === ")") inParentheses = false;
        } else if (srcset[i] === "(") {
          inParentheses = true;
        }
        i++;
      }
      descriptors = srcset.slice(start, i).trim();
    }
    candidates.push({ url, descriptors });
  }
  return candidates;
}
