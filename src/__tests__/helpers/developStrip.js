import { trailingRunLength, trimTrailingRun } from "../../js/textTransforms.js";

// Spec: INV-71 (6).
// Why: the reference of AT-HB-67; a copy of develop's clean-up at commit 3cac384 (src/js/classes/MarkdownTextOps.js: stripMeaninglessHardBreaks and the helpers it calls; their comments and the per-tokens cache LEAF_TABLES left out), so this branch's output is compared with it letter by letter

const PARAGRAPH_LEAVES = new Set(["paragraph", "text"]);
const STRIPPABLE_LEAVES = new Set(["paragraph", "text", "heading", "table"]);
const BLANKS = " \t";
const STRIP_MAX_LEXES = 8;

function countNewlines(s) {
  let n = 0;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

function rawOf(tokens) {
  return tokens.map((t) => t.raw).join("");
}

export default class DevelopStrip {
  static stripMeaninglessHardBreaks(raw, lexFull, walkTokens) {
    const candidates = [];
    const lines = raw.split("\n");
    for (let n = 0; n < lines.length; n++) if (DevelopStrip.lineBreakSpaceCount(lines[n]) > 0) candidates.push(n);
    if (candidates.length === 0) return raw;
    const tokens = lexFull(raw);
    const state = { text: raw, shape: DevelopStrip._tokenShape(tokens, walkTokens), lexes: 1 };
    if (state.shape.spaceBreaks === candidates.length) return raw;
    const info = DevelopStrip._leafLines(raw, () => tokens);
    const breaking = [];
    const others = [];
    for (const n of candidates) {
      const at = info?.[n];
      if (at && !(at.leaf && STRIPPABLE_LEAVES.has(at.leaf.type))) continue;
      if (PARAGRAPH_LEAVES.has(at?.leaf?.type) && at.index < at.count - 1) breaking.push(n);
      else others.push(n);
    }
    DevelopStrip._stripGroup(state, others, lexFull, walkTokens);
    if (state.shape.spaceBreaks !== breaking.length) DevelopStrip._stripGroup(state, breaking, lexFull, walkTokens);
    return state.text;
  }

  static lineBreakSpaceCount(text) {
    const n = trailingRunLength(text, " ");
    return n >= 2 ? n : 0;
  }

  static _leafLines(text, lexBlocks) {
    return DevelopStrip._leafTable(text, lexBlocks)?.info ?? null;
  }

  static _leafTable(text, lexBlocks) {
    const tokens = lexBlocks(text);
    let table = null;
    if (rawOf(tokens) === text) {
      const lines = text.split("\n");
      const starts = [0];
      for (const line of lines) starts.push(starts[starts.length - 1] + line.length + 1);
      const info = new Array(lines.length).fill(null);
      DevelopStrip._mapLeaves(tokens, 0, lines, info, { quote: false, list: false });
      table = { info, lines, starts };
    }
    return table;
  }

  static _mapLeaves(tokens, firstLine, lines, info, where) {
    let line = firstLine;
    for (const token of tokens) {
      if (token.type === "list") {
        let at = line;
        for (const item of token.items ?? []) {
          DevelopStrip._mapLeaves(item.tokens ?? [], at, lines, info, { ...where, list: true });
          at += countNewlines(item.raw);
        }
      } else if (token.type === "blockquote") {
        DevelopStrip._mapLeaves(token.tokens ?? [], line, lines, info, { ...where, quote: true });
      } else if (token.type !== "space") {
        const own = trimTrailingRun(token.raw, "\n").split("\n");
        for (let k = 0; k < own.length && line + k < lines.length; k++) {
          const n = line + k;
          const part = own[k];
          const original = trimTrailingRun(lines[n], BLANKS);
          const shown = trimTrailingRun(part, BLANKS).replace(/^[ \t]+/, "");
          info[n] = original.endsWith(shown)
            ? { leaf: token, index: k, count: own.length, prefix: original.length - shown.length, ...where }
            : { leaf: null, ...where };
        }
      }
      line += countNewlines(token.raw);
    }
  }

  static _stripGroup(state, group, lexFull, walkTokens) {
    if (group.length === 0 || state.lexes >= STRIP_MAX_LEXES) return;
    state.lexes++;
    const lines = state.text.split("\n");
    for (const n of group) lines[n] = trimTrailingRun(lines[n], " ");
    const next = lines.join("\n");
    const shape = DevelopStrip._tokenShape(lexFull(next), walkTokens);
    const same =
      shape.breaks === state.shape.breaks && shape.spaceBreaks === state.shape.spaceBreaks && shape.signature === state.shape.signature;
    if (same) {
      state.text = next;
      state.shape = shape;
      return;
    }
    if (group.length === 1) return;
    const half = Math.ceil(group.length / 2);
    DevelopStrip._stripGroup(state, group.slice(0, half), lexFull, walkTokens);
    DevelopStrip._stripGroup(state, group.slice(half), lexFull, walkTokens);
  }

  static _tokenShape(tokens, walkTokens) {
    let breaks = 0;
    let spaceBreaks = 0;
    const entries = [];
    walkTokens(tokens, (token) => {
      if (token.type === "br") {
        breaks++;
        if (token.raw.startsWith(" ")) spaceBreaks++;
      }
      if (token.type === "text" || token.type === "space") return;
      const entry = [token.type];
      for (const [key, value] of Object.entries(token)) {
        if (key === "raw" || key === "type" || key === "tokens") continue;
        if (key === "text" && Array.isArray(token.tokens)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") entry.push(key, value);
      }
      entries.push(entry);
    });
    return { breaks, spaceBreaks, signature: JSON.stringify(entries) };
  }
}
