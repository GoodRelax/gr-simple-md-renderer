// ========================================
// Outline of a code text (no DOM, no CONFIG)
// ========================================
//
// The entries of the index panel for a source file (NE-9, NE-20): line
// based heuristics per language, never a parser. Two levels for Python,
// JavaScript / TypeScript, JSON and YAML; one level (imports, types,
// functions) for C, C++, C#, Java and Go.

const OUTLINE_LANGUAGES = new Set(["python", "javascript", "typescript", "json", "yaml", "c", "cpp", "csharp", "java", "go"]);

// Words that start a statement, not a declaration.
const CONTROL_WORDS = new Set([
  "if", "for", "while", "switch", "return", "else", "do", "case", "new", "throw", "catch", "try",
  "finally", "goto", "delete", "await", "yield", "using", "typedef", "sizeof", "typeof", "nameof",
  "foreach", "lock", "fixed", "synchronized", "defined", "co_return", "co_await", "co_yield",
  "static_assert", "decltype", "alignof", "function",
]);

// Words before a JS / TS declaration at the start of a line.
const JS_PREFIXES = new Set(["export", "default", "async", "declare", "abstract"]);

// Words before a JS / TS method name in a class body (when a name follows).
const JS_METHOD_PREFIXES = new Set(["static", "async", "get", "set", "public", "private", "protected", "readonly", "override", "abstract", "declare", "accessor"]);

// Modifiers before a type declaration in C, C++, C# and Java.
const TYPE_MODIFIERS = new Set([
  "public", "private", "protected", "internal", "static", "abstract", "final", "sealed", "partial",
  "readonly", "unsafe", "new", "file", "strictfp", "export", "ref", "typedef",
]);

const TYPE_WORDS = new Set(["class", "struct", "interface", "enum", "record", "union"]);

/**
 * True when the language has an outline (hljs ids as in EXT_TO_HLJS).
 * @purity pure
 * @param {string} language
 * @returns {boolean}
 */
export function hasCodeOutline(language) {
  return OUTLINE_LANGUAGES.has(language);
}

/**
 * True when the char can be part of an identifier ($ and non-ASCII included).
 * @purity pure
 * @param {string|undefined} ch
 * @returns {boolean}
 */
function isNameChar(ch) {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
}

/**
 * The identifier starting at i ("" when none, or when it starts with a digit).
 * @purity pure
 * @param {string} s
 * @param {number} i
 * @returns {string}
 */
function nameAt(s, i) {
  let j = i;
  while (isNameChar(s[j])) j++;
  const c = s.charCodeAt(i);
  return c >= 48 && c <= 57 ? "" : s.slice(i, j);
}

/**
 * The index of the first char at or after i that is not a space or tab.
 * @purity pure
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function skipBlanks(s, i) {
  while (s[i] === " " || s[i] === "\t") i++;
  return i;
}

/**
 * The identifier after the blanks at i, and the index where it ends
 * ("" and the index of the first other char when there is none).
 * @purity pure
 * @param {string} s
 * @param {number} i - where to start
 * @returns {{word: string, end: number}}
 */
function wordAt(s, i) {
  const at = skipBlanks(s, i);
  const word = nameAt(s, at);
  return { word, end: at + word.length };
}

/**
 * One line of C-like code without its comments (strings kept), its braces
 * outside strings and comments in order, and whether a block comment is
 * still open at its end.
 * @purity pure
 * @param {string} line
 * @param {boolean} inComment - a block comment is open at the line's start
 * @param {string} quotes - the chars that open a string on one line
 * @returns {{code: string, braces: string, inComment: boolean}}
 */
