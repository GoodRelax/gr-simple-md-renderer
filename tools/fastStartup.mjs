// Fast startup (INV-81, spec 5.17): the layout of the built single file.
// vite-plugin-singlefile puts the whole module script and the CSS in <head>,
// so nothing shows and nothing works until the file has all arrived. Here
// the file is laid out so that the page is usable after the first tens of
// kilobytes (order O2, owner decision 2026-10-21):
//   1 <meta charset>, the CSP (added later by the CSP plugin), the head
//   2 <style>: the CSS without the KaTeX @font-face rules
//   3 the markup
//   4 the receiver (src/js/boot.js), a classic script
//   5 the core, a classic script (the module code in a strict function)
//   6 mermaid, 7 highlight.js, 8 KaTeX: each a data block
//     <script type="text/plain" id="grsmd-lib-NAME"> and a one-line script
//     that says it has arrived
//   9 <style>: the KaTeX @font-face rules (fonts as data URIs)
//  10 the PlantUML encoder, as 6 to 8
// The functions here are pure; vite.config.js runs them on the build output.

/** The on-demand libraries in the order they are put in the file (O2). */
export const LAZY_LIBRARIES = Object.freeze([
  Object.freeze({ name: "mermaid", entry: "src/js/lazy/mermaid.js", sharesDompurify: true }),
  Object.freeze({ name: "hljs", entry: "src/js/lazy/hljs.js", sharesDompurify: false }),
  Object.freeze({ name: "katex", entry: "src/js/lazy/katex.js", sharesDompurify: false }),
  Object.freeze({ name: "plantuml", entry: "src/js/lazy/plantuml.js", sharesDompurify: false }),
]);

/** The KaTeX fonts come right after this library. */
export const FONTS_AFTER = "katex";

/** The id of a library's data block (LibraryLoader's DATA_ID_PREFIX). */
export const DATA_ID_PREFIX = "grsmd-lib-";

/**
 * Whether the HTML parser ends a script element whose text is this at the
 * end tag that follows it. The tokenizer's script data states (HTML 13.2.5)
 * are followed for a text with no "</script" of its own: after "<!--" the
 * text is escaped, a "<script" there opens the double-escaped state, where
 * the end tag does not end the element, and "-->" goes back to the start.
 * @purity pure
 * @param {string} text
 * @returns {boolean}
 */
export function endsAtItsEndTag(text) {
  const lower = text.toLowerCase();
  let escaped = false;
  let double = false;
  let dashes = 0; // "-" in a row just before, in an escaped state
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    if (!escaped) {
      if (c === "<" && lower.startsWith("<!--", i)) {
        escaped = true;
        dashes = 2;
        i += 3;
      }
      continue;
    }
    if (c === "-") {
      dashes++;
      continue;
    }
    if (c === ">" && dashes >= 2) {
      escaped = false;
      double = false;
    } else if (c === "<" && !double && lower.startsWith("<script", i) && /[\t\n\f\r />]/.test(lower[i + 7] ?? "")) {
      double = true;
      i += 6;
    }
    dashes = 0;
  }
  return !double;
}

/**
 * A script's code as the text of a <script> element: every "</script" is
 * written "<\/script" (the same code in a string, a template, a regular
 * expression or a comment, where it can only be). Text the parser would not
 * end at the element's end tag fails the build.
 * @purity pure
 * @param {string} code
 * @param {string} name - for the error
 * @returns {string}
 */
export function escapeScriptData(code, name) {
  const text = code.replace(/<\/(script)/gi, "<\\/$1");
  if (!endsAtItsEndTag(text)) {
    throw new Error(`${name}: its text would not end at </script> ("<!--" and "<script" in it)`);
  }
  return text;
}

/**
 * The module code of the core as a classic script, so that it runs as soon
 * as it is parsed (an inline module script waits for the whole file). The
 * code is a bundle: no import or export is left; import.meta has no
 * meaning outside a module and fails the build.
 * @purity pure
 * @param {string} code
 * @returns {string}
 */
export function classicCore(code) {
  if (code.includes("import.meta")) throw new Error("the core uses import.meta; it cannot run as a classic script");
  return `(()=>{"use strict";\n${code}\n})();`;
}

/**
 * The CSS without its @font-face rules, and those rules.
 * @purity pure
 * @param {string} css
 * @returns {{css: string, fonts: string}}
 */
export function splitFontFaces(css) {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return { css: css.replace(/@font-face\s*\{[^}]*\}/g, ""), fonts: faces.join("") };
}

/**
 * The built file in the order of the startup (see the top of this file).
 * @purity pure
 * @param {string} html - vite-plugin-singlefile's output
 * @param {{boot: string, libraries: {name: string, code: string}[]}} parts
 *   boot: the receiver's code; libraries: in LAZY_LIBRARIES order
 * @returns {string}
 */
export function layoutForFastStartup(html, { boot, libraries }) {
  // The code itself may hold "</head>" or "<body>" (in strings): the parts
  // are found one after the other.
  const scriptStart = html.indexOf('<script type="module"');
  const codeStart = html.indexOf(">", scriptStart) + 1;
  const codeEnd = html.indexOf("</script>", codeStart);
  const styleStart = html.indexOf("<style", codeEnd);
  const cssStart = html.indexOf(">", styleStart) + 1;
  const cssEnd = html.indexOf("</style>", cssStart);
  const headEnd = html.indexOf("</head>", cssEnd);
  const bodyEnd = html.lastIndexOf("</body>");
  if ([scriptStart, codeEnd, styleStart, cssEnd, headEnd].includes(-1) || bodyEnd < headEnd) {
    throw new Error("unexpected layout of the built file");
  }
  if (html.slice(0, scriptStart).includes("<body") || html.slice(codeEnd, styleStart).includes("<body") || html.slice(cssEnd, headEnd).includes("<body")) {
    throw new Error("the module script and the inlined <style> are not in <head>");
  }

  const core = html.slice(codeStart, codeEnd);
  const { css, fonts } = splitFontFaces(html.slice(cssStart, cssEnd));
  const head =
    html.slice(0, scriptStart).replace(/\s+$/, "") +
    html.slice(codeEnd + "</script>".length, styleStart) +
    `<style>${css}</style>` +
    html.slice(cssEnd + "</style>".length, headEnd);

  const tail = [`<script>${escapeScriptData(boot, "boot")}</script>`, `<script>${escapeScriptData(classicCore(core), "core")}</script>`];
  for (const { name, code } of libraries) {
    tail.push(
      `<script type="text/plain" id="${DATA_ID_PREFIX}${name}">${escapeScriptData(code, name)}</script>`,
      `<script>__grsmdBoot.arrive("${name}")</script>`,
    );
    if (name === FONTS_AFTER) tail.push(`<style>${fonts}</style>`);
  }
  return `${head}${html.slice(headEnd, bodyEnd)}${tail.join("\n")}\n${html.slice(bodyEnd)}`;
}
