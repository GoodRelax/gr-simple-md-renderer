// The receiver that runs before the core (INV-81 (4)). The build makes an
// IIFE of src/js/bootScript.js and puts it right after the markup, as a
// classic script, so it runs while the rest of the file is still arriving.
// It defines the one global the core and the on-demand libraries share,
// window.__grsmdBoot:
//   arrive(name, data) - the script after a library's data block: the data is
//                        all in; data is that block, kept by reference (5)
//   provide(name, lib) - a library's own script, when it runs
//   shared             - what the core lends the libraries (DOMPurify for mermaid)
//   takeEarlyInput()   - the core takes the last drop or paste made before it ran
// Until the core takes over, a drop never makes the browser open the file
// (leaving the page), and the last file dropped or text pasted is kept in
// memory only, for the core to use as if it came now. Nothing is stored.
// A launch block (the file a PowerShell launcher put in a copy of the page,
// INV-104) is taken at once as the first such drop, and removed from the page.
// The rules are the core's own (earlyInput.js).

import {
  FILE_SYSTEM_HANDLE_SUPPORTED,
  LAUNCH_BLOCK_ID,
  dropHandlePromise,
  isLaunchBlock,
  isOtherField,
  pasteStartsDocument,
  readLaunchBlock,
} from "./earlyInput.js";
import { DATA_ID_PREFIX } from "./libraryNames.js";

/**
 * Whether an element is the data block of the library: a parser-made
 * <script type="text/plain"> with the library's id. The note that calls
 * arrive() comes right after it in the file.
 * @purity semi-pure-a
 * @param {Element|null} data
 * @param {string} name
 * @returns {boolean}
 */
function isDataBlock(data, name) {
  return data?.tagName === "SCRIPT" && data.type === "text/plain" && data.id === `${DATA_ID_PREFIX}${name}`;
}

/**
 * The nearest <script> at or before an element, among its siblings: the
 * element the note passes is the one right before it, but the page may have
 * put an element at the end of <body> while the file was still arriving
 * (mermaid's tooltip, when a document with a diagram opened early), between
 * a data block and its note. Those are skipped (INV-81 (2)).
 * @purity semi-pure-a
 * @param {Element|null} element
 * @returns {Element|null}
 */
function nearestScript(element) {
  let found = element;
  while (found && found.tagName !== "SCRIPT") found = found.previousElementSibling;
  return found;
}

/**
 * Put window.__grsmdBoot in place and receive drops and pastes until the
 * core takes over.
 * @purity non-pure
 * @param {Window} win
 */
export function installBoot(win) {
  const doc = win.document;
  const boot = {
    arrived: new Set(),
    data: new Map(), // name -> its data block (by reference: a document's id never stands in, INV-81 (5))
    provided: new Map(),
    shared: {},
    onArrive: null,
    early: null,
    /**
     * @param {string} name
     * @param {Element|null} data - the element right before the note
     * @purity non-pure
     */
    arrive(name, data) {
      const block = nearestScript(data);
      if (isDataBlock(block, name)) boot.data.set(name, block);
      win.performance.mark(`grsmd-arrived-${name}`);
      boot.arrived.add(name);
      if (boot.onArrive) boot.onArrive(name);
    },
    /**
     * @param {string} name
     * @param {object} library
     * @purity non-pure
     */
    provide(name, library) {
      boot.provided.set(name, library);
    },
    /**
     * The core runs: the listeners here go, and the last input is handed over.
     * @returns {{kind: "drop", file: File, handlePromise: Promise|null, launchPath?: string|null}|{kind: "paste", text: string}|null}
     * @purity non-pure
     */
    takeEarlyInput() {
      doc.removeEventListener("dragover", onDragOver);
      doc.removeEventListener("drop", onDrop);
      doc.removeEventListener("paste", onPaste);
      const early = boot.early;
      boot.early = null;
      return early;
    },
  };

  /**
   * @param {DragEvent} e
   * @purity non-pure
   */
  function onDragOver(e) {
    e.preventDefault();
  }

  /**
   * @param {DragEvent} e
   * @purity non-pure
   */
  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const handlePromise = dropHandlePromise(e.dataTransfer.items?.[0], FILE_SYSTEM_HANDLE_SUPPORTED);
    boot.early = { kind: "drop", file, handlePromise };
  }

  /**
   * @param {ClipboardEvent} e
   * @purity non-pure
   */
  function onPaste(e) {
    const editor = doc.getElementById("editor");
    if (isOtherField(e.target, editor)) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!pasteStartsDocument(editor?.value ?? "", text)) return;
    e.preventDefault();
    boot.early = { kind: "paste", text };
  }

  doc.addEventListener("dragover", onDragOver);
  doc.addEventListener("drop", onDrop);
  doc.addEventListener("paste", onPaste);
  takeLaunchBlock(win, boot);
  win.__grsmdBoot = boot;
}

/**
 * The launch block, if the page has one (INV-104): read it, remove it from
 * the page, and keep its file as the early drop (no file handle). A block
 * that cannot be read leaves no early input and one console warning.
 * @purity non-pure
 * @param {Window} win
 * @param {{early: object|null}} boot
 */
function takeLaunchBlock(win, boot) {
  const doc = win.document;
  const block = doc.getElementById(LAUNCH_BLOCK_ID);
  if (!isLaunchBlock(block, doc.head)) return;
  const launched = readLaunchBlock(block);
  block.remove();
  if (!launched) {
    console.warn("GRSMD: the launch file could not be read.");
    return;
  }
  // the full path goes with it, for [Save] (INV-105); null when unknown
  boot.early = { kind: "drop", file: new win.File([launched.bytes], launched.name), handlePromise: null, launchPath: launched.path };
}
