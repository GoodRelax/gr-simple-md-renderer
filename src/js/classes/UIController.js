import { CONFIG, EXT_TO_HLJS, BINARY_EXTENSIONS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applyTheme, applySystemTheme, systemTheme, showToast, nextFrame, shortcutLetter } from "../utils.js";
import { splitMarkdownWrapper, normalizeLineEndings, hasUtf8Bom } from "../textTransforms.js";
import ModalController from "./ModalController.js";
import BlockEditController from "./BlockEditController.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import ClipboardLink from "./ClipboardLink.js";

/**
 * An Undo or Redo of the browser's editing history.
 * @purity pure
 * @param {InputEvent} e
 * @returns {boolean}
 */
function isHistoryInput(e) {
  return e.inputType === "historyUndo" || e.inputType === "historyRedo";
}

/**
 * INV-14: a key typed into an input, a textarea (the block editor included),
 * a contenteditable element or a role="toolbar" (the edit palette) is not a
 * document shortcut. The role is checked as written (ruling T2).
 * @purity semi-pure-b
 * @param {Element|null} el - the focused element
 * @returns {boolean}
 */
function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === "function" && el.closest('[role="toolbar"]') !== null;
}

/**
 * A shortcut that is taken and does nothing (INV-58 outside the Markdown view).
 * @purity pure
 */
function noAction() {}

/**
 * A text entry other than the block editor (INV-59 (a)): an input, a
 * textarea, a select or a contenteditable element.
 * @purity semi-pure-b
 * @param {Element|null} el
 * @returns {boolean}
 */
function isTextEntry(el) {
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true;
}

/**
 * How a dropped file is handled, decided before anything is read (INV-11,
 * INV-18): "sniff" means an unknown extension whose first 8 KB must be
 * checked for a null byte.
 * @purity semi-pure-a
 * @param {string} fileName
 * @param {number} fileSize
 * @returns {"tooLarge"|"markdown"|"code"|"binary"|"sniff"}
 */
export function classifyDroppedFile(fileName, fileSize) {
  if (fileSize > CONFIG.fileDrop.maxBytes) return "tooLarge";
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  if (CONFIG.fileDrop.markdownExtensions.includes(ext)) return "markdown";
  if (EXT_TO_HLJS[ext] || EXT_TO_HLJS[fileName]) return "code";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  return "sniff";
}

/**
 * @purity pure
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function hasNullByte(bytes) {
  return bytes.some((b) => b === 0);
}

/**
 * What [Render] / l / d does in each view (Sect 5.8, spec 5.14.1):
 * "theme" (code view: CSS only), "editorIntoDocument" (markdown view: the
 * same document, line endings normalized, no wrapper split, ruling T33) or
 * "newDocument" (initial state: normalize, then split the wrapper).
 * @purity pure
 * @param {boolean} isCodeView
 * @param {boolean} isPreRender
 * @returns {"theme"|"editorIntoDocument"|"newDocument"}
 */
export function renderRouteFor(isCodeView, isPreRender) {
  if (isCodeView) return "theme";
  return isPreRender ? "newDocument" : "editorIntoDocument";
}

// The one-key shortcuts of setupKeyboard (3.12) that wait until an inserted
// block's cell or source has opened (INV-52, owner ruling D5).
const ONE_KEY_SHORTCUTS = new Set(["l", "d", "r", "n", "c", "e"]);

/**
 * Translates UI events into use-case calls.
 * Handles: render buttons, utility buttons, file drop (all files),
 * paste, keyboard shortcuts, modals, long-press.
 * Manages view mode UI chrome via setViewMode() and showKeyHint().
 */
export default class UIController {
  /**
   * @param {RendererOrchestrator} orchestrator
   * @param {ApplicationState} state
   * @param {object} elements
   * @param {SmoothScrollEngine} scrollEngine
   * @param {object} services - in-place editing parts (composed in main.js):
   *   documents (DocumentLifecycle), createPalette(host) -> EditPalette,
   *   createBlockEdit(host) -> BlockEditController, isApple (Cmd is the
   *   primary shortcut modifier, INV-14), clipboard (what the Paste link
   *   button reads, INV-69; navigator.clipboard when not given)
   * @purity non-pure
   */
  constructor(orchestrator, state, elements, scrollEngine, services) {
    this.orchestrator = orchestrator;
    this.state = state;
    this.elements = elements;
    this.scrollEngine = scrollEngine;
    this.longPressTimer = null;
    this.isLongPress = false;
    this._keyHintTimer = null;

    // Session, save target and save state (INV-55, 11-e)
    this.documents = services.documents;
    this._isApple = Boolean(services.isApple);
    this._clipboard = "clipboard" in services ? () => services.clipboard : () => navigator.clipboard;
    this._editorChangedSinceRender = false; // INV-45
    this._paletteStatesPending = false; // a frame is asked for (INV-51)
    this._buttonStatesDeferred = false; // asked for inside an 11-c crossing (K-1)
    this._isReadingClipboard = false; // Paste link waits for the clipboard (INV-69)
    this._clipboardRead = 0; // the latest read: only it ends the wait
    this._baseTitle = document.title;
    this._lastTap = null; // double tap on the empty preview (INV-31)
    this._isEditorHistoryStale = false; // #editor's undo history after a system write (5.7 (6))
    this._isEditorTextStale = false; // #editor not yet given the body after a large commit (INV-47)
    this.palette = services.createPalette(this._paletteHost());
    this.blockEdit = services.createBlockEdit(this._blockEditHost());
    this.orchestrator.setModelChangedListener(this);

    this.setupEventListeners();
    this.setupModals();
    this.setupPromptText();

    // Initialize view: show affordance and set initial view mode
    this._showAffordance();
    this.setViewMode("initial");
  }

  /** @purity non-pure */
  setupEventListeners() {
    this.setupRenderButtons();
    this.setupUtilityButtons();
    this.setupHelpButton();
    this.setupPromptButton();
    this.setupFileDrop();
    this.setupAutoRenderOnPaste();
    this.setupKeyboard();
    this.setupTouchPasteAssist();
    this.setupEditorSync();
    this.setupDoubleClickGestures();
    this.setupUnloadGuard();
    // Apply OS color-scheme preference on first load
    applySystemTheme();
  }

  /**
   * Strip an optional ```markdown fenced wrapper that AI tools sometimes add.
   * Delegates to splitMarkdownWrapper (spec 5.13): both fences must match.
   * @param {string} rawText
   * @returns {string}
   * @purity pure
   */
  preprocessInput(rawText) {
    return splitMarkdownWrapper(rawText).body;
  }

  // ---- View mode management ----

