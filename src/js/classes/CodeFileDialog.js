import ModalController from "./ModalController.js";
import { normalizeLineEndings } from "../textTransforms.js";
import { TEXT_ENCODINGS, decodeAs, detectBom, countLineEndings, hasMixedLineEndings } from "../textEncoding.js";
import { singleLineEnding } from "./CodeDocument.js";

/**
 * The questions of a code file (UI): how to open a file that is not
 * valid UTF-8 or mixes line endings (INV-89, NE-15, NE-25), in which
 * encoding to save a file that is not UTF-8 (INV-90, NE-24), and whether to
 * save in UTF-8 when the chosen encoding can't write some characters
 * (NE-31; the save modal with one answer button). They are
 * modals of index.html run by ModalController; closing one in any other
 * way (Cancel, Esc, a click outside) answers null. File content reaches the
 * page as textContent only (INV-19).
 */
export default class CodeFileDialog {
  /**
   * @purity non-pure
   * @param {HTMLElement} openModal - #codeOpenModal
   * @param {HTMLElement} saveModal - #codeSaveModal
   * @param {object} messages - CONFIG.messages.codeEdit
   * @param {number} sampleLines - CONFIG.codeEdit.sampleLines
   */
  constructor(openModal, saveModal, messages, sampleLines) {
    this._messages = messages;
    this._sampleLines = sampleLines;
    const find = (modal, id) => modal.querySelector(`#${id}`);
    this._open = {
      modal: openModal,
      fileName: find(openModal, "codeOpenFileName"),
      encodingBox: find(openModal, "codeOpenEncodingBox"),
      encoding: find(openModal, "codeOpenEncoding"),
      bom: find(openModal, "codeOpenBom"),
      preview: find(openModal, "codeOpenPreview"),
      lineCounts: find(openModal, "codeOpenLineCounts"),
      mixedNote: find(openModal, "codeOpenMixedNote"),
      unifyCrlf: find(openModal, "codeOpenCrlfBtn"),
      unifyLf: find(openModal, "codeOpenLfBtn"),
      keep: find(openModal, "codeOpenKeepBtn"),
      openBtn: find(openModal, "codeOpenBtn"),
      cancel: find(openModal, "codeOpenCancelBtn"),
    };
    this._save = {
      modal: saveModal,
      question: find(saveModal, "codeSaveQuestion"),
      original: find(saveModal, "codeSaveOriginalBtn"),
      utf8: find(saveModal, "codeSaveUtf8Btn"),
      cancel: find(saveModal, "codeSaveCancelBtn"),
    };
    this._opening = null; // {bytes, counts, resolve, answer} while the open dialog is shown
    this._saving = null; // {resolve, answer} while the save question is shown
    this._fillEncodings();
    this._wireOpen();
    this._wireSave();
  }

  /**
   * Ask how to open the file (INV-89). The encoding part shows only when
   * the bytes are not valid UTF-8; the three line ending buttons only when
   * the endings are mixed (else one Open button).
   * @purity non-pure
   * @param {object} a
   * @param {string} a.fileName
   * @param {Uint8Array} a.bytes
   * @param {{text: string, encoding: string, bom: boolean, valid: boolean}} a.decoded - decodeFileBytes
   * @returns {Promise<{encoding: string, lineEndingMode: "\r\n"|"\n"|"\r"|"keep"}|null>} null: canceled
   */
  askOpen({ fileName, bytes, decoded }) {
    this._settle(this._opening);
    const o = this._open;
    o.fileName.textContent = fileName;
    o.encodingBox.hidden = decoded.valid;
    o.encoding.value = decoded.encoding;
    /** @purity non-pure */
    const asked = new Promise((resolve) => {
      this._opening = { bytes, counts: null, resolve, answer: null };
    });
    this._showEncoding(decoded.encoding, decoded.text);
    ModalController.show(o.modal);
    (o.openBtn.hidden ? o.keep : o.openBtn).focus();
    return asked;
  }

  /**
   * Ask in which encoding to save a file that is not UTF-8 (NE-24).
   * @purity non-pure
   * @param {string} encoding - the document's encoding
   * @returns {Promise<"original"|"utf-8"|null>} null: canceled
   */
  askSaveEncoding(encoding) {
    const name = this._encodingName(encoding);
    return this._askSave(this._messages.saveQuestion(name), this._messages.saveOriginal(name), this._encodingName("utf-8"));
  }

  /**
   * Ask whether to save in UTF-8 instead, as the chosen encoding can't
   * write some characters (NE-31): the same modal, with [Save in UTF-8]
   * and [Cancel] only.
   * @purity non-pure
   * @param {string} encoding - the encoding chosen
   * @param {string} lines - the 1-based lines, listed
   * @returns {Promise<boolean>} true: save in UTF-8
   */
  askSaveUtf8(encoding, lines) {
    const question = this._messages.unencodableAsk(this._encodingName(encoding), lines);
    return this._askSave(question, null, this._messages.saveInUtf8).then((answer) => answer === "utf-8");
  }

