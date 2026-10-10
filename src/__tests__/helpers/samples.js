import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");
const fixtureDir = resolve(here, "../fixtures/inplace-edit");

const toLf = (s) => s.replace(/\r\n?/g, "\n");

/**
 * Read docs/<name> and normalize CRLF and lone CR to LF.
 * The working tree may hold CRLF (core.autocrlf=true), so tests never read samples directly.
 * @param {string} name - file name under docs/
 * @returns {string}
 */
export function loadSampleLf(name) {
  return toLf(readFileSync(resolve(docsDir, name), "utf8"));
}

/**
 * Read src/__tests__/fixtures/inplace-edit/<name> as LF text.
 * @param {string} name
 * @returns {string}
 */
export function loadFixtureLf(name) {
  return toLf(readFileSync(resolve(fixtureDir, name), "utf8"));
}

/** @returns {string[]} fixture file names */
export function listFixtures() {
  return readdirSync(fixtureDir).filter((n) => n.endsWith(".md")).sort();
}

/** LF -> CRLF. */
export function toCrlf(s) {
  return s.replace(/\n/g, "\r\n");
}

/** UTF-8 bytes of s, with the BOM (EF BB BF) in front. */
export function withBom(s) {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/** The same lexer setup as main.js: Marked + markedKatex({ throwOnError: false }). */
export function makeLexer() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return (src) => marked.lexer(src);
}