  /**
   * Set the application view mode and update UI chrome accordingly.
   * @param {'initial'|'markdown'|'code'} mode
   * @param {CodeViewMeta} [metadata] - required when mode is 'code'
   * @purity non-pure
   */
  setViewMode(mode, metadata) {
    // Set body class: view-initial / view-markdown / view-code
    document.body.classList.remove("view-initial", "view-markdown", "view-code");
    document.body.classList.add(`view-${mode}`);

    const fileInfo = this.elements.fileInfo;
    const editor = this.elements.editor;
    const affordance = document.getElementById("affordanceText");
    this.elements.editBtn.disabled = mode === "code"; // OS-06

    switch (mode) {
      case "code":
        if (fileInfo) {
          fileInfo.textContent = this._formatFileInfo(metadata);
          fileInfo.style.display = "block";
        }
        editor.readOnly = true;
        editor.style.display = "none";
        if (affordance) affordance.style.display = "none";
        break;
      case "markdown":
        if (fileInfo) fileInfo.style.display = "none";
        editor.readOnly = false;
        editor.style.display = "";
        if (affordance) affordance.style.display = "none";
        break;
      case "initial":
        if (fileInfo) fileInfo.style.display = "none";
        editor.readOnly = false;
        editor.style.display = "";
        if (affordance) affordance.style.display = "block";
        break;
    }
  }

  /**
   * Show keyboard shortcut hints in #keyHint, then dismiss on
   * timeout (5s), keydown, scroll, or click.
   * @param {'initial'|'markdown'|'code'} mode
   * @purity non-pure
   */
  showKeyHint(mode) {
    const hint = this.elements.keyHint;
    if (!hint) return;
    const text = CONFIG.keyHints[mode];
    if (!text) {
      hint.style.display = "none";
      return;
    }
    // Clear any previous dismissal listeners
    this._clearKeyHintDismiss();

    hint.textContent = text;
    hint.style.opacity = "1";
    hint.style.display = "block";

    // The hint can be shown inside the handler of a click or key (a render
    // starts synchronously, INV-47). That same event still bubbles to
    // document, so it must not dismiss the hint (PRT-D01).
    const showingEvent = window.event;
    /** @purity non-pure */
    const dismiss = (e) => {
      if (e && e === showingEvent) return;
      hint.style.opacity = "0";
      this._clearKeyHintDismiss();
    };

    this._keyHintTimer = setTimeout(dismiss, CONFIG.codeView.keyHintDurationMs);

    // No { once: true }: the showing event may reach a listener first.
    // _clearKeyHintDismiss removes them all.
    this._keyHintDismissHandler = dismiss;
    document.addEventListener("keydown", dismiss);
    this.elements.preview.addEventListener("scroll", dismiss);
    document.addEventListener("click", dismiss);
    document.addEventListener("touchmove", dismiss);
  }

  /**
   * Remove all keyHint dismissal listeners and clear timer.
   * @purity non-pure
   */
  _clearKeyHintDismiss() {
    clearTimeout(this._keyHintTimer);
    if (this._keyHintDismissHandler) {
      document.removeEventListener("keydown", this._keyHintDismissHandler);
      this.elements.preview.removeEventListener("scroll", this._keyHintDismissHandler);
      document.removeEventListener("click", this._keyHintDismissHandler);
      document.removeEventListener("touchmove", this._keyHintDismissHandler);
      this._keyHintDismissHandler = null;
    }
  }

  /**
   * Format CodeViewMeta into a display string for #fileInfo.
   * @param {CodeViewMeta} metadata
   * @returns {string}
   * @purity semi-pure-a
   */
  _formatFileInfo(metadata) {
    if (!metadata) return "";
    const { fileName, fileSize, lineCount, updatedAtStr } = metadata;
    const text = CONFIG.messages.fileInfo;
    const sizeStr = text.size((fileSize / 1024).toFixed(2));
    const linesStr = text.lines(lineCount.toLocaleString());
    return `${fileName}  |  ${linesStr}  |  ${sizeStr}\n${text.updated(updatedAtStr)}`;
  }

  // ---- Affordance management ----

  /**
   * Show affordance text in #preview. Called during initialization
   * and on clear to display the initial state hint.
   * @purity non-pure
   */
  _showAffordance() {
    let el = this.elements.preview.querySelector("#affordanceText");
    if (!el) {
      el = document.createElement("div");
      el.id = "affordanceText";
      this.elements.preview.appendChild(el);
    }
    const msg = CONFIG.messages.startScreen;
    // FS-16: Pad with whitespace lines so iOS Safari has rendered content
    // to register click events across the entire preview area.
    const pad = "\n" + " \n".repeat(50);
    el.textContent = msg + pad;
    el.style.display = "block";
  }

  // ---- Event setup ----

  /**
   * FS-16: Touch paste assist.
   * In pre-render state with empty editor, touching/clicking #preview
   * focuses the editor so the user can long-press to paste on iOS.
   * @purity non-pure
   */
  setupTouchPasteAssist() {
    const preview = this.elements.preview;
    const editor = this.elements.editor;

    /** @purity non-pure */
    preview.addEventListener("click", (e) => {
      if (!this.orchestrator.isPreRenderState()) return;
      if (editor.value.trim() !== "") return;
      editor.focus();
    });
  }

  /** @purity non-pure */
  setupRenderButtons() {
    /** @purity non-pure */
    this.elements.renderLightBtn.addEventListener("click", async () => {
      await this.handleRender("light");
    });
    /** @purity non-pure */
    this.elements.renderDarkBtn.addEventListener("click", async () => {
      await this.handleRender("dark");
    });
  }

  /** @purity non-pure */
  setupUtilityButtons() {
    /** @purity non-pure */
    this.elements.reloadBtn.addEventListener("click", async () => {
      await this.handleReload();
    });
    /** @purity non-pure */
    this.elements.newTabBtn.addEventListener("click", () => {
      window.open(window.location.href, "_blank");
    });
    /** @purity non-pure */
    this.elements.clearBtn.addEventListener("click", () => {
      this.doClear();
    });
    /** @purity non-pure */
    this.elements.editBtn.addEventListener("click", () => {
      this.toggleEditPalette();
    });
  }

  /**
   * Dispatch render / theme switch based on current view state (Sect 5.8).
   * - Code view: CSS-only toggle (no DOM rebuild).
   * - Markdown view: the #editor text into the same document (an open block
   *   editor is committed first; no unsaved confirm, INV-45; an empty
   *   #editor over a non-empty document asks first, INV-56).
   * - Initial state with editor content: a new document.
   * @param {'light'|'dark'} theme
   * @purity non-pure
   */
  async handleRender(theme) {
    const route = renderRouteFor(
      this.orchestrator.isCodeViewActive(),
      this.orchestrator.isPreRenderState(),
    );
    if (route === "theme") {
      // Code view: hljs uses CSS classes, so just toggle body.dark
      applyTheme(theme);
      this.state.setTheme(theme);
    } else if (route === "editorIntoDocument") {
      if (!this._confirmEditorIntoDocument()) return;
      await this._renderEditorIntoDocument(theme);
    } else {
      await this._startPastedDocument(this.elements.editor.value, theme);
    }
  }

