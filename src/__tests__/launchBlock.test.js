import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { installBoot } from "../js/boot.js";
import { LAUNCH_BLOCK_ID, isLaunchBlock, readLaunchBlock } from "../js/earlyInput.js";
import { LAUNCH_SLOT, launchSlot, launchSlotError } from "../../vite.config.js";

// The GRSMD side of the PowerShell launcher (INV-104; launcher spec FR-G01
// to FR-G05, SC-L08, SC-L09): the receiver takes the launch block as the
// early drop, and the build keeps one launch slot in <head>.

const NAME_JA = `${String.fromCharCode(0x30e1, 0x30e2)}.md`; // a non-ASCII file name, written in ASCII
const BYTES = Uint8Array.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41, 0x0d, 0x0a, 0x00, 0xff]);

afterEach(() => vi.restoreAllMocks());

/** Base64 of bytes, as the launcher writes it. */
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const b64Name = (name) => Buffer.from(name, "utf8").toString("base64");

/** The launch block element's HTML (spec 4.4). */
function blockHtml({ name = b64Name("note.md"), text = b64(BYTES), type = "text/plain", id = LAUNCH_BLOCK_ID } = {}) {
  return `<script type="${type}" id="${id}" data-name="${name}">${text}</script>`;
}

/** A page with the given HTML in <head> and in <body>. */
function page({ head = "", body = "" } = {}) {
  return new JSDOM(`<!doctype html><html><head>${head}</head><body><textarea id="editor"></textarea>${body}</body></html>`).window;
}

