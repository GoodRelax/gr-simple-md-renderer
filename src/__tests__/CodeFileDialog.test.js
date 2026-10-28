import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import CodeFileDialog from "../js/classes/CodeFileDialog.js";
import { CONFIG } from "../js/config.js";
import { decodeFileBytes, encodeText } from "../js/textEncoding.js";

// AT-CFD: the open dialog (INV-89, NE-15, NE-25) and the save encoding
// question (INV-90, NE-24), on the real modals of src/index.html.

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(here, "../index.html"), "utf8");

const A = "あ";

function realModal(id) {
  const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  const modal = document.importNode(doc.getElementById(id), true);
  document.body.appendChild(modal);
  return modal;
}

function setup() {
  const openModal = realModal("codeOpenModal");
  const saveModal = realModal("codeSaveModal");
  const dialog = new CodeFileDialog(openModal, saveModal, CONFIG.messages.codeEdit, CONFIG.codeEdit.sampleLines);
  const o = (id) => openModal.querySelector(`#${id}`);
  const s = (id) => saveModal.querySelector(`#${id}`);
  return { dialog, openModal, saveModal, o, s };
}

const isOpen = (modal) => modal.style.display === "block";
const shown = (el) => !el.hidden;

function ask(dialog, bytes, fileName = "a.txt") {
  return dialog.askOpen({ fileName, bytes, decoded: decodeFileBytes(bytes) });
}

const sjis = (text) => encodeText(text, "shift_jis", false).bytes;
const utf8 = (text) => new TextEncoder().encode(text);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CodeFileDialog: open (INV-89)", () => {
  it("AT-CFD-01 a Shift_JIS file: the guessed encoding (choosable), BOM, the first 5 lines, the counts; Open answers it", async () => {
    const t = setup();
    const lines = ["l1" + A, "l2", "l3", "l4", "l5", "l6"].join("\r\n") + "\r\n";
    const asked = ask(t.dialog, sjis(lines), "old.txt");
    expect(isOpen(t.openModal)).toBe(true);
    expect(t.o("codeOpenFileName").textContent).toBe("old.txt");
    expect(shown(t.o("codeOpenEncodingBox"))).toBe(true);
    const select = t.o("codeOpenEncoding");
    expect([...select.options].map((x) => [x.value, x.textContent])).toEqual([
      ["utf-8", "UTF-8"],
      ["shift_jis", "Shift_JIS"],
      ["euc-jp", "EUC-JP"],
      ["utf-16le", "UTF-16LE"],
      ["utf-16be", "UTF-16BE"],
    ]);
    expect(select.value).toBe("shift_jis");
    expect(t.o("codeOpenBom").textContent).toBe("BOM: no");
    expect(t.o("codeOpenPreview").textContent).toBe(`l1${A}\nl2\nl3\nl4\nl5`);
    expect(t.o("codeOpenLineCounts").textContent).toBe("CRLF 6, LF 0, CR 0");
    expect(shown(t.o("codeOpenMixedNote"))).toBe(false);
    expect(["codeOpenCrlfBtn", "codeOpenLfBtn", "codeOpenKeepBtn", "codeOpenBtn"].map((id) => shown(t.o(id)))).toEqual([false, false, false, true]);
    expect(document.activeElement).toBe(t.o("codeOpenBtn"));
    t.o("codeOpenBtn").click();
    await expect(asked).resolves.toEqual({ encoding: "shift_jis", lineEndingMode: "\r\n" });
    expect(isOpen(t.openModal)).toBe(false);
  });

  it.each([
    ["codeOpenCrlfBtn", "\r\n"],
    ["codeOpenLfBtn", "\n"],
    ["codeOpenKeepBtn", "keep"],
  ])("AT-CFD-02 mixed line endings in valid UTF-8: no encoding part, three buttons; %s answers %j", async (id, mode) => {
    const t = setup();
    const asked = ask(t.dialog, utf8("a\r\nb\nc\rd\r\n"));
    expect(shown(t.o("codeOpenEncodingBox"))).toBe(false);
    expect(t.o("codeOpenLineCounts").textContent).toBe("CRLF 2, LF 1, CR 1");
    expect(shown(t.o("codeOpenMixedNote"))).toBe(true);
    expect(["codeOpenCrlfBtn", "codeOpenLfBtn", "codeOpenKeepBtn", "codeOpenBtn"].map((x) => shown(t.o(x)))).toEqual([true, true, true, false]);
    expect(document.activeElement).toBe(t.o("codeOpenKeepBtn"));
    t.o(id).click();
    await expect(asked).resolves.toEqual({ encoding: "utf-8", lineEndingMode: mode });
  });

  it("AT-CFD-03 choosing another encoding decodes the preview, the BOM and the counts again, and answers that encoding", async () => {
    const t = setup();
    // UTF-16LE with a BOM: "a\r\nb\n" (mixed once read as UTF-16LE)
    const bytes = Uint8Array.from([0xff, 0xfe, 0x61, 0, 0x0d, 0, 0x0a, 0, 0x62, 0, 0x0a, 0]);
    const asked = ask(t.dialog, bytes);
    expect(t.o("codeOpenEncoding").value).toBe("utf-16le");
    expect(t.o("codeOpenBom").textContent).toBe("BOM: yes");
    expect(t.o("codeOpenPreview").textContent).toBe("a\nb\n");
    expect(t.o("codeOpenLineCounts").textContent).toBe("CRLF 1, LF 1, CR 0");
    const select = t.o("codeOpenEncoding");
    select.value = "utf-16be";
    select.dispatchEvent(new Event("change"));
    expect(t.o("codeOpenBom").textContent).toBe("BOM: no");
    expect(t.o("codeOpenPreview").textContent).toBe("￾愀ഀ਀戀਀");
    expect(t.o("codeOpenLineCounts").textContent).toBe("CRLF 0, LF 0, CR 0");
    expect(shown(t.o("codeOpenBtn"))).toBe(true);
    t.o("codeOpenBtn").click();
    await expect(asked).resolves.toEqual({ encoding: "utf-16be", lineEndingMode: "\n" });
  });

  it.each([
    ["Cancel", (t) => t.o("codeOpenCancelBtn").click()],
    ["Esc", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
    ["a click outside", (t) => t.openModal.dispatchEvent(new MouseEvent("click", { bubbles: true }))],
  ])("AT-CFD-04 %s closes it and answers null", async (_name, close) => {
    const t = setup();
    const asked = ask(t.dialog, sjis(`${A}\n`));
    close(t);
    await expect(asked).resolves.toBeNull();
    expect(isOpen(t.openModal)).toBe(false);
  });

  it("AT-CFD-05 the file's name and lines are shown as text, never as HTML (INV-19)", async () => {
    const t = setup();
    const evil = '<img src="x" id="evil">';
    const asked = ask(t.dialog, sjis(`${evil}${A}\n`), '<b id="evilName">n</b>.txt');
    expect(t.o("codeOpenPreview").textContent).toBe(`${evil}${A}\n`);
    expect(t.o("codeOpenFileName").textContent).toBe('<b id="evilName">n</b>.txt');
    expect(document.getElementById("evil")).toBeNull();
    expect(document.getElementById("evilName")).toBeNull();
    t.o("codeOpenCancelBtn").click();
    await asked;
  });
});

