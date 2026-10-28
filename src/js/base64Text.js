// UTF-8 text <-> Base64, for the GitHub Contents API (SC-27). The BOM
// is kept as U+FEFF in the text, so a file round-trips byte for byte.

const BOM = "\uFEFF";
const CHUNK = 0x8000; // String.fromCharCode(...bytes) in pieces: no stack overflow

/**
 * @purity pure
 * @param {string} text - BOM as U+FEFF, line endings as they are
 * @returns {string} Base64 of the UTF-8 bytes
 */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode the Contents API's content (Base64 with line breaks) as strict
 * UTF-8. A NUL byte or invalid UTF-8 is not text (INV-18's rule).
 * @purity pure
 * @param {string} base64
 * @returns {{ok: true, fileText: string, hasBom: boolean}|{ok: false}}
 */
export function base64ToText(base64) {
  let binary;
  try {
    binary = atob(String(base64).replace(/\s+/g, ""));
  } catch {
    return { ok: false };
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (bytes.includes(0)) return { ok: false };
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let decoded;
  try {
    // ignoreBOM: the BOM stays in the text as U+FEFF
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false };
  }
  return { ok: true, fileText: decoded, hasBom };
}

/**
 * The text without its BOM (what DocumentSession.fromFileText takes).
 * @purity pure
 * @param {string} fileText
 * @returns {string}
 */
export function withoutBom(fileText) {
  return fileText.startsWith(BOM) ? fileText.slice(1) : fileText;
}