/** The bytes of a jsdom File. */
async function bytesOf(win, file) {
  const buffer = await new Promise((resolve) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
  return new Uint8Array(buffer);
}

describe("readLaunchBlock and isLaunchBlock (INV-104 (1)(3)(4))", () => {
  it("AT-LAUNCH-20 decodes the name (UTF-8) and the bytes unchanged (BOM, CR LF, NUL kept)", () => {
    const win = page({ head: blockHtml({ name: b64Name(NAME_JA) }) });
    const read = readLaunchBlock(win.document.getElementById(LAUNCH_BLOCK_ID));
    expect(read.name).toBe(NAME_JA);
    expect([...read.bytes]).toEqual([...BYTES]);
  });

  it("AT-LAUNCH-21 an empty file is a file", () => {
    const win = page({ head: blockHtml({ text: "" }) });
    const read = readLaunchBlock(win.document.getElementById(LAUNCH_BLOCK_ID));
    expect(read.name).toBe("note.md");
    expect(read.bytes.length).toBe(0);
  });

  it.each([
    ["the text is not Base64", { text: "not base64 !" }],
    ["the name is not Base64", { name: "%%%" }],
    ["the name is empty", { name: "" }],
    ["the name is not UTF-8", { name: b64([0xc3, 0x28]) }],
  ])("AT-LAUNCH-22 null when %s", (_label, parts) => {
    const win = page({ head: blockHtml(parts) });
    expect(readLaunchBlock(win.document.getElementById(LAUNCH_BLOCK_ID))).toBeNull();
  });

  it("AT-LAUNCH-23 null when data-name is missing", () => {
    const win = page({ head: `<script type="text/plain" id="${LAUNCH_BLOCK_ID}">${b64(BYTES)}</script>` });
    expect(readLaunchBlock(win.document.getElementById(LAUNCH_BLOCK_ID))).toBeNull();
  });

  it("AT-LAUNCH-24 only a text/plain script right under <head> is the block", () => {
    const inHead = page({ head: blockHtml() });
    expect(isLaunchBlock(inHead.document.getElementById(LAUNCH_BLOCK_ID), inHead.document.head)).toBe(true);
    const inBody = page({ body: blockHtml() });
    expect(isLaunchBlock(inBody.document.getElementById(LAUNCH_BLOCK_ID), inBody.document.head)).toBe(false);
    const json = page({ head: blockHtml({ type: "application/json" }) });
    expect(isLaunchBlock(json.document.getElementById(LAUNCH_BLOCK_ID), json.document.head)).toBe(false);
    const div = page({ head: `<template><div id="${LAUNCH_BLOCK_ID}"></div></template>` });
    expect(isLaunchBlock(div.document.getElementById(LAUNCH_BLOCK_ID), div.document.head)).toBe(false);
    expect(isLaunchBlock(null, inHead.document.head)).toBe(false);
  });
});

describe("the receiver takes the launch block (INV-104 (1)(2)(3), SC-L08, SC-L09)", () => {
  it("AT-LAUNCH-25 keeps the file as the early drop with no handle, and removes the block", async () => {
    const win = page({ head: blockHtml({ name: b64Name(NAME_JA) }) });
    const warn = vi.spyOn(console, "warn");
    installBoot(win);
    expect(win.document.getElementById(LAUNCH_BLOCK_ID)).toBeNull();
    const early = win.__grsmdBoot.takeEarlyInput();
    expect(early.kind).toBe("drop");
    expect(early.handlePromise).toBeNull();
    expect(early.file).toBeInstanceOf(win.File);
    expect(early.file.name).toBe(NAME_JA);
    expect(early.file.size).toBe(BYTES.length);
    expect([...(await bytesOf(win, early.file))]).toEqual([...BYTES]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("AT-LAUNCH-26 a block that cannot be read: no early input, one warning, the block removed", () => {
    const win = page({ head: blockHtml({ text: "not base64 !" }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installBoot(win);
    expect(win.document.getElementById(LAUNCH_BLOCK_ID)).toBeNull();
    expect(win.__grsmdBoot.takeEarlyInput()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("GRSMD: the launch file could not be read."); // spec 4.3
  });

  it("AT-LAUNCH-27 an element with the id outside <head> is not taken and stays", () => {
    const win = page({ body: blockHtml() });
    installBoot(win);
    expect(win.document.getElementById(LAUNCH_BLOCK_ID)).not.toBeNull();
    expect(win.__grsmdBoot.takeEarlyInput()).toBeNull();
  });

  it("AT-LAUNCH-28 a page without a block keeps no early input", () => {
    const win = page();
    installBoot(win);
    expect(win.__grsmdBoot.takeEarlyInput()).toBeNull();
  });

  it("AT-LAUNCH-29 a drop before the core runs wins over the launch file (the last input)", () => {
    const win = page({ head: blockHtml() });
    installBoot(win);
    const dropped = new win.File(["# B"], "b.md");
    const event = new win.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [dropped], items: [] } });
    win.document.body.dispatchEvent(event);
    const early = win.__grsmdBoot.takeEarlyInput();
    expect(early.kind).toBe("drop");
    expect(early.file).toBe(dropped);
  });
});

describe("the launch slot of the build (INV-104 (5), FR-G01)", () => {
  const head = (inside) => `<!doctype html><html><head><meta charset="UTF-8">${inside}</head><body><script>var s = "</head>";</script></body></html>`;

  it("AT-LAUNCH-30 one slot inside <head> is right", () => {
    expect(launchSlotError(head(LAUNCH_SLOT))).toBeNull();
  });

  it.each([
    ["no slot", head(""), "no launch slot"],
    ["two slots", head(LAUNCH_SLOT + LAUNCH_SLOT), "2 launch slots (one expected)"],
    ["a slot after </head>", head("").replace("<body>", `<body>${LAUNCH_SLOT}`), "the launch slot is not inside <head>"],
  ])("AT-LAUNCH-31 %s fails the build", (_label, html, message) => {
    expect(launchSlotError(html)).toBe(message);
    const bundle = { "index.html": { type: "asset", fileName: "index.html", source: html } };
    const ctx = {
      error(msg) {
        throw new Error(msg);
      },
    };
    expect(() => launchSlot.generateBundle.call(ctx, {}, bundle)).toThrow(`index.html: ${message}`);
  });

  it("AT-LAUNCH-32 the source page has the slot once, inside <head>", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(`${process.cwd()}/src/index.html`, "utf8");
    expect(launchSlotError(html)).toBeNull();
  });
});