function scanCodeLine(line, inComment, quotes) {
  const parts = [];
  const braces = [];
  let i = 0;
  if (inComment) {
    const end = line.indexOf("*/");
    if (end < 0) return { code: "", braces: "", inComment: true };
    i = end + 2;
    parts.push(" ".repeat(i));
  }
  let from = i;
  let open = false;
  while (i < line.length) {
    const c = line[i];
    if (quotes.includes(c)) {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else if (c === "/" && line[i + 1] === "/") {
      break;
    } else if (c === "/" && line[i + 1] === "*") {
      parts.push(line.slice(from, i), " ");
      const end = line.indexOf("*/", i + 2);
      if (end < 0) {
        open = true;
        from = line.length;
        break;
      }
      i = end + 2;
      from = i;
    } else {
      if (c === "{" || c === "}") braces.push(c);
      i++;
    }
  }
  if (from < i) parts.push(line.slice(from, Math.min(i, line.length)));
  return { code: parts.join(""), braces: braces.join(""), inComment: open };
}

// ---- Python ----

/**
 * The triple quote still open at the end of a line ('"""', "'''" or null).
 * @purity pure
 * @param {string} line
 * @param {string|null} quote - open at the line's start
 * @returns {string|null}
 */
function tripleQuoteAfter(line, quote) {
  let state = quote;
  let i = 0;
  for (;;) {
    if (state !== null) {
      const end = line.indexOf(state, i);
      if (end < 0) return state;
      state = null;
      i = end + 3;
      continue;
    }
    const a = line.indexOf('"""', i);
    const b = line.indexOf("'''", i);
    if (a < 0 && b < 0) return null;
    const at = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    state = line.slice(at, at + 3);
    i = at + 3;
  }
}

/**
 * A Python class or def at the start of s: its label and kind, or null.
 * @purity pure
 * @param {string} s - the line after its indent
 * @returns {{label: string, isClass: boolean}|null}
 */
function pythonDef(s) {
  let w = wordAt(s, 0);
  let prefix = "";
  if (w.word === "async") {
    prefix = "async ";
    w = wordAt(s, w.end);
  }
  if (w.word !== "def" && (w.word !== "class" || prefix)) return null;
  const name = wordAt(s, w.end).word;
  if (!name) return null;
  return w.word === "class" ? { label: "class " + name, isClass: true } : { label: prefix + "def " + name + "()", isClass: false };
}

/**
 * Python: top-level class / def (level 1) and the defs one level inside a
 * top-level class (level 2; the class body's first statement gives that
 * level). Lines in triple-quoted strings are skipped.
 * @purity pure
 * @param {string[]} lines
 * @returns {{line: number, level: number, label: string}[]}
 */
function pythonOutline(lines) {
  const out = [];
  let quote = null;
  let inClass = false;
  let bodyIndent = -1;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (quote !== null) {
      quote = tripleQuoteAfter(line, quote);
      continue;
    }
    const indent = skipBlanks(line, 0);
    const rest = line.slice(indent);
    if (rest === "" || rest[0] === "#") continue;
    const def = pythonDef(rest);
    if (indent === 0) {
      inClass = def !== null && def.isClass;
      bodyIndent = -1;
      if (def) out.push({ line: n, level: 1, label: def.label });
    } else if (inClass) {
      if (bodyIndent < 0) bodyIndent = indent;
      if (def && !def.isClass && indent === bodyIndent) out.push({ line: n, level: 2, label: def.label });
    }
    quote = tripleQuoteAfter(line, null);
  }
  return out;
}

// ---- JavaScript / TypeScript ----

/**
 * The index of the "=" of an assignment at or after i (not "==" or "=>"), or -1.
 * @purity pure
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function assignmentAt(s, i) {
  for (let j = i; j < s.length; j++) {
    if (s[j] !== "=") continue;
    if (s[j + 1] === "=" || s[j + 1] === ">") {
      j++;
      continue;
    }
    if (j > 0 && "=!<>".includes(s[j - 1])) continue;
    return j;
  }
  return -1;
}

/**
 * True when the right side of an assignment is a function: function ...,
 * async ..., (...) => or name =>.
 * @purity pure
 * @param {string} rhs - trimmed
 * @returns {boolean}
 */
function isFunctionValue(rhs) {
  const first = nameAt(rhs, 0);
  if (first === "function" || first === "async") return true;
  if (rhs[0] === "(" || rhs[0] === "<") return rhs.includes("=>");
  return first !== "" && rhs.slice(skipBlanks(rhs, first.length)).startsWith("=>");
}

/**
 * A JS / TS declaration at the start of a line: its label and whether it
 * is a class, or null.
 * @purity pure
 * @param {string} code - the line without comments, starting at column 0
 * @returns {{label: string, isClass: boolean}|null}
 */
