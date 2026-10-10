import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");

/**
 * Read docs/<name> and normalize CRLF and lone CR to LF.
 * The working tree may hold CRLF (core.autocrlf=true), so tests never read samples directly.
 * @param {string} name - file name under docs/
 * @returns {string}
 */
export function loadSampleLf(name) {
  return readFileSync(resolve(docsDir, name), "utf8").replace(/\r\n?/g, "\n");
}
