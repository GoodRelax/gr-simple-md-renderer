// The open checks of a file (INV-11, INV-18; owner rulings AQ1, AQ9, AQ11):
// its size and file type by name before it is read, and U+0000 in its
// decoded text after. A drop and a Reload run the same checks; a refusal is
// thrown as a FileRefusal, and the caller shows its alert.

import { CONFIG, FILE_TYPE_BY_MATCH } from "./config.js";
import { containsNul } from "./textEncoding.js";
import FileRefusal from "./classes/FileRefusal.js";

/**
 * How a dropped file is handled, decided before anything is read (INV-11,
 * INV-18, owner rulings AQ1, AQ9): over the size limit, "tooLarge"; else
 * the file type (FILE_TYPES, spec 5.4) of its extension (lower case), then
 * of its whole name, says "markdown" or "code"; a file of no listed type is
 * "notAllowed". Its content is checked after decoding (U+0000, AQ11).
 * @purity semi-pure-a
 * @param {string} fileName
 * @param {number} fileSize
 * @returns {"tooLarge"|"markdown"|"code"|"notAllowed"}
 */
export function classifyDroppedFile(fileName, fileSize) {
  if (fileSize > CONFIG.fileDrop.maxBytes) return "tooLarge";
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  const type = FILE_TYPE_BY_MATCH.get(ext) ?? FILE_TYPE_BY_MATCH.get(fileName);
  return type ? type.open : "notAllowed";
}

/**
 * The open checks before a file is read (INV-11, INV-18 (1)-(4)): its size
 * and its type by name.
 * @purity semi-pure-a
 * @param {{name: string, size: number}} file
 * @returns {"markdown"|"code"} how it opens
 * @throws {FileRefusal} too large, or of no listed type
 */
export function checkFileToOpen(file) {
  const kind = classifyDroppedFile(file.name, file.size);
  if (kind === "tooLarge" || kind === "notAllowed") throw new FileRefusal(kind);
  return kind;
}

/**
 * The open check on the decoded text (INV-18 (5), owner ruling AQ11).
 * @purity pure
 * @param {string} text
 * @returns {string} the text
 * @throws {FileRefusal} the text holds U+0000
 */
export function checkTextToOpen(text) {
  if (containsNul(text)) throw new FileRefusal("binaryFile");
  return text;
}
