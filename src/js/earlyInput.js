// The rules for a dropped file, pasted text and the launch file, in one
// place: the receiver uses them before the core runs (boot.js, INV-81 (4),
// INV-104) and UIController after.

import { APP_ID_PREFIX } from "./libraryNames.js";

/** A drop gives a file handle (CON-01): Chrome and Edge. */
export const FILE_SYSTEM_HANDLE_SUPPORTED =
  typeof DataTransferItem !== "undefined" &&
  typeof DataTransferItem.prototype.getAsFileSystemHandle === "function";

/**
 * A text field other than the top editor: a paste there is its own.
 * @purity semi-pure-a
 * @param {EventTarget|null} target
 * @param {HTMLElement|null} editor - the top editor
 * @returns {boolean}
 */
export function isOtherField(target, editor) {
  return (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") && target !== editor;
}

/**
 * Whether pasted text starts a document: the top editor is empty and the
 * text is not blank (the initial view is the caller's to check).
 * @purity pure
 * @param {string} editorValue
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function pasteStartsDocument(editorValue, text) {
  return editorValue.trim() === "" && Boolean(text) && text.trim() !== "";
}

/**
 * The file handle of a dropped item, asked for at once, inside the drop
 * (CON-01). A handle that cannot be had is no handle: it is caught here, so
 * that the awaits before it is used leave no rejection unhandled.
 * @purity non-pure
 * @param {DataTransferItem|undefined} item
 * @param {boolean} supported - FILE_SYSTEM_HANDLE_SUPPORTED
 * @returns {Promise<object|null>|null}
 */
export function dropHandlePromise(item, supported) {
  return supported && typeof item?.getAsFileSystemHandle === "function"
    ? Promise.resolve(item.getAsFileSystemHandle()).catch(() => null)
    : null;
}

/**
 * The id of the launch block: the file that the PowerShell launcher puts in
 * a copy of the page, in place of the launch slot (INV-104, SC-29).
 */
export const LAUNCH_BLOCK_ID = `${APP_ID_PREFIX}launch-file`;

/**
 * Whether an element is the launch block: a <script type="text/plain"> with
 * the launch id, right under <head> (a document never stands in, INV-104 (4)).
 * @purity semi-pure-a
 * @param {Element|null} element
 * @param {HTMLHeadElement|null} head
 * @returns {boolean}
 */
export function isLaunchBlock(element, head) {
  return element?.tagName === "SCRIPT" && element.type === "text/plain" && element.id === LAUNCH_BLOCK_ID && element.parentNode === head;
}

/**
 * The file in a launch block: its name (data-name), its full path on the PC
 * (data-path, for [Save], INV-105) and its bytes (the text), all Base64;
 * null when one cannot be decoded or the name is empty. A block without
 * data-path (an older launcher) gives the path null.
 * @purity semi-pure-a
 * @param {Element} block
 * @returns {{name: string, path: string|null, bytes: Uint8Array}|null}
 */
export function readLaunchBlock(block) {
  try {
    const name = utf8Of(block.getAttribute("data-name") ?? "");
    if (name === "") return null;
    const pathText = block.getAttribute("data-path");
    const path = pathText === null ? null : utf8Of(pathText) || null;
    return { name, path, bytes: base64Bytes(block.textContent ?? "") };
  } catch {
    return null;
  }
}

/**
 * The text of Base64-coded UTF-8 (throws on a bad character or bad UTF-8).
 * @purity pure
 * @param {string} base64
 * @returns {string}
 */
function utf8Of(base64) {
  return new TextDecoder("utf-8", { fatal: true }).decode(base64Bytes(base64));
}

/**
 * The bytes of a Base64 text (atob throws on a character outside Base64).
 * @purity pure
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