function jsDeclaration(code) {
  let w = wordAt(code, 0);
  while (JS_PREFIXES.has(w.word)) w = wordAt(code, w.end);
  const kw = w.word;
  let at = w.end;
  if (kw === "function" && code[skipBlanks(code, at)] === "*") at = skipBlanks(code, at) + 1;
  let next = wordAt(code, at);
  if (kw === "const" && next.word === "enum") return named("enum ", wordAt(code, next.end).word, false);
  const name = next.word;
  if (kw === "function") return named("function ", name && name + "()", false);
  if (kw === "class") return named("class ", name === "extends" ? "" : name, true);
  if (kw === "interface" || kw === "enum") return named(kw + " ", name, false);
  if (kw === "type") return assignmentAt(code, next.end) >= 0 ? named("type ", name, false) : null;
  if (kw !== "const" && kw !== "let" && kw !== "var") return null;
  const eq = assignmentAt(code, next.end);
  if (eq < 0 || !isFunctionValue(code.slice(eq + 1).trim())) return null;
  return named(kw + " ", name && name + "()", false);
}

/**
 * An outline label from a prefix and a name, or null when the name is empty.
 * @purity pure
 * @param {string} prefix
 * @param {string} name
 * @param {boolean} isClass
 * @returns {{label: string, isClass: boolean}|null}
 */
function named(prefix, name, isClass) {
  return name ? { label: prefix + name, isClass } : null;
}

/**
 * The label of a method line in a JS / TS class body ("f()"), or null.
 * @purity pure
 * @param {string} code - trimmed, without comments
 * @returns {string|null}
 */
function jsMethod(code) {
  let i = 0;
  for (;;) {
    const w = wordAt(code, i);
    const after = skipBlanks(code, w.end);
    if (!JS_METHOD_PREFIXES.has(w.word) || "(<".includes(code[after]) || code[after] === "?") break;
    i = after;
  }
  if (code[i] === "*") i = skipBlanks(code, i + 1);
  const hash = code[i] === "#" ? "#" : "";
  const name = nameAt(code, i + hash.length);
  if (!name || CONTROL_WORDS.has(name)) return null;
  let j = skipBlanks(code, i + hash.length + name.length);
  if (code[j] === "?") j = skipBlanks(code, j + 1);
  return code[j] === "(" || code[j] === "<" ? hash + name + "()" : null;
}

/**
 * JavaScript / TypeScript: declarations at column 0 (level 1) and the
 * methods at the first indent of a top-level class body (level 2).
 * @purity pure
 * @param {string[]} lines
 * @returns {{line: number, level: number, label: string}[]}
 */
function jsOutline(lines) {
  const out = [];
  let inComment = false;
  let inClass = false;
  let bodyIndent = -1;
  for (let n = 0; n < lines.length; n++) {
    const startsInComment = inComment;
    const scan = scanCodeLine(lines[n], inComment, "'\"`");
    inComment = scan.inComment;
    const code = scan.code;
    const indent = skipBlanks(code, 0);
    if (startsInComment || indent === code.length) continue;
    if (indent === 0) {
      const decl = jsDeclaration(code);
      inClass = decl !== null && decl.isClass && !code.trimEnd().endsWith("}");
      bodyIndent = -1;
      if (decl) out.push({ line: n, level: 1, label: decl.label });
    } else if (inClass) {
      if (bodyIndent < 0) bodyIndent = indent;
      const label = indent === bodyIndent ? jsMethod(code.trim()) : null;
      if (label) out.push({ line: n, level: 2, label });
    }
  }
  return out;
}

// ---- JSON ----

/**
 * The index of the quote that closes the string opening at i, stopping
 * before a line break (an unclosed string ends at its line).
 * @purity pure
 * @param {string} text
 * @param {number} i
 * @returns {number}
 */
function jsonStringEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\n") return j - 1;
    if (c === "\\") j++;
    else if (c === '"') return j;
  }
  return text.length - 1;
}