describe("CodeFileDialog: save encoding (INV-90, NE-24)", () => {
  it.each([
    ["codeSaveOriginalBtn", "original"],
    ["codeSaveUtf8Btn", "utf-8"],
    ["codeSaveCancelBtn", null],
  ])("AT-CFD-06 the question names the encoding; %s answers %j", async (id, answer) => {
    const t = setup();
    const asked = t.dialog.askSaveEncoding("shift_jis");
    expect(isOpen(t.saveModal)).toBe(true);
    expect(t.s("codeSaveQuestion").textContent).toBe("This file is in Shift_JIS. Save it in Shift_JIS or in UTF-8?");
    expect(t.s("codeSaveOriginalBtn").textContent).toBe("Shift_JIS (original)");
    expect(document.activeElement).toBe(t.s("codeSaveOriginalBtn"));
    t.s(id).click();
    await expect(asked).resolves.toBe(answer);
    expect(isOpen(t.saveModal)).toBe(false);
  });

  it("AT-CFD-07 Esc answers null; the next question asks again", async () => {
    const t = setup();
    const first = t.dialog.askSaveEncoding("euc-jp");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(first).resolves.toBeNull();
    const second = t.dialog.askSaveEncoding("euc-jp");
    expect(t.s("codeSaveOriginalBtn").textContent).toBe("EUC-JP (original)");
    t.s("codeSaveUtf8Btn").click();
    await expect(second).resolves.toBe("utf-8");
  });
});