  // ---- private ----

  /**
   * Show the save modal with a question and its buttons; original null:
   * that button hidden. The focus goes to the first button shown.
   * @purity non-pure
   * @param {string} question
   * @param {string|null} original
   * @param {string} utf8
   * @returns {Promise<"original"|"utf-8"|null>}
   */
  _askSave(question, original, utf8) {
    this._settle(this._saving);
    const s = this._save;
    s.question.textContent = question;
    s.original.hidden = original === null;
    s.original.textContent = original ?? "";
    s.utf8.textContent = utf8;
    /** @purity non-pure */
    const asked = new Promise((resolve) => {
      this._saving = { resolve, answer: null };
    });
    ModalController.show(s.modal);
    (original === null ? s.utf8 : s.original).focus();
    return asked;
  }

  /**
   * The display name of an encoding (CONFIG), or the label itself.
   * @purity semi-pure-a
   * @param {string} encoding
   * @returns {string}
   */
  _encodingName(encoding) {
    return this._messages.encodingNames[encoding] ?? encoding;
  }

  /**
   * The encoding choices of the open dialog, in TEXT_ENCODINGS order.
   * @purity non-pure
   */
  _fillEncodings() {
    const select = this._open.encoding;
    select.textContent = "";
    for (const encoding of TEXT_ENCODINGS) {
      const option = document.createElement("option");
      option.value = encoding;
      option.textContent = this._encodingName(encoding);
      select.appendChild(option);
    }
  }

  /**
   * @purity non-pure
   */
  _wireOpen() {
    const o = this._open;
    ModalController.setupModal(o.modal, [o.cancel], () => this._finish("_opening"));
    o.unifyCrlf.addEventListener("click", () => this._answerOpen("\r\n"));
    o.unifyLf.addEventListener("click", () => this._answerOpen("\n"));
    o.keep.addEventListener("click", () => this._answerOpen("keep"));
    /** @purity non-pure */
    o.openBtn.addEventListener("click", () => {
      if (this._opening) this._answerOpen(singleLineEnding(this._opening.counts));
    });
    /** @purity non-pure */
    o.encoding.addEventListener("change", () => {
      if (this._opening) this._showEncoding(o.encoding.value, decodeAs(this._opening.bytes, o.encoding.value));
    });
  }

  /**
   * @purity non-pure
   */
  _wireSave() {
    const s = this._save;
    ModalController.setupModal(s.modal, [s.cancel], () => this._finish("_saving"));
    s.original.addEventListener("click", () => this._answer(this._saving, s.modal, "original"));
    s.utf8.addEventListener("click", () => this._answer(this._saving, s.modal, "utf-8"));
  }

  /**
   * Show the file as read in an encoding: its BOM, the first lines and the
   * line ending counts; the buttons follow whether the endings are mixed.
   * @purity non-pure
   * @param {string} encoding
   * @param {string} text - the bytes decoded in that encoding
   */
  _showEncoding(encoding, text) {
    const o = this._open;
    const counts = countLineEndings(text);
    const mixed = hasMixedLineEndings(counts);
    this._opening.counts = counts;
    o.bom.textContent = this._messages.bom(detectBom(this._opening.bytes) === encoding);
    o.preview.textContent = normalizeLineEndings(text).split("\n", this._sampleLines).join("\n");
    o.lineCounts.textContent = this._messages.lineEndingCounts(counts);
    o.mixedNote.hidden = !mixed;
    o.unifyCrlf.hidden = !mixed;
    o.unifyLf.hidden = !mixed;
    o.keep.hidden = !mixed;
    o.openBtn.hidden = mixed;
  }

  /**
   * @purity non-pure
   * @param {"\r\n"|"\n"|"\r"|"keep"} lineEndingMode
   */
  _answerOpen(lineEndingMode) {
    this._answer(this._opening, this._open.modal, { encoding: this._open.encoding.value, lineEndingMode });
  }

  /**
   * Record the answer, then close: closing settles the question.
   * @purity non-pure
   * @param {object|null} pending
   * @param {HTMLElement} modal
   * @param {*} answer
   */
  _answer(pending, modal, answer) {
    if (!pending) return;
    pending.answer = answer;
    ModalController.hide(modal);
  }

  /**
   * The modal closed: its question gets the recorded answer, or null.
   * @purity non-pure
   * @param {"_opening"|"_saving"} key
   */
  _finish(key) {
    const pending = this[key];
    this[key] = null;
    this._settle(pending);
  }

  /**
   * @purity non-pure
   * @param {object|null} pending
   */
  _settle(pending) {
    if (pending) pending.resolve(pending.answer);
  }
}
