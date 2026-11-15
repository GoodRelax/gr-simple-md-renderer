// Spec: 5.16.3, AT-CMT-01, AT-CMT-02, AT-CMT-03, AT-CMT-04, AT-CMT-05, AT-CMT-06, AT-CMT-07, AT-CMT-08.
// Why: Other teams copy this core, so it imports nothing and takes an ESTree AST with acorn-style start and end offsets.

// Section: items and rule IDs

/**
 * Spec: 5.16.3.
 * @type {{key: string, rule: string}[]}
 */
export const COMMENT_ITEMS = [
  { key: "kind", rule: "R3 Comments (kinds)" },
  { key: "english", rule: "R3 Comments (kinds)" },
  { key: "spec-id", rule: "R3 Comments (Spec)" },
  { key: "summary", rule: "R3 Comments (Summary)" },
  { key: "temporary", rule: "R3 Comments (Temporary)" },
  { key: "purity", rule: "R7 `@purity` Tag" },
];

// Why: The upstream kinds end with a colon; the JSDoc tags are the GRSMD kinds of the 5.2 reading.
const WORD_KIND = /^(Why|Spec|Summary|Temporary|Section|Consistency):(?=\s|$)/;
const JSDOC_KINDS = ["purity", "param", "returns", "throws", "type", "property", "typedef", "template"];
const TAG_KIND = new RegExp(`^@(${JSDOC_KINDS.join("|")})(?![\\w-])`);
const INLINE_TAG = new RegExp(`\\s(?=@(?:${JSDOC_KINDS.join("|")})(?![\\w-]))`);

// Why: A tool reads these comments as settings, so the 5.2 reading puts them outside the kind rule; a diff that uses a new directive adds it here.
const TOOL_DIRECTIVES = [/^@vitest-environment(?![\w-])/];

// Why: The 5.2 reading of R3 Comments (Spec) names these prefixes; other hyphenated words such as UTF-8 are no spec IDs.
const ID_TOKEN = /\b(?:INV|CON|SC|FS|OS|AT|PRT)(?:-[A-Za-z0-9]+)+(?![\w-])/g;
const SECTION_TOKEN = /(?<![\w.-])(?:\d+(?:\.\d+)+|\d+-[a-z])(?![\w-])/g;
const SECTION_LINE = /^(?:#{1,6}\s+|\*\*)(\d+(?:\.\d+)*|\d+-[a-z])(?![\w.-])/;
const AT_FAMILY_ROW = /^\|\s*(AT-[A-Z0-9-]+?)\s*\|/;
const AT_ID = /^(AT(?:-[A-Z][A-Z0-9]*)+)-\d+[a-z]?$/;

// Section: comment text

/**
 * Summary: The function shall return the trimmed, non-empty body lines of one comment without its markers.
 * @param {string} text the comment source: one block comment, or "//" lines joined by "\n"
 * @returns {string[]}
 */
export function commentLines(text) {
  if (text.startsWith("/*")) {
    const body = text.replace(/^\/\*(?:\*(?!\/))?/, "").replace(/\*\/$/, "");
    return body
      .split("\n")
      .map((line) => line.trim().replace(/^\*(?!\/)\s?/, "").trim())
      .filter(Boolean);
  }
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^\/\/+/, "").trim())
    .filter(Boolean);
}

/**
 * @param {string} piece
 * @returns {string | null} the kind that starts the piece
 */
export function kindOf(piece) {
  const word = WORD_KIND.exec(piece);
  if (word) return word[1];
  const tag = TAG_KIND.exec(piece);
  return tag ? `@${tag[1]}` : null;
}

/**
 * Spec: 5.16.3.
 * @param {string[]} lines
 * @returns {{lead: string, segments: {kind: string, text: string}[]}}
 */
export function segmentsOf(lines) {
  let lead = "";
  const segments = [];
  for (const line of lines) {
    for (const piece of line.split(INLINE_TAG)) {
      const kind = kindOf(piece);
      if (kind) {
        segments.push({ kind, text: piece.slice(kind.length + (kind.startsWith("@") ? 0 : 1)).trim() });
      } else if (segments.length > 0) {
        const last = segments[segments.length - 1];
        last.text = `${last.text} ${piece}`.trim();
      } else {
        lead = `${lead} ${piece}`.trim();
      }
    }
  }
  return { lead, segments };
}

/**
 * Spec: 5.16.3.
 * @param {string} text
 * @returns {number}
 */
