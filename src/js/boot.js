// The receiver that runs before the core (INV-81 (4)). The build puts it
// right after the markup, as a classic script, so it runs while the rest of
// the file is still arriving. It defines the one global the core and the
// on-demand libraries share, window.__grsmdBoot:
//   arrive(name)       - the script after a library's data block: the data is all in
//   provide(name, lib) - a library's own script, when it runs
//   shared             - what the core lends the libraries (DOMPurify for mermaid)
//   takeEarlyInput()   - the core takes the last drop or paste made before it ran
// Until the core takes over, a drop never makes the browser open the file
// (leaving the page), and the last file dropped or text pasted is kept in
// memory only, for the core to use as if it came now. Nothing is stored.
/** @purity non-pure */
(() => {
  /**
   * @purity semi-pure-a
   * @param {EventTarget|null} target
   * @returns {boolean}
   */
  const isOtherField = (target) =>
    (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") && target.id !== "editor";

  const boot = {
    arrived: new Set(),
    provided: new Map(),
    shared: {},
    onArrive: null,
    early: null,
    /**
     * @param {string} name
     * @purity non-pure
     */
    arrive(name) {
      performance.mark(`grsmd-arrived-${name}`);
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
     * @returns {{kind: "drop", file: File, handlePromise: Promise|null}|{kind: "paste", text: string}|null}
     * @purity non-pure
     */
    takeEarlyInput() {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
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
   * The handle is asked for at once, inside the event (CON-01).
   * @param {DragEvent} e
   * @purity non-pure
   */
  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const item = e.dataTransfer.items?.[0];
    const handlePromise =
      typeof item?.getAsFileSystemHandle === "function"
        ? Promise.resolve(item.getAsFileSystemHandle()).catch(() => null)
        : null;
    boot.early = { kind: "drop", file, handlePromise };
  }

  /**
   * A paste into the empty top editor (or the page) starts a document once
   * the core runs, as it would then.
   * @param {ClipboardEvent} e
   * @purity non-pure
   */
  function onPaste(e) {
    if (isOtherField(e.target)) return;
    const editor = document.getElementById("editor");
    if (editor && editor.value.trim() !== "") return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.trim()) return;
    e.preventDefault();
    boot.early = { kind: "paste", text };
  }

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("paste", onPaste);
  window.__grsmdBoot = boot;
})();