/**
 * JSON: keys that start a line in an object at depth 1 or 2 (depth 1 =
 * members of the root), and array elements that start a line at those
 * depths as "[i]". Comments (JSONC) are skipped.
 * @purity pure
 * @param {string} text
 * @returns {{line: number, level: number, label: string}[]}
 */
function jsonOutline(text) {
  const out = [];
  const stack = []; // per open bracket: {isObject, index}
  let line = 0;
  let lineStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") {
      line++;
      lineStart = true;
      continue;
    }
    if (lineStart && (c === " " || c === "\t" || c === "\r")) continue;
    const atStart = lineStart;
    lineStart = false;
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const end = text[i + 1] === "/" ? text.indexOf("\n", i) - 1 : text.indexOf("*/", i + 2) + 1;
      if (end < i) break;
      for (let k = i; k < end; k++) if (text[k] === "\n") line++;
      i = end;
      continue;
    }
    const top = stack[stack.length - 1];
    const listed = atStart && top !== undefined && stack.length <= 2;
    if (c === '"') {
      const end = jsonStringEnd(text, i);
      if (listed && top.isObject && text[skipBlanks(text, end + 1)] === ":") {
        out.push({ line, level: stack.length, label: text.slice(i + 1, end) });
      } else if (listed && !top.isObject) {
        out.push({ line, level: stack.length, label: "[" + top.index + "]" });
      }
      i = end;
      continue;
    }
    if (listed && !top.isObject && c !== "]" && c !== ",") out.push({ line, level: stack.length, label: "[" + top.index + "]" });
    if (c === "{" || c === "[") stack.push({ isObject: c === "{", index: 0 });
    else if (c === "}" || c === "]") stack.pop();
    else if (c === "," && top !== undefined) top.index++;
  }
  return out;
}

// ---- YAML ----

/**
 * The key of a YAML mapping entry at pos (`key:` then a blank or the line's
 * end; a quoted key too), with where its value starts; or null.
 * @purity pure
 * @param {string} line
 * @param {number} pos
 * @returns {{key: string, valueAt: number}|null}
 */
function yamlKey(line, pos) {
  const c = line[pos];
  const isColon = (k) => line[k] === ":" && (k + 1 === line.length || line[k + 1] === " " || line[k + 1] === "\t");
  if (c === '"' || c === "'") {
    let end = pos + 1;
    while (end < line.length && line[end] !== c) end += c === '"' && line[end] === "\\" ? 2 : 1;
    const k = skipBlanks(line, end + 1);
    return end < line.length && isColon(k) ? { key: line.slice(pos + 1, end), valueAt: k + 1 } : null;
  }
  if (c === undefined || "[{|>!&*%@`#?,".includes(c)) return null;
  for (let j = pos; j < line.length; j++) {
    if (line[j] === "#" && line[j - 1] === " ") return null;
    if (isColon(j)) return { key: line.slice(pos, j).trimEnd(), valueAt: j + 1 };
  }
  return null;
}

/**
 * YAML: keys with no indent (level 1) and keys at the next indent under
 * them (level 2). A list item "- key:" counts at its dash. Comments,
 * document markers, directives and block scalars (| >) are skipped.
 * @purity pure
 * @param {string[]} lines
 * @returns {{line: number, level: number, label: string}[]}
 */
function yamlOutline(lines) {
  const out = [];
  let blockIndent = -1; // the indent of the key whose block scalar is open
  let hasLevel1 = false;
  let level2Indent = -1;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const indent = skipBlanks(line, 0);
    if (indent === line.length) continue;
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue;
      blockIndent = -1;
    }
    const c = line[indent];
    if (c === "#" || (indent === 0 && (line.startsWith("---") || line.startsWith("...") || c === "%"))) continue;
    let pos = indent;
    if (c === "-" && (line[pos + 1] === " " || line[pos + 1] === undefined)) pos = skipBlanks(line, pos + 1);
    const key = yamlKey(line, pos);
    if (!key) {
      if (indent === 0) hasLevel1 = false;
      continue;
    }
    const value = line.slice(key.valueAt).trim();
    if (value[0] === "|" || value[0] === ">") blockIndent = indent;
    if (indent === 0) {
      hasLevel1 = true;
      level2Indent = -1;
      out.push({ line: n, level: 1, label: key.key });
    } else if (hasLevel1) {
      if (level2Indent < 0) level2Indent = indent;
      if (indent === level2Indent) out.push({ line: n, level: 2, label: key.key });
    }
  }
  return out;
}