export function countSentences(text) {
  const plain = text
    .replace(/`[^`]*`/g, "x")
    .replace(/"[^"\n]*"/g, "x")
    .replace(/\b(?:e\.g|i\.e|etc|vs|cf)\./gi, "x");
  return plain.split(/[.!?]+(?=\s|$)/).filter((part) => /[A-Za-z0-9]/.test(part)).length;
}

// Section: spec IDs

/**
 * Summary: The function shall collect the spec IDs, the section numbers and the AT families of the spec texts.
 * @param {string[]} texts the three spec files
 * @returns {{ids: Set<string>, sections: Set<string>, atFamilies: Set<string>}}
 */
export function collectSpecIds(texts) {
  const known = { ids: new Set(), sections: new Set(), atFamilies: new Set() };
  for (const text of texts) {
    for (const match of text.matchAll(ID_TOKEN)) known.ids.add(match[0]);
    for (const line of text.split("\n")) {
      const section = SECTION_LINE.exec(line);
      if (section) known.sections.add(section[1]);
      const family = AT_FAMILY_ROW.exec(line);
      if (family) known.atFamilies.add(family[1]);
    }
  }
  return known;
}

/**
 * Summary: The function shall return the spec IDs and section numbers that a Spec segment cites outside code spans.
 * @param {string} text
 * @returns {string[]}
 */
export function citedIds(text) {
  const plain = text.replace(/`[^`]*`/g, " ");
  return [...plain.matchAll(ID_TOKEN), ...plain.matchAll(SECTION_TOKEN)].map((match) => match[0]);
}

/**
 * Spec: 5.16.3.
 * @param {string} id
 * @param {{ids: Set<string>, sections: Set<string>, atFamilies: Set<string>}} known
 * @returns {boolean}
 */
export function specIdExists(id, known) {
  if (known.ids.has(id) || known.sections.has(id)) return true;
  const at = AT_ID.exec(id);
  return at !== null && known.atFamilies.has(at[1]);
}

// Section: judging one comment

/**
 * Summary: The function shall return one violation per failed item (kind, english, spec-id, summary, temporary) of one comment.
 * @param {string} text the comment source
 * @param {{ids: Set<string>, sections: Set<string>, atFamilies: Set<string>}} known from collectSpecIds
 * @returns {{item: string, reason: string}[]}
 */
export function judgeComment(text, known) {
  const all = commentLines(text);
  const lines = all.length > 0 && TOOL_DIRECTIVES.some((directive) => directive.test(all[0])) ? all.slice(1) : all;
  if (lines.length === 0) return [];
  const out = [];
  const { lead, segments } = segmentsOf(lines);
  if (lead !== "") out.push({ item: "kind", reason: `starts without a kind: "${lead.slice(0, 40)}"` });
  if (/[^\x00-\x7f]/.test(lines.join("\n"))) out.push({ item: "english", reason: "holds a character outside ASCII" });
  const specs = segments.filter((segment) => segment.kind === "Spec");
  const missing = specs.flatMap((segment) => citedIds(segment.text).filter((id) => !specIdExists(id, known)));
  if (specs.some((segment) => citedIds(segment.text).length === 0)) out.push({ item: "spec-id", reason: "Spec cites no ID" });
  else if (missing.length > 0) out.push({ item: "spec-id", reason: `unknown ID: ${missing.join(", ")}` });
  const hasTemporary = segments.some((segment) => segment.kind === "Temporary");
  for (const segment of segments.filter((s) => s.kind === "Summary")) {
    const sentences = countSentences(segment.text);
    if (sentences > 3) out.push({ item: "summary", reason: `Summary has ${sentences} sentences` });
    else if (sentences >= 2 && !hasTemporary) out.push({ item: "summary", reason: `Summary has ${sentences} sentences and no Temporary` });
  }
  if (segments.some((segment) => segment.kind === "Temporary" && !/\bUntil:\s*\S/.test(segment.text))) {
    out.push({ item: "temporary", reason: "Temporary has no Until:" });
  }
  return dedupeByItem(out);
}

/**
 * Summary: The function shall keep the first violation of each item, so one comment counts at most once per item.
 * @param {{item: string, reason: string}[]} violations
 * @returns {{item: string, reason: string}[]}
 */
function dedupeByItem(violations) {
  const seen = new Set();
  return violations.filter((v) => !seen.has(v.item) && seen.add(v.item));
}

// Section: extracting comments

/**
 * Summary: The function shall return the [start, end) ranges of the string literals, regex literals and template texts of an ESTree AST.
 * @param {object} ast
 * @returns {[number, number][]}
 */
export function literalRanges(ast) {
  const ranges = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if ((node.type === "Literal" && (typeof node.value === "string" || node.regex)) || node.type === "TemplateElement") {
      ranges.push([node.start, node.end]);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast);
  return ranges;
}

/**
 * Summary: The function shall blank every character inside the ranges except newlines, so offsets and line numbers stay true.
 * @param {string} src
 * @param {[number, number][]} ranges
 * @returns {string}
 */
