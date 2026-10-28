import { test, expect } from "./fixtures.js";

// Code files (SC-27): the open dialog for a file that is not UTF-8 or mixes
// line endings (INV-89), the file info line, and Save as in the file's own
// encoding (INV-90, NE-24) through a fake save dialog that keeps the bytes.

const ASCII = (s) => [...s].map((c) => c.charCodeAt(0));
// "# " + three hiragana (Shift_JIS 82A0 82A2 82A4), CRLF, "print(1)", CRLF
const SJIS_BYTES = [...ASCII("# "), 0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x0d, 0x0a, ...ASCII("print(1)"), 0x0d, 0x0a];
const KANA = "\u3042\u3044\u3046"; // hiragana a, i, u

/**
 * Drop a file built from bytes in the page (the File is made there, so no
 * text decoding happens on the way).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {number[]} bytes
 */
async function dropBytes(page, name, bytes) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { lastModified: Date.now() }));
      return dt;
    },
    { name, bytes },
  );
  await page.dispatchEvent("#preview", "dragover", { dataTransfer });
  await page.dispatchEvent("#preview", "drop", { dataTransfer });
}

/** The primary modifier the page uses (INV-14): Cmd on Apple platforms. */
async function primaryKey(page) {
  const apple = await page.evaluate(() => {
    const platform = navigator.userAgentData?.platform;
    return platform ? platform === "macOS" : /Mac|iPhone|iPad/.test(navigator.platform);
  });
  return apple ? "Meta" : "Control";
}

test("INV-89 (1)(2)(5): a Shift_JIS file: the open dialog shows the encoding and the first lines; Open shows the file with Shift_JIS in the file info", async ({ page }) => {
  await page.goto("/");
  await dropBytes(page, "old.py", SJIS_BYTES);
  const modal = page.locator("#codeOpenModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#codeOpenEncoding")).toHaveValue("shift_jis");
  await expect(page.locator("#codeOpenPreview")).toHaveText(`# ${KANA}\nprint(1)\n`);
  await expect(page.locator("#codeOpenLineCounts")).toHaveText("CRLF 2, LF 0, CR 0");
  await expect(page.locator("#codeOpenKeepBtn")).toBeHidden();
  await page.locator("#codeOpenBtn").click();
  await expect(modal).toBeHidden();
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#codeViewBody")).toContainText(KANA);
  await expect(page.locator("#fileInfo")).toHaveText(/Shift_JIS\s+\|\s+CRLF/);
});

test("INV-89 (2)(5): mixed CRLF and LF: the three buttons; Keep as is opens it with the endings kept", async ({ page }) => {
  await page.goto("/");
  await dropBytes(page, "mixed.txt", ASCII("a\r\nb\nc"));
  await expect(page.locator("#codeOpenModal")).toBeVisible();
  await expect(page.locator("#codeOpenEncodingBox")).toBeHidden();
  await expect(page.locator("#codeOpenLineCounts")).toHaveText("CRLF 1, LF 1, CR 0");
  for (const id of ["#codeOpenCrlfBtn", "#codeOpenLfBtn", "#codeOpenKeepBtn"]) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator("#codeOpenBtn")).toBeHidden();
  await page.locator("#codeOpenKeepBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#fileInfo")).toHaveText(/UTF-8\s+\|\s+Mixed \(kept\)/);
});

test("INV-89 (4): a UTF-8 .txt opens without the dialog", async ({ page }) => {
  await page.goto("/");
  await dropBytes(page, "plain.txt", ASCII("hello\nworld\n"));
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#codeViewBody")).toContainText("world");
  await expect(page.locator("#codeOpenModal")).toBeHidden();
  await expect(page.locator("#fileInfo")).toHaveText(/UTF-8\s+\|\s+LF/);
});

test("INV-90 (2)(4)(5): Save as of the Shift_JIS file in its original encoding writes the same bytes (fake save dialog)", async ({ page }) => {
  // The native save dialog cannot be automated: a fake one records the call
  // and keeps the written bytes.
  await page.addInitScript(() => {
    window.__e2eSaves = [];
    window.showSaveFilePicker = async (options) => {
      const record = { suggestedName: options?.suggestedName, types: options?.types ?? null, bytes: [], closed: false };
      window.__e2eSaves.push(record);
      let lastModified = Date.now();
      return {
        kind: "file",
        name: "copy.py",
        async requestPermission() {
          return "granted";
        },
        async createWritable() {
          return {
            async write(data) {
              record.bytes.push(...(typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data)));
            },
            async close() {
              record.closed = true;
              lastModified = Date.now();
            },
            async abort() {
              record.aborted = true;
            },
          };
        },
        async getFile() {
          return new File([new Uint8Array(record.bytes)], "copy.py", { lastModified });
        },
      };
    };
  });
  await page.goto("/");
  await dropBytes(page, "old.py", SJIS_BYTES);
  await page.locator("#codeOpenBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);

  const mod = await primaryKey(page);
  await page.keyboard.press(`${mod}+Shift+S`);
  await expect(page.locator("#codeSaveModal")).toBeVisible();
  await expect(page.locator("#codeSaveQuestion")).toHaveText("This file is in Shift_JIS. Save it in Shift_JIS or in UTF-8?");
  await page.locator("#codeSaveOriginalBtn").click();
  await expect(page.locator("#toastContainer")).toContainText("Saved: copy.py");

  const saves = await page.evaluate(() => window.__e2eSaves);
  expect(saves).toHaveLength(1);
  expect(saves[0].suggestedName).toBe("old.py");
  expect(saves[0].types).toEqual([{ description: "PY file", accept: { "text/plain": [".py"] } }]);
  expect(saves[0].closed).toBe(true);
  expect(saves[0].bytes).toEqual(SJIS_BYTES);
  await expect(page.locator("#fileInfo")).toHaveText(/^copy\.py/);
});