// ---- C, C++, C#, Java, Go ----

/**
 * How an import-like line counts: 1 (an import line), 0 (neutral: does not
 * break a run, e.g. other preprocessor lines or a Go import block's
 * parens), or -1 (not an import).
 * @purity pure
 * @param {string} code - trimmed, without comments
 * @param {string} language
 * @returns {number}
 */
function importWeight(code, language) {
  if (language === "c" || language === "cpp") {
    if (code[0] === "#") return wordAt(code, 1).word === "include" ? 1 : 0;
    return language === "cpp" && nameAt(code, 0) === "import" ? 1 : -1;
  }
  let w = wordAt(code, 0);
  if (language === "csharp") {
    if (w.word === "global") w = wordAt(code, w.end);
    if (w.word !== "using") return -1;
    const next = skipBlanks(code, w.end);
    return code[next] === "(" || nameAt(code, next) === "var" ? -1 : 1;
  }
  return w.word === "import" || w.word === "package" ? 1 : -1;
}

/**
 * The end of a balanced <...> or (...) that opens at i (the index after
 * its close), or the string's length.
 * @purity pure
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function balancedEnd(s, i) {
  const open = s[i];
  const close = open === "<" ? ">" : ")";
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  return s.length;
}

/**
 * A type declaration line: "class X", "struct X", ... (Go: "type X" for a
 * struct or interface), or null.
 * @purity pure
 * @param {string} code - trimmed, without comments
 * @param {string} language
 * @returns {string|null}
 */
function typeDeclaration(code, language) {
  let w = wordAt(code, 0);
  if (language === "go") {
    if (w.word !== "type") return null;
    const name = wordAt(code, w.end);
    const kind = wordAt(code, name.end).word;
    return name.word && (kind === "struct" || kind === "interface") ? "type " + name.word : null;
  }
  if (w.word === "template" && code[skipBlanks(code, w.end)] === "<") w = wordAt(code, balancedEnd(code, skipBlanks(code, w.end)));
  while (TYPE_MODIFIERS.has(w.word)) w = wordAt(code, w.end);
  if (!TYPE_WORDS.has(w.word)) return null;
  const kw = w.word;
  let name = wordAt(code, w.end);
  if ((kw === "enum" || kw === "record") && (name.word === "class" || name.word === "struct")) name = wordAt(code, name.end);
  if (!name.word) return null;
  const rest = code.slice(name.end).trim();
  const fits = rest === "" || "{:<(".includes(rest[0]) || ["extends", "implements", "where", "permits", "final"].includes(nameAt(rest, 0));
  return fits ? kw + " " + name.word : null;
}

/**
 * A function declaration or definition line: "name()", or null.
 * Go: func name( and func (r T) name(. Others: words with a type (or a
 * modifier) before name(, not a statement (control word first, an
 * assignment, a call on an object).
 * @purity pure
 * @param {string} code - trimmed, without comments
 * @param {string} language
 * @returns {string|null}
 */