export function maskRanges(src, ranges) {
  const chars = src.split("");
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

/**
 * Spec: 5.16.3.
 * @param {string} masked the source after maskRanges
 * @returns {{line: number, text: string}[]} each comment with the line it starts on
 */
export function extractComments(masked) {
  const raw = [];
  let line = 1;
  let lineStart = 0;
  const hashbangEnd = masked.startsWith("#!") ? masked.indexOf("\n") : 0;
  for (let i = hashbangEnd < 0 ? masked.length : hashbangEnd; i < masked.length; i++) {
    const c = masked[i];
    if (c === "\n") {
      line++;
      lineStart = i + 1;
    } else if (c === "/" && masked[i + 1] === "/") {
      const end = masked.indexOf("\n", i);
      const stop = end < 0 ? masked.length : end;
      raw.push({ line, text: masked.slice(i, stop).trimEnd(), ownLine: masked.slice(lineStart, i).trim() === "" });
      i = stop - 1;
    } else if (c === "/" && masked[i + 1] === "*") {
      const end = masked.indexOf("*/", i + 2);
      const stop = end < 0 ? masked.length : end + 2;
      const text = masked.slice(i, stop);
      raw.push({ line, text, block: true });
      for (const ch of text) if (ch === "\n") line++;
      if (text.includes("\n")) lineStart = i + text.lastIndexOf("\n") + 1;
      i = stop - 1;
    }
  }
  return groupLineComments(raw);
}

/**
 * Spec: 5.16.3.
 * @param {{line: number, text: string, ownLine?: boolean, block?: boolean}[]} raw
 * @returns {{line: number, text: string}[]}
 */
function groupLineComments(raw) {
  const out = [];
  let run = null;
  for (const c of raw) {
    const joins = run && !c.block && c.ownLine && run.ownLine && c.line === run.lastLine + 1;
    if (joins) {
      run.text += `\n${c.text}`;
      run.lastLine = c.line;
      continue;
    }
    if (run) out.push({ line: run.line, text: run.text });
    run = c.block ? null : { line: c.line, text: c.text, lastLine: c.line, ownLine: c.ownLine };
    if (c.block) out.push({ line: c.line, text: c.text });
  }
  if (run) out.push({ line: run.line, text: run.text });
  return out;
}

// Section: ratchet

/**
 * @param {{file: string, item: string}[]} violations
 * @returns {Record<string, Record<string, number>>} the count of each item per file
 */
export function countByFile(violations) {
  const counts = {};
  for (const { file, item } of violations) {
    counts[file] ??= {};
    counts[file][item] = (counts[file][item] ?? 0) + 1;
  }
  return counts;
}

/**
 * Spec: 5.16.3.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @returns {{file: string, item: string, base: number, now: number}[]}
 */
export function ratchetRises(baseline, current) {
  const rises = [];
  for (const [file, items] of Object.entries(current)) {
    for (const [item, now] of Object.entries(items)) {
      const base = baseline[file]?.[item] ?? 0;
      if (now > base) rises.push({ file, item, base, now });
    }
  }
  return rises;
}

/**
 * Spec: 5.16.3.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @returns {{file: string, item: string, base: number, now: number}[]}
 */
export function ratchetFalls(baseline, current) {
  const falls = [];
  for (const [file, items] of Object.entries(baseline)) {
    for (const [item, base] of Object.entries(items)) {
      const now = current[file]?.[item] ?? 0;
      if (now < base) falls.push({ file, item, base, now });
    }
  }
  return falls;
}

/**
 * Spec: 5.16.3.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @returns {Record<string, Record<string, number>>}
 */
export function lowerBaseline(baseline, current) {
  const next = {};
  for (const file of Object.keys(current).sort()) {
    for (const item of Object.keys(current[file]).sort()) {
      const kept = Math.min(current[file][item], baseline[file]?.[item] ?? 0);
      if (kept > 0) (next[file] ??= {})[item] = kept;
    }
  }
  return next;
}

/**
 * Spec: 5.16.3.
 * @param {string | undefined} mode the value of GRSMD_COMMENT_BASELINE: "update", "create" or none
 * @param {Record<string, Record<string, number>> | null} baseline null when the JSON is missing
 * @param {Record<string, Record<string, number>>} current
 * @returns {{write: Record<string, Record<string, number>> | null, error: string | null}}
 */
export function planBaseline(mode, baseline, current) {
  if (mode === "update") {
    return baseline === null ? { write: null, error: "update needs the baseline JSON; create it with GRSMD_COMMENT_BASELINE=create" } : { write: lowerBaseline(baseline, current), error: null };
  }
  if (mode === "create") {
    return baseline === null ? { write: lowerBaseline(current, current), error: null } : { write: null, error: "create refuses to replace the baseline JSON; lower it with GRSMD_COMMENT_BASELINE=update" };
  }
  return { write: null, error: null };
}
