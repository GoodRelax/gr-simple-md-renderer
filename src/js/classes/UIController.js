import { CONFIG, EXT_TO_HLJS, BINARY_EXTENSIONS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../config.js";
import { applyTheme, applySystemTheme, systemTheme, showToast } from "../utils.js";
import { splitMarkdownWrapper, normalizeLineEndings, hasUtf8Bom } from "../textTransforms.js";
import ModalController from "./ModalController.js";
import DocumentSession from "./DocumentSession.js";
import DocumentLocation from "./DocumentLocation.js";
import BlockEditController from "./BlockEditController.js";
import MarkdownTextOps from "./MarkdownTextOps.js";
import SaveDocument from "./SaveDocument.js";
import SaveDocumentAs from "./SaveDocumentAs.js";
import { cell } from "../stateTable.js";

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
 * INV-14 (2): the letter of a primary-modifier shortcut (INV-58 to INV-60),
 * or null. The primary modifier is Cmd alone on Apple platforms and Ctrl
 * alone elsewhere; Alt (also AltGr, which arrives as Ctrl+Alt) and IME
 * composition are never shortcuts. The letter is event.key in lower case;
 * only when that is not a Latin letter (Russian and other layouts) is
 * event.code (KeyS ...) used. A repeat still has its letter: the caller
 * stops its default and runs nothing (owner ruling, 2026-10-21).
 * @purity pure
 * @param {{key: string, code?: string, ctrlKey: boolean, metaKey: boolean,
 *   altKey: boolean, isComposing?: boolean, keyCode?: number}} e
 * @param {boolean} isApple
 * @returns {string|null} "a" to "z"
 */
export function shortcutLetter(e, isApple) {
  const primary = isApple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!primary || e.altKey || e.isComposing || e.keyCode === 229) return null;
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if (/^[a-z]$/.test(key)) return key;
  const m = /^Key([A-Z])$/.exec(e.code ?? "");
  return m ? m[1].toLowerCase() : null;
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

/**
 * Spec 11-e: event -> current state -> cell (null = no change). Only the save
 * in progress is a state; "unsaved" is derived (_isDocumentDirty).
 */
export const saveOperationStateMachine = Object.freeze({
  saveRequested: Object.freeze({
    idle: cell("writingFile", ["startPermissionRequest", "commitOpenBlock", "applyEditorText", "runSaveDocument"]),
    writingFile: null,
  }),
  saveAsRequested: Object.freeze({
    idle: cell("writingFile", ["startSavePicker", "commitOpenBlock", "applyEditorText", "runSaveDocumentAs"]),
    writingFile: null,
  }),
  fileWritten: Object.freeze({
    idle: null,
    writingFile: cell("idle", ["applyOutcomeIfSameDocument", "refreshDirtyMark", "showSavedToast"]),
  }),
  downloadStarted: Object.freeze({ idle: null, writingFile: cell("idle", ["showDownloadStartedToast"]) }),
  writeFailed: Object.freeze({ idle: null, writingFile: cell("idle", ["showErrorToast"]) }),
  saveCanceled: Object.freeze({ idle: null, writingFile: cell("idle", []) }),
  replaceRequested: Object.freeze({ idle: null, writingFile: cell("writingFile", ["rejectReplace", "showSavingToast"]) }),
});

// SaveOutcome.status -> 11-e event
const SAVE_EVENT_BY_STATUS = Object.freeze({
  saved: "fileWritten",
  downloadStarted: "downloadStarted",
  failed: "writeFailed",
  canceled: "saveCanceled",
});

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
   *   fileAccess (MarkdownFileAccess), createPalette(host) -> EditPalette,
   *   createBlockEdit(host) -> BlockEditController, isApple (Cmd is the
   *   primary shortcut modifier, INV-14)
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

    // Document session and save target (INV-55): the only place of the file handle
    this.fileAccess = services.fileAccess;
    this._isApple = Boolean(services.isApple);
    this._session = null; // DocumentSession
    this._location = null; // DocumentLocation
    this._nextDocumentId = 1;
    this._editorChangedSinceRender = false; // INV-45
    this._saveOperationState = "idle"; // 11-e
    this._baseTitle = document.title;
    this._lastTap = null; // double tap on the empty preview (INV-31)
    this._isEditorHistoryStale = false; // #editor's undo history after a system write (5.7 (6))
    this._isEditorTextStale = false; // #editor not yet given the body after a large commit (INV-47)
    this.saveDocument = new SaveDocument(this.fileAccess, CONFIG.messages.edit, CONFIG.edit.defaultFileName);
    this.saveDocumentAs = new SaveDocumentAs(this.fileAccess, CONFIG.messages.edit, CONFIG.edit.defaultFileName);
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
    const sizeStr = (fileSize / 1024).toFixed(2) + " KB";
    const linesStr = lineCount.toLocaleString() + " lines";
    return `${fileName}  |  ${linesStr}  |  ${sizeStr}\nUpdated: ${updatedAtStr}`;
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
    const msg =
      "Get started:\n\n" +
      "  1. Paste Markdown (Ctrl+V)  ->  Markdown Preview                     \n" +
      "  2. Drop a .md file          ->  Markdown Preview                     \n" +
      "  3. Drop any text file       ->  Code View  (.py  .js  .json  .c  ...)";
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
      const metadata = await this.orchestrator.reloadCodeView(theme);
      if (metadata) this.setViewMode("code", metadata);
      return;
    }
    const location = this._location;
    if (!location || !location.fileHandle) {
      const msg = FILE_SYSTEM_HANDLE_SUPPORTED
        ? CONFIG.codeView.reloadNoFileMsg
        : CONFIG.codeView.reloadUnavailableMsg;
      this._toast(msg);
      return;
    }
    const documentId = this._session?.documentId;
    let loaded;
    try {
      loaded = await this.fileAccess.readFile(location.fileHandle);
    } catch {
      this._toast(CONFIG.messages.edit.reloadFailed);
      return;
    }
    if (this._location !== location || this._session?.documentId !== documentId) {
      this._toast(CONFIG.messages.edit.reloadCanceled);
      return;
    }
    if (this._rejectWhileSaving() || !this._confirmDiscardIfDirty()) return;
    this.blockEdit.dispatch("documentReplaced");
    this._session = DocumentSession.fromFileText(
      loaded.text,
      hasUtf8Bom(loaded.bytesHead),
      loaded.lastModified,
      this._newDocumentId(),
    );
    await this._showSessionBody(theme);
  }

  /**
   * Full clear: destroy view, clear editor, restore system theme,
   * set view mode to initial. Asks first when unsaved (INV-21).
   * @purity non-pure
   */
  doClear() {
    if (this._rejectWhileSaving() || !this._confirmDiscardIfDirty()) return;
    this.blockEdit.dispatch("documentCleared");
    this._session = null;
    this._location = null;
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
      const handlePromise =
        FILE_SYSTEM_HANDLE_SUPPORTED
          ? item?.getAsFileSystemHandle?.() ?? null
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
      this._session = DocumentSession.fromFileText(text, hasBom, file.lastModified, this._newDocumentId());
      this._location = new DocumentLocation(file.name, fileHandle);
      this.orchestrator.resetExternalImageConsent(); // INV-43
      await this._showSessionBody(systemTheme());
      return;
    }
    this.blockEdit.dispatch("viewSwitchedToCode");
    this._session = null;
    this._location = null;
    this._editorChangedSinceRender = false;
    this._setEditorText(""); // RTC2-07: clear editor before code view
    const rendering = this.orchestrator.renderCodeView(file, fileHandle);
    this._refreshDirtyMark();
    const metadata = await rendering;
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
          // Markdown view: hide the palette, or cancel the open block editor
          // when the focus is outside it (5.11, 11-c escapePressed).
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
    if (letter === "z" && !e.shiftKey) {
      // INV-59: edit mode only (ruling Q3).
      if (!this.palette.isShown()) return null;
      const active = document.activeElement;
      if (this.blockEdit.isEditorElement(active)) {
        if (this.blockEdit.hasUncommittedChange()) return null; // (b) the browser's character Undo
      } else if (active === this.elements.editor || isTextEntry(active)) {
        return null; // (a)
      }
      /** @purity non-pure */
      return () => {
        this.blockEdit.dispatch("undoRequested"); // (c)
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
    // Bold / Italic follow the editor's selection (5.15.5). Capture also sees
    // the event when it is fired at the textarea itself.
    /** @purity non-pure */
    document.addEventListener(
      "selectionchange",
      () => {
        if (this.palette.isShown()) this._updatePaletteStates();
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
    this._session = DocumentSession.fromPastedText("", this._newDocumentId());
    this._location = null;
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
    this._session = DocumentSession.fromPastedText(body, this._newDocumentId());
    this._location = null;
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
    const body = this._session.getBodyText();
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
    this.palette.show();
    this.blockEdit.dispatch("paletteShown");
    this._refreshDirtyMark();
  }

  /**
   * Hide the palette; an open block editor is committed first (11-c).
   * @purity non-pure
   */
  _hidePalette() {
    this.blockEdit.dispatch("paletteHidden");
    this.palette.hide();
  }

  /**
   * Unsaved (glossary, 11-e): a derived value, never stored.
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _isDocumentDirty() {
    if (!this._session) return false;
    return (
      this._session.isBodyChanged(this.orchestrator.getBody()) ||
      this.blockEdit.hasUncommittedChange() ||
      this._editorChangedSinceRender
    );
  }

  /**
   * Title prefix and palette status (INV-50). No file name in the title.
   * @purity non-pure
   */
  _refreshDirtyMark() {
    const dirty = this._isDocumentDirty();
    document.title = dirty ? CONFIG.edit.titleUnsavedPrefix + this._baseTitle : this._baseTitle;
    const m = CONFIG.messages.edit;
    const name = this._location?.fileName ?? CONFIG.edit.defaultFileName;
    let status = "";
    if (this._session) status = dirty ? m.statusUnsaved(name) : m.statusSaved(name);
    this.palette.setStatusText(status);
    this.palette.setUnsaved(dirty);
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
   * The 5.15.5 table (the keys of EditPalette.setButtonStates). Also the
   * condition of INV-60 for primary + B / I.
   * @purity semi-pure-b
   * @returns {object}
   */
  _paletteStates() {
    const range = this.blockEdit.getSelectionRange();
    const isEditing = this.blockEdit.isEditing();
    const hasSelection = isEditing && Boolean(range) && range.selStart !== range.selEnd;
    const isInTableSource = isEditing && this.blockEdit.isEditingTable();
    return {
      bold: hasSelection,
      italic: hasSelection,
      format: isEditing,
      insertTable: true,
      insertMermaid: true,
      undo: this.orchestrator.canUndo() || this.blockEdit.hasUncommittedChange(), // INV-48
      insertRow: isInTableSource,
      insertColumn: isInTableSource,
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
    if (!saveOperationStateMachine.replaceRequested[this._saveOperationState]) return false;
    this._toast(CONFIG.messages.edit.savingInProgress);
    return true;
  }

  /**
   * @purity non-pure
   */
  _newDocumentId() {
    return this._nextDocumentId++;
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
      showPalette: () => this.palette.show(),
      hidePalette: () => this.palette.hide(),
      isPaletteNode: (node) => this.palette.contains(node),
      isEditorChangedSinceRender: () => this._editorChangedSinceRender,
      renderFromEditor: () => this._renderFromEditorFirst(),
      onEditorInput: () => this._refreshDirtyMark(),
      onEditStateChanged: () => this._refreshDirtyMark(),
    };
  }

  /**
   * EditPaletteHost (the port EditPalette calls back).
   * @purity non-pure
   */
  _paletteHost() {
    return {
      runCommand: (command, arg) => this._runPaletteCommand(command, arg),
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
        this._editInBlock((range) =>
          range.selStart === range.selEnd
            ? null
            : MarkdownTextOps.toggleWrap(range.text, range.selStart, range.selEnd, command === "bold" ? "**" : "*"),
        );
        break;
      case "insertRow":
        this._editInBlock((range) => MarkdownTextOps.insertTableRow(range.text, range.selStart));
        break;
      case "insertColumn":
        this._editInBlock((range) => MarkdownTextOps.insertTableColumn(range.text, range.selStart));
        break;
      case "undo":
        this.blockEdit.dispatch("undoRequested"); // INV-48, 11-c
        this._refreshDirtyMark();
        break;
      case "insertTable":
        this._insertBlock(CONFIG.edit.tableTemplate);
        break;
      case "insertMermaid":
        this._insertBlock(CONFIG.edit.mermaidSamples[arg]);
        break;
      default:
        break;
    }
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
   * Insert table / Mermaid sample (INV-52): at the caret while editing,
   * else after the last opened block (or at the end) as one model change.
   * @param {string} blockText
   * @purity non-pure
   */
  _insertBlock(blockText) {
    if (this.blockEdit.isEditing()) {
      this._editInBlock((range) => MarkdownTextOps.insertBlockText(range.text, range.selEnd, blockText));
    } else if (this._editorChangedSinceRender) {
      this._renderFromEditorFirst();
    } else {
      this.orchestrator.insertAfter(this.blockEdit.getLastOpenedBlockId(), blockText);
    }
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
   * INV-33 order, synchronous until the use case awaits: (0) the INV-56
   * confirm when #editor is about to be taken in (Cancel: nothing starts),
   * (1) start the permission request or the save dialog, (2) commit the open
   * block and take in #editor, (3) run the use case (a download starts inside
   * it).
   * @param {"saveRequested"|"saveAsRequested"} event
   * @purity non-pure
   */
  async _startSave(event) {
    const next = saveOperationStateMachine[event][this._saveOperationState];
    if (!next || !this._session) return; // a second press while writing is ignored
    if (this._editorChangedSinceRender && !this._confirmEditorIntoDocument()) return;
    const isSaveAs = event === "saveAsRequested";
    const location = this._location ?? new DocumentLocation(CONFIG.edit.defaultFileName, null);
    const permissionOrPicker = this._startSaveAccess(isSaveAs, location);
    this.blockEdit.dispatch(event); // commits an open editor (11-c)
    if (this._editorChangedSinceRender) this._takeEditorIntoModel(this.state.currentTheme);
    this._saveOperationState = next.to;
    const request = {
      session: this._session,
      location,
      bodyText: this.orchestrator.getBody(),
      permissionOrPicker,
      confirmer: this,
    };
    let outcome;
    try {
      outcome = await (isSaveAs ? this.saveDocumentAs : this.saveDocument).execute(request);
    } catch (error) {
      console.error("Save error:", error);
      outcome = this.saveDocumentAs.outcome(request, "failed", CONFIG.messages.edit.saveFailed);
    }
    this._finishSave(outcome);
  }

  /**
   * The permission request (Save with a target) or the save dialog; null
   * when the browser cannot write files (download).
   * @purity non-pure
   */
  _startSaveAccess(isSaveAs, location) {
    if (!this.fileAccess.canWriteInPlace()) return null;
    if (!isSaveAs && location.fileHandle) return this.fileAccess.startPermissionRequest(location.fileHandle);
    return this.fileAccess.startSavePicker(location.fileName);
  }

  /**
   * Show a SaveOutcome (11-e). The session and the target change only for the
   * document the save started from (INV-54); a failure leaves it unsaved.
   * @param {object} outcome - SaveOutcome
   * @purity non-pure
   */
  _finishSave(outcome) {
    const event = SAVE_EVENT_BY_STATUS[outcome.status] ?? "writeFailed";
    const next = saveOperationStateMachine[event][this._saveOperationState];
    if (!next) return;
    this._saveOperationState = next.to;
    if (event === "fileWritten" && this._session && outcome.documentId === this._session.documentId) {
      this._session = outcome.session;
      this._location = outcome.location;
      this._refreshDirtyMark();
    }
    if (event !== "saveCanceled" && outcome.message) this._toast(outcome.message);
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
      if (!this.isLongPress) {
        e.preventDefault();
        this.handleHelpClick(e);
      }
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
    const COPY_PAYLOAD = `
## Output Format

- Output the entire content **as a single Markdown code block** so it can be copied in one go.
- **Enclose the entire Markdown with six backticks \` \`\`\`\`\`\` \` at the beginning and end.** Specify its language as markdown.
- **Use these six backticks only once as the outermost enclosure.**
- **Never output speculation or fabrications.** If something is unclear or requires investigation, explicitly state so.
- This method is called **MCBSMD** (Multiple Code Blocks in a Single Markdown)

### Code and Diagram Block Rules

- As a rule, use Mermaid for diagrams. Use PlantUML only when the diagram cannot be expressed in Mermaid.
- Any diagrams or software code inside the Markdown must each be enclosed in their own code blocks using triple backticks \` \`\`\` \`.
- Each code block must specify a language or file type (e.g., \` \`\`\`python \` or \` \`\`\`mermaid \`).
- Each code or diagram block must be preceded by a descriptive title in the format **title:**
  (e.g., \`**System Architecture:**\`, \`**Login Flow:**\`)
- Always follow the structure below for every code or diagram block:

  > **title:**
  >
  > \`\`\`language
  > (code or diagram content here without truncation or abbreviation)
  > \`\`\`
  >
  > Write the explanation for the code block here, immediately after the block, following a blank line.

- Do not write explanations inside the code blocks.
- In all diagrams, prefer alphanumeric characters and underscores (\`_\`); non-ASCII text (no spaces) is allowed only when non-English is more appropriate for the diagram. Special symbols (e.g., \`\\\`, \`/\`, \`|\`, \`<\`, \`>\`, \`{\`, \`}\`) are strictly prohibited.
- Output all diagram content without omission. Never use \`...\` or any shorthand.

### Diagram Label and Notation Rules

- All arrows and relationship lines in diagrams MUST have labels. Follow these notation rules:
  1. Mermaid \`flowchart\` and \`graph\`: place the label inside the arrow using pipes (e.g., \`A -->|Label| B\`)
  2. Other Mermaid diagrams / All PlantUML: place the label after the arrow using a colon (e.g., \`A --> B : Label\`)
- For line breaks in labels or node text:
  1. Mermaid: use \`<br/>\` inside a quoted string (e.g., \`A -->|"Line1<br/>Line2"| B\`, \`A["Line1<br/>Line2"]\`)
  2. PlantUML: use \`\\n\` (e.g., \`A -> B : Line1\\nLine2\`)

### Math Rules

- Use standard LaTeX notation for all mathematical formulas.
  1. Inline math: always use single dollar signs. Place a space before the opening \`$\`
     and a space after the closing \`$\`
     (e.g., \`The function is $y = x + 1$ here.\`)
  2. Block equations: always place \`$$\` on its own line, above and below the formula.
     Example:
     > $$
     > E = mc^2
     > $$
`;
    this.elements.promptText.value = COPY_PAYLOAD;
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
      ModalController.show(this.elements.promptModal);
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
    ModalController.show(this.elements.helpModal);
  }

  /** @purity non-pure */
  showCopySuccess() {
    const original = this.elements.copyPromptBtn.textContent;
    this.elements.copyPromptBtn.textContent = "Copied!";
    /** @purity non-pure */
    setTimeout(() => {
      this.elements.copyPromptBtn.textContent = original;
      ModalController.hide(this.elements.promptModal);
    }, CONFIG.ui.copyFeedbackDuration);
  }
}