  /**
   * Reload the current file (Sect 5.8, INV-21 Reload order, INV-55).
   * - Code view: reload via sourceFileRenderer.
   * - Markdown view: read the file from the save target first, then check
   *   saving and unsaved changes, then replace the document synchronously.
   * - Initial state: no-op.
   * @purity non-pure
   */
  async handleReload() {
    if (this.orchestrator.isPreRenderState()) return;
    const theme = this.state.currentTheme;
    if (this.orchestrator.isCodeViewActive()) {
      let metadata;
      try {
        metadata = await this.orchestrator.reloadCodeView(theme);
      } catch {
        this._toast(CONFIG.messages.edit.reloadFailed); // the file could not be read (N4)
        return;
      }
      if (metadata) this.setViewMode("code", metadata);
      return;
    }
    const target = this.documents.reloadTarget();
    if (!target) {
      const msg = FILE_SYSTEM_HANDLE_SUPPORTED
        ? CONFIG.codeView.reloadNoFileMsg
        : CONFIG.codeView.reloadUnavailableMsg;
      this._toast(msg);
      return;
    }
    let loaded;
    try {
      loaded = await this.documents.readFile(target);
    } catch {
      this._toast(CONFIG.messages.edit.reloadFailed);
      return;
    }
    // One synchronous step from here: nothing can change the document
    // between the stale check, the questions and the replace.
    if (this.documents.isStale(target)) {
      this._toast(CONFIG.messages.edit.reloadCanceled);
      return;
    }
    if (this._rejectWhileSaving() || !this._confirmDiscardIfDirty()) return;
    this.blockEdit.dispatch("documentReplaced");
    this.documents.reload(loaded);
    await this._showSessionBody(theme);
  }

  /**
   * Full clear: destroy view, clear editor, restore system theme,
   * set view mode to initial. Asks first when unsaved (INV-21).
   * @purity non-pure
   */
  doClear() {
    if (this._rejectWhileSaving() || !this._confirmDiscardIfDirty()) return;
    this._resetToInitial();
  }

  /**
   * Back to the initial state (the clear, without its questions).
   * @purity non-pure
   */
  _resetToInitial() {
    this.blockEdit.dispatch("documentCleared");
    this.documents.close();
    this._editorChangedSinceRender = false;
    this.scrollEngine.destroy();
    this.orchestrator.clear();
    this._setEditorText("");
    applySystemTheme();
    this._showAffordance();
    this.setViewMode("initial");
    this._refreshDirtyMark();
  }

  /**
   * Document-level drag-and-drop handler.
   * Routes by extension: .md -> Markdown Preview, all others -> Code View.
   * Follows CON-01: getAsFileSystemHandle() must be called synchronously
   * before the first await.
   * @purity non-pure
   */
  setupFileDrop() {
    /** @purity non-pure */
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    /** @purity non-pure */
    document.addEventListener("drop", async (e) => {
      e.preventDefault();

      const item = e.dataTransfer.items?.[0];

      // CON-01: call synchronously before any await
      // a handle that cannot be had is no handle; caught here, at once, so
      // that the awaits before it is used leave no rejection unhandled
      const handlePromise =
        FILE_SYSTEM_HANDLE_SUPPORTED && typeof item?.getAsFileSystemHandle === "function"
          ? Promise.resolve(item.getAsFileSystemHandle()).catch(() => null)
          : null;

      const file = e.dataTransfer.files[0];
      if (!file) return;
      await this._handleDroppedFile(file, handlePromise);
    });
  }

  /**
   * INV-21 order: (2) classify and read, (3) refuse while saving, (4) ask
   * when unsaved, (5) replace synchronously right after the answer.
   * .md -> Markdown preview (new session and save target); other text ->
   * code view (no document).
   * @param {File} file
   * @param {Promise|null} handlePromise - taken before the first await (CON-01)
   * @purity non-pure
   */
  async _handleDroppedFile(file, handlePromise) {
    let kind = classifyDroppedFile(file.name, file.size);
    if (kind === "tooLarge") {
      alert(CONFIG.fileDrop.messages.tooLarge);
      return;
    }
    if (kind === "binary") {
      alert(CONFIG.fileDrop.messages.binaryFile);
      return;
    }
    let text = "";
    let hasBom = false;
    try {
      if (kind === "sniff") {
        const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
        if (hasNullByte(bytes)) {
          alert(CONFIG.fileDrop.messages.binaryFile);
          return;
        }
        kind = "code";
      }
      if (kind === "markdown") {
        hasBom = hasUtf8Bom(new Uint8Array(await file.slice(0, 3).arrayBuffer()));
        text = await file.text();
      }
    } catch (_) {
      alert(CONFIG.fileDrop.messages.readError);
      return;
    }
    const fileHandle = handlePromise ? await handlePromise : null;

    if (this._rejectWhileSaving() || !this._confirmDiscardIfDirty()) return;
    if (kind === "markdown") {
      this.blockEdit.dispatch("documentReplaced");
      this.documents.openFile(text, hasBom, file.lastModified, file.name, fileHandle);
      this.orchestrator.resetExternalImageConsent(); // INV-43
      await this._showSessionBody(systemTheme());
      return;
    }
    this.blockEdit.dispatch("viewSwitchedToCode");
    this.documents.close();
    this._editorChangedSinceRender = false;
    this._setEditorText(""); // RTC2-07: clear editor before code view
    const rendering = this.orchestrator.renderCodeView(file, fileHandle);
    this._refreshDirtyMark();
    let metadata;
    try {
      metadata = await rendering;
    } catch {
      // the file could not be read after all (release test N4): nothing is shown
      alert(CONFIG.fileDrop.messages.readError);
      this._resetToInitial();
      return;
    }
    this.setViewMode("code", metadata);
    this.showKeyHint("code");
  }

  /**
   * Global paste handler: auto-render when in initial state and editor is empty.
   * @purity non-pure
   */
  setupAutoRenderOnPaste() {
    /** @purity non-pure */
    document.addEventListener("paste", async (e) => {
      const target = e.target;
      const isOtherInput =
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT") &&
        target !== this.elements.editor;
      if (isOtherInput) return;
      // Only auto-render from initial state with empty editor
      if (
        !this.orchestrator.isPreRenderState() ||
        this.elements.editor.value.trim() !== ""
      )
        return;
      const raw = e.clipboardData.getData("text/plain");
      if (!raw || !raw.trim()) return;
      e.preventDefault();
      await this._startPastedDocument(raw, systemTheme());
    });
  }

