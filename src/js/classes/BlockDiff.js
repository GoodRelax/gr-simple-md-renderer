/**
 * Matches two block lists by their source text (spec 5.14.2, INV-42).
 * Stateless: one static, pure function.
 */
export default class BlockDiff {
  /**
   * Pair old and new blocks whose raw text is equal, keeping order.
   * (1) Equal blocks at the start and (2) at the end are matched in linear
   * time. (3) The middle range (k old x m new blocks) is matched by LCS only
   * when k * m <= maxCells; otherwise its blocks are all treated as new.
   * Only `raw` is compared (a different separatorAfter does not matter).
   * @purity pure
   * @param {{raw: string}[]} oldBlocks
   * @param {{raw: string}[]} newBlocks
   * @param {number} maxCells - upper bound of the LCS table for the middle range
   * @returns {{oldIndex: number, newIndex: number}[]} ascending in both indexes
   */
  static diffBlocks(oldBlocks, newBlocks, maxCells) {
    const head = [];
    let start = 0;
    const minLen = Math.min(oldBlocks.length, newBlocks.length);
    while (start < minLen && oldBlocks[start].raw === newBlocks[start].raw) {
      head.push({ oldIndex: start, newIndex: start });
      start++;
    }

    let oldEnd = oldBlocks.length;
    let newEnd = newBlocks.length;
    const tail = [];
    while (oldEnd > start && newEnd > start && oldBlocks[oldEnd - 1].raw === newBlocks[newEnd - 1].raw) {
      oldEnd--;
      newEnd--;
      tail.push({ oldIndex: oldEnd, newIndex: newEnd });
    }
    tail.reverse();

    const k = oldEnd - start;
    const m = newEnd - start;
    const middle =
      k > 0 && m > 0 && k * m <= maxCells
        ? BlockDiff._lcs(oldBlocks, newBlocks, start, oldEnd, start, newEnd)
        : [];
    return [...head, ...middle, ...tail];
  }

  /**
   * LCS of the ranges [o0, o1) and [n0, n1) by raw text.
   * @purity pure
   * @returns {{oldIndex: number, newIndex: number}[]}
   */
  static _lcs(oldBlocks, newBlocks, o0, o1, n0, n1) {
    const k = o1 - o0;
    const m = n1 - n0;
    const width = m + 1;
    // table[i * width + j] = LCS length of old[o0 + i ..) and new[n0 + j ..)
    const table = new Uint32Array((k + 1) * width);
    for (let i = k - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          oldBlocks[o0 + i].raw === newBlocks[n0 + j].raw
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < k && j < m) {
      if (oldBlocks[o0 + i].raw === newBlocks[n0 + j].raw) {
        out.push({ oldIndex: o0 + i, newIndex: n0 + j });
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    return out;
  }
}
