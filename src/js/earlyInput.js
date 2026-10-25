// The rules for a dropped file and pasted text, in one place: the receiver
// uses them before the core runs (boot.js, INV-81 (4)) and UIController
// after.

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