  /**
   * Keyboard shortcuts (Sect 3.12).
   * Up/Down: smooth scroll (disabled in initial state).
   * l / d: render or reload with theme.
   * n: new tab.
   * c: clear.
   * @purity non-pure
   */
  setupKeyboard() {
    /** @purity non-pure */
    document.addEventListener("keydown", (e) => {
      // INV-14 (1): a key an editor, a cell or the palette already handled.
      if (e.defaultPrevented) return;
      // INV-14 (2): the primary-modifier shortcuts come before the guard.
      if (this._handlePrimaryShortcut(e)) return;
      // INV-14. The event target counts too: Esc in the block editor closes
      // it, so the focus has already left when the key reaches the document.
      if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // INV-14: modifier guard
      // INV-52: until the inserted block's cell or source opens, a typed
      // letter is not a shortcut (owner ruling D5)
      if (this.blockEdit.isInsertPending() && ONE_KEY_SHORTCUTS.has(e.key)) return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (!this.orchestrator.isPreRenderState())
            this.scrollEngine.startScroll(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (!this.orchestrator.isPreRenderState())
            this.scrollEngine.startScroll(+1);
          break;
        case "l":
          this.handleRender("light");
          break;
        case "d":
          this.handleRender("dark");
          break;
        case "r":
          this.handleReload();
          break;
        case "n":
          window.open(window.location.href, "_blank");
          break;
        case "c":
          this.doClear();
          break;
        case "e":
          this.toggleEditPalette();
          break;
        case "Escape":
          // Markdown view: hide the palette, or apply and close the open block
          // editor when the focus is outside it (5.11, 11-c escapePressed). A held
          // Esc acts once: its repeats do nothing (owner ruling Q-a).
          if (e.repeat) break;
          if (!this.orchestrator.isPreRenderState() && !this.orchestrator.isCodeViewActive())
            this.blockEdit.dispatch("escapePressed");
          break;
      }
    });

    /** @purity non-pure */
    document.addEventListener("keyup", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown")
        this.scrollEngine.stopScroll();
    });
  }

  /**
   * INV-58 to INV-60. Returns true when the key was taken: its default is
   * stopped, and the function runs unless the key is a repeat (a held key
   * runs it once; owner ruling, 2026-10-21).
   * @purity non-pure
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  _handlePrimaryShortcut(e) {
    const run = this._primaryShortcutAction(shortcutLetter(e, this._isApple), e);
    if (!run) return false;
    e.preventDefault();
    if (!e.repeat) run();
    return true;
  }

  /**
   * What a primary-modifier shortcut does here, or null when it is left to
   * the browser (INV-58 to INV-60).
   * @purity semi-pure-b
   * @param {string|null} letter
   * @param {KeyboardEvent} e
   * @returns {(() => void)|null}
   */
  _primaryShortcutAction(letter, e) {
    if (letter === "s") {
      // INV-58: taken in every view (owner ruling, 2026-10-21); it saves in
      // the Markdown view only, started inside the keydown (INV-33).
      if (this.orchestrator.isPreRenderState() || this.orchestrator.isCodeViewActive()) return noAction;
      /** @purity non-pure */
      return () => (e.shiftKey ? this.requestSaveAs() : this.requestSave());
    }
    const isRedo = (letter === "z" && e.shiftKey) || (letter === "y" && !e.shiftKey && !this._isApple);
    if ((letter === "z" && !e.shiftKey) || isRedo) {
      // INV-59: edit mode only (ruling Q3). Redo (primary + Shift + Z, and
      // Ctrl+Y outside Apple platforms) goes by the same rules (owner ruling
      // D7), except in the block editor, where it is the browser's (ruling M5).
      if (!this.palette.isShown()) return null;
      const active = document.activeElement;
      if (this.blockEdit.isCellElement(active)) {
        // (c): in a cell Undo is always by unit (ruling Q2); the cell takes Redo itself
      } else if (this.blockEdit.isEditorElement(active)) {
        // (b) the browser's character Undo with a change; its Redo always
        // (the typing an Undo took back can come again; ruling M5, 2026-10-24)
        if (isRedo || this.blockEdit.hasUncommittedChange()) return null;
      } else if (active === this.elements.editor || isTextEntry(active)) {
        return null; // (a)
      }
      const event = isRedo ? "redoRequested" : "undoRequested";
      /** @purity non-pure */
      return () => {
        this.blockEdit.dispatch(event); // (c)
        this._refreshDirtyMark();
      };
    }
    if ((letter === "b" || letter === "i") && !e.shiftKey) {
      // INV-60 (Shift not pressed): only while an editor is open.
      if (!this.blockEdit.isEditing() || document.activeElement === this.elements.editor) return null;
      const command = letter === "b" ? "bold" : "italic";
      /** @purity non-pure */
      return () => {
        if (this._paletteStates()[command]) this._runPaletteCommand(command);
      };
    }
    return null;
  }

  // ---- In-place editing (SC-22 to SC-24) ----

  /**
   * [Edit] / e (5.11, INV-31): toggle the palette in the markdown view; in
   * the initial state start an empty document (empty #editor) or render
   * #editor with the system theme first; nothing in code view (OS-06).
   * @returns {Promise<void>}
   * @purity non-pure
   */
  async toggleEditPalette() {
    if (this.orchestrator.isCodeViewActive()) return;
    if (this.orchestrator.isPreRenderState()) {
      if (this.elements.editor.value.trim() === "") {
        await this._startEmptyDocument();
        return;
      }
      await this.handleRender(systemTheme());
      if (!this.orchestrator.isPreRenderState() && !this.palette.isShown()) this._showPalette();
      return;
    }
    if (this.palette.isShown()) this._hidePalette();
    else this._showPalette();
  }

  /**
   * ModelChangedPort (INV-47): a commit, insert or undo changed the model
   * inside the current event handler; #editor follows at once.
   * @param {{model: MarkdownBlockModel}} change
   * @purity non-pure
   */
  onModelChanged(change) {
    const body = change.model.toBody();
    if (body.length > CONFIG.edit.editorSyncMaxChars) {
      // Written before the user can use #editor (_syncEditorText); the
      // system reads the model meanwhile (_editorText).
      this._isEditorTextStale = true;
    } else {
      this._setEditorText(body);
    }
    this._editorChangedSinceRender = false;
    this._refreshDirtyMark();
  }

  /**
   * ModelChangedPort: the body could not be split into blocks, so it is
   * edited as one block (INV-41).
   * @purity non-pure
   */
  onBlockSplitFailed() {
    this._toast(CONFIG.messages.edit.blockSplitFailed);
  }

  /**
   * #editor input marks unrendered changes (5.7 (2), INV-45); a focus moving
   * into #editor commits an open block editor (5.7 (5), editorFocused).
   * The browser's Undo / Redo can act on #editor while the focus is elsewhere
   * (Chromium sends historyUndo to the last edited textarea): keep the block
   * editor's undo history away from #editor, so only an Undo / Redo typed in
   * #editor itself may change it, and only after the user's own input since
   * the last system write (5.7 (6)).
   * @purity non-pure
   */
  setupEditorSync() {
    /** @purity non-pure */
    this.elements.editor.addEventListener("beforeinput", (e) => {
      if (this._isEditorTextStale) {
        // Input without focus or drag (defensive): it would land in old text.
        e.preventDefault();
        this._syncEditorText();
        return;
      }
      if (!isHistoryInput(e)) return;
      if (document.activeElement !== this.elements.editor || this._isEditorHistoryStale) e.preventDefault();
    });
    /** @purity non-pure */
    this.elements.editor.addEventListener("dragenter", () => this._syncEditorText());
    /** @purity non-pure */
    this.elements.editor.addEventListener("input", (e) => {
      if (!isHistoryInput(e)) this._isEditorHistoryStale = false;
      this._editorChangedSinceRender = true;
      this._refreshDirtyMark();
    });
    /** @purity non-pure */
    this.elements.editor.addEventListener("focusin", () => {
      if (this.blockEdit.isEditing()) this.blockEdit.dispatch("editorFocused");
      this._syncEditorText(); // before the user can type (INV-47)
    });
    // Bold / Italic follow the editor's selection (5.15.5), once per frame
    // (INV-51). Capture also sees the event when it is fired at the textarea.
    /** @purity non-pure */
    document.addEventListener(
      "selectionchange",
      () => {
        if (this.palette.isShown()) this._schedulePaletteStates();
      },
      true,
    );
  }

  /**
   * A double click or a double tap on the preview: on the empty initial
   * preview it starts an empty document (INV-31); in the Markdown view
   * outside edit mode it enters edit mode and opens what was double-clicked
   * (INV-57, 11-c previewDoubleClicked).
   * @purity non-pure
   */
  setupDoubleClickGestures() {
    const preview = this.elements.preview;
    /** @purity non-pure */
    preview.addEventListener("dblclick", (e) => this._handlePreviewDoubleClick(e));
    /** @purity non-pure */
    preview.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" || !this._acceptsDoubleClick()) {
        this._lastTap = null;
        return;
      }
      const tap = { time: performance.now(), x: e.clientX, y: e.clientY };
      if (BlockEditController.isDoubleTap(this._lastTap, tap)) {
        this._lastTap = null;
        this._handlePreviewDoubleClick(e);
      } else {
        this._lastTap = tap;
      }
    });
  }

  /**
   * The preview takes a double click: the empty initial state (INV-31) or
   * the Markdown view (INV-57). Not the code view.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _acceptsDoubleClick() {
    if (this._canStartEmptyDocument()) return true;
    return !this.orchestrator.isPreRenderState() && !this.orchestrator.isCodeViewActive();
  }

  /**
   * A double click (or double tap) on the preview: start an empty document
   * (INV-31), or 11-c previewDoubleClicked in the Markdown view (INV-57;
   * only browsingPreview has a cell for it).
   * @purity non-pure
   * @param {MouseEvent|PointerEvent} e - the dblclick, or the pointerup of a double tap
   */
  _handlePreviewDoubleClick(e) {
    if (this._canStartEmptyDocument()) {
      this._startEmptyDocument();
      return;
    }
    if (this.orchestrator.isPreRenderState() || this.orchestrator.isCodeViewActive()) return;
    const target = this.blockEdit.doubleClickTarget(e);
    if (!target) return;
    this.blockEdit.dispatch("previewDoubleClicked", target);
    this._refreshDirtyMark();
  }

  /**
   * INV-22: registered once; it asks only while the document is unsaved.
   * @purity non-pure
   */
  setupUnloadGuard() {
    /** @purity non-pure */
    window.addEventListener("beforeunload", (e) => {
      if (!this._isDocumentDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _canStartEmptyDocument() {
    return this.orchestrator.isPreRenderState() && this.elements.editor.value.trim() === "";
  }

  /**
   * INV-31: a new empty document with the palette and the first block's editor.
   * @returns {Promise<void>}
   * @purity non-pure
   */
  _startEmptyDocument() {
    if (this._rejectWhileSaving()) return Promise.resolve();
    this.documents.startPasted("");
    this._setEditorText("");
    this._editorChangedSinceRender = false;
    this.setViewMode("markdown");
    this.showKeyHint("markdown");
    const opening = this.blockEdit.dispatch("emptyDocumentStarted");
    this._refreshDirtyMark();
    return opening ?? Promise.resolve();
  }

  /**
   * Initial state: a new document from pasted text or #editor. Line endings
   * are normalized before the wrapper is split (spec 5.14.1).
   * @param {string} rawText
   * @param {'light'|'dark'} theme
   * @purity non-pure
   */
  async _startPastedDocument(rawText, theme) {
    const body = this.preprocessInput(normalizeLineEndings(rawText));
    if (!body.trim() || this._rejectWhileSaving()) return;
    this.documents.startPasted(body);
    await this._showSessionBody(theme);
  }

  /**
   * Markdown view: the #editor text becomes the document body. Only line
   * endings are normalized; the wrapper is not split again (ruling T33).
   * The session and its baseline stay (5.14.11).
   * @param {'light'|'dark'} theme
   * @purity non-pure
   */
  async _renderEditorIntoDocument(theme) {
    this.blockEdit.dispatch("fullRenderRequested"); // commits an open editor first
    const rendering = this._takeEditorIntoModel(theme);
    this.setViewMode("markdown");
    this.showKeyHint("markdown");
    await rendering;
  }

  /**
   * The #editor text becomes the model now (line endings normalized only,
   * ruling T33); the full render is queued. The mark drops here (T32).
   * @param {'light'|'dark'} theme
   * @returns {Promise<void>} the queued render
   * @purity non-pure
   */
  _takeEditorIntoModel(theme) {
    this.state.setMarkdownText(normalizeLineEndings(this._editorText()));
    this._editorChangedSinceRender = false;
    const rendering = this.orchestrator.reRender(theme);
    this._refreshDirtyMark();
    return rendering;
  }

  /**
   * INV-45: a block tap (or Undo / insert) found unrendered #editor changes.
   * @purity non-pure
   */
  _renderFromEditorFirst() {
    if (!this._confirmEditorIntoDocument()) return;
    this._renderEditorIntoDocument(this.state.currentTheme);
    this._toast(CONFIG.messages.edit.editorRenderedFirst);
  }

  /**
   * A system write to #editor. The browser's undo history of #editor no
   * longer matches its text, so #editor's own Undo / Redo waits until the
   * user types in #editor again (5.7 (6)).
   * @param {string} text
   * @purity non-pure
   */
  _setEditorText(text) {
    this.elements.editor.value = text;
    this._isEditorHistoryStale = true;
    this._isEditorTextStale = false;
  }

  /**
   * The text #editor stands for: the body while a large commit has not been
   * written into it yet (INV-47), else what it shows.
   * @purity semi-pure-b
   * @returns {string}
   */
  _editorText() {
    return this._isEditorTextStale ? this.orchestrator.getBody() : this.elements.editor.value;
  }

  /**
   * Write the body into #editor if a large commit left it stale (INV-47).
   * @purity non-pure
   */
  _syncEditorText() {
    if (this._isEditorTextStale) this._setEditorText(this.orchestrator.getBody());
  }

  /**
   * INV-56: an empty #editor (whitespace only) taken into a document that is
   * not empty would empty the document; ask first. Called before anything
   * changes. Cancel puts the document back into #editor (a value assignment:
   * no input event, so the mark stays down) and recomputes the unsaved mark;
   * the model, an open block editor and the save state stay as they were.
   * @returns {boolean} true to go on
   * @purity non-pure
   */
  _confirmEditorIntoDocument() {
    const isEditorBlank = this._editorText().trim() === "";
    const isDocumentBlank = this.orchestrator.getBody().trim() === "";
    if (!isEditorBlank || isDocumentBlank) return true;
    if (window.confirm(CONFIG.messages.edit.emptyEditorConfirm)) return true;
    this._setEditorText(this.orchestrator.getBody());
    this._editorChangedSinceRender = false;
    this._refreshDirtyMark();
    return false;
  }

  /**
   * Show the new session's body in #editor and queue its full render.
   * Everything up to the render runs synchronously (INV-21, INV-47).
   * @param {'light'|'dark'} theme
   * @purity non-pure
   */
  async _showSessionBody(theme) {
    const body = this.documents.session.getBodyText();
    this._setEditorText(body);
    this._editorChangedSinceRender = false;
    const rendering = this.orchestrator.loadMarkdown(body, theme);
    this._refreshDirtyMark();
    this.setViewMode("markdown");
    this.showKeyHint("markdown");
    await rendering;
  }

  /**
   * @purity non-pure
   */
  _showPalette() {
    this.orchestrator.keepReadingPosition(() => this.palette.show());
    this.blockEdit.dispatch("paletteShown");
    this._refreshDirtyMark();
  }

  /**
   * Hide the palette; an open block editor is committed first (11-c).
   * @purity non-pure
   */
  _hidePalette() {
    this._endClipboardWait();
    this.blockEdit.dispatch("paletteHidden");
    this.orchestrator.keepReadingPosition(() => this.palette.hide());
  }

  /**
   * Unsaved (glossary, 11-e): a derived value, never stored.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _isDocumentDirty() {
    if (!this.documents.hasSession()) return false;
    return (
      this.documents.isBodyChanged(this.orchestrator.getBody()) ||
      this.blockEdit.hasUncommittedChange() ||
      this._editorChangedSinceRender
    );
  }

  /**
   * Title prefix and palette status (INV-50). No file name in the title.
   * The button states follow now, or in the next frame (deferButtonStates).
   * @purity non-pure
   * @param {{deferButtonStates?: boolean}} [options]
   */
  _refreshDirtyMark(options = {}) {
    const dirty = this._isDocumentDirty();
    document.title = dirty ? CONFIG.edit.titleUnsavedPrefix + this._baseTitle : this._baseTitle;
    const m = CONFIG.messages.edit;
    const name = this.documents.fileName();
    let status = "";
    if (this.documents.hasSession()) status = dirty ? m.statusUnsaved(name) : m.statusSaved(name);
    this.palette.setStatusText(status);
    this.palette.setUnsaved(dirty);
    // Inside an 11-c crossing the open cell or editor is closed for a moment
    // (the next one opens later in it): the states would disable the openers
    // and close an open popover (K-1). They follow when it ends.
    if (this.blockEdit.isInTransition()) this._buttonStatesDeferred = true;
    else if (options.deferButtonStates) this._schedulePaletteStates();
    else this._updatePaletteStates();
  }

  /**
   * BlockEditHost.onTransitionEnded: the button states deferred during the
   * crossing (5.15.5, 11-f openerDisabled after it only).
   * @purity non-pure
   */
  _onTransitionEnded() {
    if (!this._buttonStatesDeferred) return;
    this._buttonStatesDeferred = false;
    this._updatePaletteStates();
  }

  /**
   * Enable or disable the palette buttons (5.15.5).
   * @purity non-pure
   */
  _updatePaletteStates() {
    this.palette.setButtonStates(this._paletteStates());
  }

  /**
   * _updatePaletteStates in the next frame, once for all the selection
   * changes before it (INV-51).
   * @purity non-pure
   */
  _schedulePaletteStates() {
    if (this._paletteStatesPending) return;
    this._paletteStatesPending = true;
    /** @purity non-pure */
    nextFrame(() => {
      this._paletteStatesPending = false;
      if (this.palette.isShown()) this._updatePaletteStates();
    });
  }

  /**
   * The 5.15.5 table (the keys of EditPalette.setButtonStates). Also the
   * condition of INV-60 for primary + B / I.
   * @purity semi-pure-b
   * @returns {object}
   */
  _paletteStates() {
    const isEditing = this.blockEdit.isEditing();
    // A selection in one inline range (INV-67 (6)).
    const canFormat = isEditing && this.blockEdit.canFormatSelection();
    const isInTableSource = isEditing && this.blockEdit.isEditingTable();
    const cell = this.blockEdit.cellState(); // null unless a cell is open
    const isLinkMenuOpen = isEditing && this.palette.openPopoverKey() === "format";
    return {
      bold: canFormat,
      italic: canFormat,
      textColor: canFormat,
      // INV-69: lexing the inline range, so only while the format popover is
      // open (INV-51); off while a read of the clipboard waits (one at a time)
      linkPaste: isLinkMenuOpen && !this._isReadingClipboard && this.blockEdit.canPasteLink(),
      linkRemove: isLinkMenuOpen && this.blockEdit.canRemoveLink(),
      format: isEditing,
      insertTable: cell === null, // W7
      insertMermaid: cell === null,
      undo: this.orchestrator.canUndo() || this.blockEdit.hasUncommittedChange(), // INV-48
      insertRow: isInTableSource || cell !== null,
      insertColumn: isInTableSource || cell !== null,
      rowDelete: cell !== null && cell.row > 0, // D2
      columnDelete: cell !== null && cell.columns > 1,
      tableOptions: cell !== null, // D3 / P4
      alignment: cell ? cell.alignment : null,
    };
  }

  /**
   * INV-21: ask before replacing an unsaved document.
   * @purity non-pure
   * @returns {boolean} true to go on
   */
  _confirmDiscardIfDirty() {
    return !this._isDocumentDirty() || window.confirm(CONFIG.messages.edit.unsavedConfirm);
  }

  /**
   * INV-54: a document is not rebuilt while a save is running.
   * @purity non-pure
   * @returns {boolean} true when refused
   */
  _rejectWhileSaving() {
    if (!this.documents.isSaving()) return false;
    this._toast(CONFIG.messages.edit.savingInProgress);
    return true;
  }

  /**
   * @purity non-pure
   */
  _toast(message) {
    showToast(message, CONFIG.codeView.toastDurationMs);
  }

  /**
   * BlockEditHost (the port BlockEditController calls back).
   * @purity non-pure
   */
  _blockEditHost() {
    return {
      showPalette: () => this.orchestrator.keepReadingPosition(() => this.palette.show()),
      /** @purity non-pure */
      hidePalette: () => {
        this._endClipboardWait(); // Esc, Clear, the code view (11-c hidePalette)
        this.orchestrator.keepReadingPosition(() => this.palette.hide());
      },
      isPaletteNode: (node) => this.palette.contains(node),
      isEditorChangedSinceRender: () => this._editorChangedSinceRender,
      renderFromEditor: () => this._renderFromEditorFirst(),
      // typing: the button states once per frame (INV-51)
      onEditorInput: () => this._refreshDirtyMark({ deferButtonStates: true }),
      onEditStateChanged: () => this._refreshDirtyMark(),
      onTransitionEnded: () => this._onTransitionEnded(),
      showToast: (message) => this._toast(message),
      isApple: this._isApple, // INV-14: the cell's Redo keys (TableCellEditor)
    };
  }

  /**
   * EditPaletteHost (the port EditPalette calls back).
   * @purity non-pure
   */
  _paletteHost() {
    return {
      runCommand: (command, arg) => this._runPaletteCommand(command, arg),
      // the link buttons' states are worked out only while their popover is open (INV-51)
      /** @purity non-pure */
      onPopoverOpened: (key) => {
        if (key === "format") this._updatePaletteStates();
      },
    };
  }

  /**
   * @purity non-pure
   * @param {string} command
   * @param {string} [arg]
   */
  _runPaletteCommand(command, arg) {
    switch (command) {
      case "save":
        this.requestSave();
        break;
      case "saveAs":
        this.requestSaveAs();
        break;
      case "bold":
      case "italic":
        this._formatInBlock({ kind: command === "bold" ? "strong" : "em" }); // INV-67
        break;
      case "textColor":
        // INV-66: the light value goes into the source; "none" removes the color
        this._formatInBlock({ kind: "color", value: CONFIG.edit.textColors[arg]?.light ?? null });
        break;
      case "linkPaste":
        void this._pasteLinkFromClipboard(); // INV-69: started in the button's pointerup
        break;
      case "linkRemove":
        if (this.blockEdit.removeLink()) this._refreshDirtyMark();
        // as the formats (owner ruling Q-f): a huge block's button is on without checking
        else if (this.blockEdit.isHugeBlock()) this._toast(CONFIG.messages.edit.linkNotRemovable);
        break;
      case "insertRow":
        if (this.blockEdit.isEditingCell()) this._tableOperation({ kind: "insertRow" });
        else this._editInBlock((range) => MarkdownTextOps.insertTableRow(range.text, range.selStart));
        break;
      case "insertColumn":
        if (this.blockEdit.isEditingCell()) this._tableOperation({ kind: "insertColumn" });
        else this._editInBlock((range) => MarkdownTextOps.insertTableColumn(range.text, range.selStart));
        break;
      case "rowDelete":
        this._tableOperation({ kind: "deleteRow" });
        break;
      case "columnDelete":
        this._tableOperation({ kind: "deleteColumn" });
        break;
      case "alignColumn":
        this._tableOperation({ kind: "align", value: arg });
        break;
      case "undo":
        this.blockEdit.dispatch("undoRequested"); // INV-48, 11-c
        this._refreshDirtyMark();
        break;
      case "insertTable":
        void this._insertBlock(CONFIG.edit.tableTemplate, "cell");
        break;
      case "insertMermaid":
        void this._insertBlock(CONFIG.edit.mermaidSamples[arg], "source");
        break;
      default:
        break;
    }
  }

  /**
   * INV-65: a row, column or alignment operation on the open cell's table
   * (11-c tableOperationRequested; only while a cell is open).
   * @purity non-pure
   * @param {{kind: string, value?: string}} op
   */
  _tableOperation(op) {
    if (!this.blockEdit.isEditingCell()) return;
    this.blockEdit.dispatch("tableOperationRequested", { op });
    this._refreshDirtyMark();
  }

  /**
   * Change the open editor's text (not a commit; INV-52). edit(range)
   * returns a TextEdit, or null for no change.
   * @purity non-pure
   */
  _editInBlock(edit) {
    const range = this.blockEdit.getSelectionRange();
    const next = range ? edit(range) : null;
    if (!next) return;
    this.blockEdit.applyTextEdit(next);
    this._refreshDirtyMark();
  }

  /**
   * A format on the open editor's selection (not a commit; INV-52).
   * @purity non-pure
   * @param {{kind: string, value?: string|null}} op
   */
  _formatInBlock(op) {
    if (this.blockEdit.formatSelection(op)) this._refreshDirtyMark();
    // a huge block's buttons are on without checking (INV-71): say why nothing changed (owner ruling Q-f)
    else if (this.blockEdit.isHugeBlock()) this._toast(CONFIG.messages.edit.formatNotApplicable);
  }

  /**
   * INV-69, the Paste link button: the clipboard is read now, inside the
   * button's pointerup (user activation; the browser may ask for its
   * permission). The target (the open editor or cell, its selection and
   * edit generation) is noted now and compared when the read has ended: a
   * changed target changes nothing and is told by a toast (INV-69), as is a
   * clipboard without a URL or a refused read. One read at a time: a press
   * while one waits is ignored (the button is off meanwhile).
   * @purity non-pure
   * @returns {Promise<void>}
   */
  async _pasteLinkFromClipboard() {
    if (this._isReadingClipboard) return;
    const target = this.blockEdit.linkTarget();
    if (!target) return;
    this._isReadingClipboard = true;
    const read = ++this._clipboardRead;
    this._updatePaletteStates();
    let found;
    try {
      found = await ClipboardLink.readUrlAndText(this._clipboard(), ClipboardLink.urlOptions());
    } finally {
      // only the latest read ends the wait (an older one, given up when edit
      // mode ended, may settle while a newer one waits)
      if (read === this._clipboardRead) {
        this._isReadingClipboard = false;
        if (this.palette.isShown()) this._updatePaletteStates();
      }
    }
    if (read !== this._clipboardRead) return; // given up: ends silently
    if (!found) {
      this._toast(CONFIG.messages.edit.noUrlInClipboard);
      return;
    }
    if (!UIController.isSameLinkTarget(target, this.blockEdit.linkTarget())) {
      this._toast(CONFIG.messages.edit.linkTargetChanged);
      return;
    }
    if (this.blockEdit.pasteLink(found.url, found.text)) this._refreshDirtyMark();
    else this._toast(CONFIG.messages.edit.linkNotPastable); // owner ruling F-R2
  }

  /**
   * Give up waiting for the clipboard (edit mode ends): a read that never
   * settles (a prompt not answered) keeps Paste link off only until then; a
   * late answer changes nothing and shows nothing (INV-69).
   * @purity non-pure
   */
  _endClipboardWait() {
    this._isReadingClipboard = false;
    this._clipboardRead++;
  }

  /**
   * Two link targets (BlockEditController.linkTarget) are the same: the
   * same block or cell, selection and edit generation.
   * @purity pure
   * @param {object|null} a
   * @param {object|null} b
   * @returns {boolean}
   */
  static isSameLinkTarget(a, b) {
    if (!a || !b) return false;
    const keys = ["kind", "blockId", "row", "col", "generation", "start", "end"];
    return keys.every((k) => a[k] === b[k]);
  }

  /**
   * Insert table / Mermaid sample (INV-52, 11-c blockInsertRequested):
   * while editing, the editor is committed and the block goes in at a line
   * boundary of it (or the press is refused with a toast); else after the
   * last opened block (or at the end). Each is a change of its own. After
   * the render, a table's first cell (opens "cell") or the Mermaid block's
   * source (opens "source") is opened.
   * @param {string} blockText
   * @param {"cell"|"source"} opens
   * @returns {Promise<void>} settles when the opening after the render is done
   * @purity non-pure
   */
  _insertBlock(blockText, opens) {
    if (this.blockEdit.isEditingCell()) return Promise.resolve(); // W7: not while a cell is open
    if (!this.blockEdit.isEditing() && this._editorChangedSinceRender) {
      this._renderFromEditorFirst();
      return Promise.resolve();
    }
    const opening = this.blockEdit.dispatch("blockInsertRequested", { kind: "insert", raw: blockText, opens });
    this._refreshDirtyMark();
    return opening ?? Promise.resolve();
  }

  // ---- Save (11-e, spec 5.14.7) ----

  /**
   * Save: overwrite the file (Save as without a target). The steps up to the
   * use case call run synchronously in the press handler (INV-33).
   * @returns {Promise<void>} settles when the outcome is shown
   * @purity non-pure
   */
  requestSave() {
    return this._startSave("saveRequested");
  }

  /**
   * @returns {Promise<void>}
   * @purity non-pure
   */
  requestSaveAs() {
    return this._startSave("saveAsRequested");
  }

  /**
   * OverwriteConfirmPort (INV-39). "changed": the file time differs from the
   * baseline; "unknown": the baseline could not be read after the last save,
   * so whether the file changed is not known.
   * @param {"changed"|"unknown"} reason
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  confirmOverwrite(reason) {
    const messages = CONFIG.messages.edit;
    const message = reason === "unknown" ? messages.overwriteUnknownConfirm : messages.externalChangeConfirm;
    return Promise.resolve(window.confirm(message));
  }

  /**
   * 11-e through DocumentLifecycle.save: the steps up to the use case call
   * run synchronously in the press handler (INV-33).
   * @param {"saveRequested"|"saveAsRequested"} event
   * @returns {Promise<void>}
   * @purity non-pure
   */
  _startSave(event) {
    return this.documents.save(event, this._saveSteps());
  }

  /**
   * SaveSteps: the UI steps DocumentLifecycle.save calls back, in its order.
   * @purity non-pure
   */
  _saveSteps() {
    return {
      // (0) INV-56 when #editor is about to be taken in (Cancel: nothing starts)
      confirmStart: () => !this._editorChangedSinceRender || this._confirmEditorIntoDocument(),
      /** @purity non-pure */
      commitEdits: (event) => {
        this.blockEdit.dispatch(event); // commits an open editor (11-c)
        if (this._editorChangedSinceRender) this._takeEditorIntoModel(this.state.currentTheme);
      },
      getBody: () => this.orchestrator.getBody(),
      confirmer: this,
      // the outcome is shown at once, right after the use case settles (11-e)
      /** @purity non-pure */
      onFinished: (result) => {
        if (result.applied) this._refreshDirtyMark();
        if (result.message) this._toast(result.message);
      },
    };
  }

  /** @purity non-pure */
  setupHelpButton() {
    this.elements.helpBtn.addEventListener("mousedown", (e) =>
      this.startPress(e),
    );
    this.elements.helpBtn.addEventListener("mouseup", () =>
      this.cancelPress(),
    );
    this.elements.helpBtn.addEventListener("mouseleave", () =>
      this.cancelPress(),
    );

    this.elements.helpBtn.addEventListener("touchstart", (e) =>
      this.startPress(e),
    );
    /** @purity non-pure */
    this.elements.helpBtn.addEventListener("touchend", (e) => {
      this.cancelPress();
      // Taken either way: after a long press the browser's click (and the
      // mouse events) would land on the prompt's overlay and close it.
      e.preventDefault();
      if (this.isLongPress) this.isLongPress = false;
      else this.handleHelpClick(e);
    });

    this.elements.helpBtn.addEventListener("click", (e) =>
      this.handleHelpClick(e),
    );
  }

  /** @purity non-pure */
  setupPromptButton() {
    /** @purity non-pure */
    this.elements.copyPromptBtn.addEventListener("click", async () => {
      const text = this.elements.promptText.value;
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(text);
          this.showCopySuccess();
          return;
        } catch {
          // Fall through to execCommand fallback
        }
      }
      this.elements.promptText.select();
      this.elements.promptText.setSelectionRange(
        0,
        CONFIG.ui.maxTextSelection,
      );
      try {
        const ok = document.execCommand("copy");
        if (ok) {
          this.showCopySuccess();
        } else {
          alert(CONFIG.messages.copy.failed);
        }
      } catch (err) {
        alert(CONFIG.messages.copy.blocked);
      }
    });
  }

  /** @purity non-pure */
  setupModals() {
    const helpCloseBtn =
      this.elements.helpModal.querySelector(".close-btn");
    const promptCloseBtn =
      this.elements.promptModal.querySelector(".prompt-close");
    ModalController.setupModal(this.elements.helpModal, [helpCloseBtn]);
    ModalController.setupModal(this.elements.promptModal, [
      promptCloseBtn,
    ]);
  }

  /** @purity non-pure */
  setupPromptText() {
    this.elements.promptText.value = CONFIG.messages.prompt.body;
  }

  /**
   * @param {Event} e
   * @purity non-pure
   */
  startPress(e) {
    if (e.type === "mousedown" && e.button !== 0) return;
    this.isLongPress = false;
    /** @purity non-pure */
    this.longPressTimer = setTimeout(() => {
      this.isLongPress = true;
      // the focus goes back to [?] when the prompt closes (5.11)
      ModalController.show(this.elements.promptModal, this.elements.helpBtn);
    }, CONFIG.ui.longPressDuration);
  }

  /** @purity non-pure */
  cancelPress() {
    clearTimeout(this.longPressTimer);
  }

  /**
   * @param {Event} e
   * @purity non-pure
   */
  handleHelpClick(e) {
    if (this.isLongPress) {
      e.preventDefault();
      e.stopPropagation();
      this.isLongPress = false;
      return;
    }
    ModalController.show(this.elements.helpModal, this.elements.helpBtn);
  }

  /** @purity non-pure */
  showCopySuccess() {
    const original = this.elements.copyPromptBtn.textContent;
    this.elements.copyPromptBtn.textContent = CONFIG.messages.prompt.copied;
    /** @purity non-pure */
    setTimeout(() => {
      this.elements.copyPromptBtn.textContent = original;
      ModalController.hide(this.elements.promptModal);
    }, CONFIG.ui.copyFeedbackDuration);
  }
}