function functionDeclaration(code, language) {
  if (language === "go") {
    const w = wordAt(code, 0);
    if (w.word !== "func") return null;
    let at = skipBlanks(code, w.end);
    if (code[at] === "(") at = balancedEnd(code, at);
    const name = wordAt(code, at);
    const after = code[skipBlanks(code, name.end)];
    return name.word && (after === "(" || after === "[") ? name.word + "()" : null;
  }
  const paren = code.indexOf("(");
  if (paren <= 0 || !isNameChar(code[0])) return null;
  let head = code.slice(0, paren).trimEnd();
  if (head.endsWith(">")) {
    let depth = 0;
    let j = head.length - 1;
    for (; j >= 0; j--) {
      if (head[j] === ">") depth++;
      else if (head[j] === "<" && --depth === 0) break;
    }
    head = head.slice(0, Math.max(j, 0)).trimEnd();
  }
  let k = head.length;
  while (k > 0 && (isNameChar(head[k - 1]) || head[k - 1] === ":" || head[k - 1] === "~")) k--;
  const name = head.slice(k).replace(/^:+/, "");
  const before = head.slice(0, head.length - name.length).trim();
  if (!name || name.split("::").join("").includes(":") || CONTROL_WORDS.has(name) || CONTROL_WORDS.has(nameAt(code, 0))) return null;
  if (before === "" && !name.includes("::")) return null;
  if (/[=;"'(){}+!|\/%^]/.test(before) || before.endsWith(".") || before.endsWith("->")) return null;
  return name + "()";
}

/**
 * C, C++, C#, Java, Go (level 1): runs of import lines as one entry
 * "import (N)", type declarations, and function declarations outside
 * function bodies (braces are followed: a body that is not a type's or a
 * namespace's hides what is in it).
 * @purity pure
 * @param {string[]} lines
 * @param {string} language
 * @returns {{line: number, level: number, label: string}[]}
 */
function cFamilyOutline(lines, language) {
  const out = [];
  const quotes = language === "go" ? "'\"`" : "'\"";
  const scopes = []; // per open brace: true for a type or namespace body
  let hidden = 0; // open braces that are not a type's or a namespace's
  let pendingContainer = false;
  let inComment = false;
  let goImports = false; // inside Go's import ( ... )
  let runLine = -1;
  let runCount = 0;
  for (let n = 0; n < lines.length; n++) {
    const scan = scanCodeLine(lines[n], inComment, quotes);
    inComment = scan.inComment;
    const code = scan.code.trim();
    if (code === "") continue;
    let weight = -1;
    if (goImports) {
      weight = code === ")" ? 0 : 1;
      goImports = code !== ")";
    } else if (hidden === 0) {
      weight = importWeight(code, language);
      if (language === "go" && weight === 1 && wordAt(code, 0).word === "import" && code.endsWith("(")) {
        goImports = true;
        weight = 0;
        if (runLine < 0) runLine = n;
      }
    }
    if (weight >= 0) {
      if (weight === 1 && runLine < 0) runLine = n;
      runCount += weight;
      continue;
    }
    if (runLine >= 0) {
      out.push({ line: runLine, level: 1, label: "import (" + runCount + ")" });
      runLine = -1;
      runCount = 0;
    }
    let container = false;
    if (hidden === 0) {
      const type = typeDeclaration(code, language);
      const first = wordAt(code, 0).word;
      container = type !== null || first === "namespace" || code.startsWith('extern "C"') || (first === "export" && wordAt(code, wordAt(code, 0).end).word === "namespace");
      const label = type ?? functionDeclaration(code, language);
      if (label) out.push({ line: n, level: 1, label });
    }
    if (scan.braces === "") {
      if (container && !code.endsWith(";")) pendingContainer = true;
      else if (code.endsWith(";")) pendingContainer = false;
      continue;
    }
    for (let b = 0; b < scan.braces.length; b++) {
      if (scan.braces[b] === "{") {
        const isContainer = b === 0 && (container || pendingContainer) && hidden === 0;
        scopes.push(isContainer);
        if (!isContainer) hidden++;
        pendingContainer = false;
      } else if (scopes.length > 0 && !scopes.pop()) {
        hidden--;
      }
    }
  }
  if (runLine >= 0) out.push({ line: runLine, level: 1, label: "import (" + runCount + ")" });
  return out;
}

/**
 * Outline entries of a code text, in line order (0-based lines). Any
 * language without an outline gives []. Never throws.
 * @purity pure
 * @param {string} text - LF text
 * @param {string} language - hljs id
 * @returns {{line: number, level: 1|2, label: string}[]}
 */
export function buildCodeOutline(text, language) {
  try {
    if (language === "json") return jsonOutline(text);
    if (!hasCodeOutline(language)) return [];
    const lines = text.split("\n");
    if (language === "python") return pythonOutline(lines);
    if (language === "javascript" || language === "typescript") return jsOutline(lines);
    if (language === "yaml") return yamlOutline(lines);
    return cFamilyOutline(lines, language);
  } catch {
    return [];
  }
}
