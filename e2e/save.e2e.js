import { test, expect, dropFile } from "./fixtures.js";

const NOTE = { name: "note.md", text: "# Note\n\nBody line.\n", type: "text/markdown" };

async function openNoteWithPalette(page) {
  await page.goto("/");
  await dropFile(page, NOTE);
  await expect(page.locator("#preview h1")).toHaveText("Note");
  await page.locator("#editBtn").click();
  await expect(page.locator("#paletteSaveAs")).toBeVisible();
}

test("Save as downloads the file when the browser cannot write in place", async ({ page }) => {
  // Chromium has showSaveFilePicker; hide it so every browser takes the
  // download path that Firefox and Safari take for real.
  // The blob the app gives the link is read in the page: on a loaded
  // Windows machine Chromium (with Playwright) cancels some downloads even
  // for a page that only clicks a blob link and never revokes its URL, so
  // the saved file is not waited for (review CR-1).
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined;
    window.__e2eBlobs = [];
    window.__e2eBlobUrls = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__e2eBlobs.push(blob);
      window.__e2eBlobUrls.push(url);
      return url;
    };
  });
  await openNoteWithPalette(page);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#paletteSaveAs").click();
  const download = await downloadPromise;

  // the toast first: it goes after CONFIG.codeView.toastDurationMs (3 s)
  await expect(page.locator("#toastContainer")).toContainText("note.md");
  expect(download.suggestedFilename()).toBe("note.md");
  const saved = await page.evaluate(async () => ({
    count: window.__e2eBlobs.length,
    type: window.__e2eBlobs[0]?.type,
    text: await window.__e2eBlobs[0]?.text(),
    url: window.__e2eBlobUrls[0],
  }));
  const { url, ...blob } = saved;
  expect(blob).toEqual({ count: 1, type: "text/markdown;charset=utf-8", text: NOTE.text });
  // the download is that blob, not some other URL (review R2-1)
  expect(url).toMatch(/^blob:/);
  expect(download.url()).toBe(url);
});

test("Save as writes through showSaveFilePicker (fake picker)", async ({ page }) => {
  // The native save dialog cannot be automated. A fake picker records the
  // call and returns an in-memory file handle that keeps what was written.
  await page.addInitScript(() => {
    window.__e2eSaves = [];
    window.showSaveFilePicker = async (options) => {
      const record = { suggestedName: options?.suggestedName, chunks: [], closed: false };
      window.__e2eSaves.push(record);
      let lastModified = Date.now();
      return {
        kind: "file",
        name: "chosen.md",
        async requestPermission() {
          return "granted";
        },
        async createWritable() {
          return {
            async write(data) {
              record.chunks.push(String(data));
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
          return new File([record.chunks.join("")], "chosen.md", { lastModified });
        },
      };
    };
  });
  await openNoteWithPalette(page);

  await page.locator("#paletteSaveAs").click();
  await expect(page.locator("#toastContainer")).toContainText("Saved: chosen.md");

  const saves = await page.evaluate(() => window.__e2eSaves);
  expect(saves).toHaveLength(1);
  expect(saves[0].suggestedName).toBe("note.md");
  expect(saves[0].closed).toBe(true);
  expect(saves[0].chunks.join("")).toBe(NOTE.text);
});

/**
 * A fake save dialog for INV-108 / INV-109: "abort" rejects as Edge 156
 * does after [Save] (R5), "write" returns an in-memory file named
 * "secret-name.md". The blobs the page downloads are kept for reading.
 */
function fakeSaveDialog(pickerMode) {
  window.__e2eBlobs = [];
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__e2eBlobs.push(blob);
    return create(blob);
  };
  window.showSaveFilePicker = async () => {
    if (pickerMode === "abort") throw new DOMException("The user aborted a request.", "AbortError");
    return {
      kind: "file",
      name: "secret-name.md",
      async requestPermission() {
        return "granted";
      },
      async createWritable() {
        return { async write() {}, async close() {}, async abort() {} };
      },
      async getFile() {
        return new File([""], "secret-name.md", { lastModified: Date.now() });
      },
    };
  };
}

test("INV-108 a save dialog that ends with AbortError shows Not saved. with [Download]; [Download] downloads the document", async ({ page }) => {
  await page.addInitScript(fakeSaveDialog, "abort");
  await openNoteWithPalette(page);

  await page.locator("#paletteSaveAs").click();
  const toast = page.locator("#toastContainer .toast-action");
  await expect(toast).toContainText("Not saved.");
  const button = toast.getByRole("button", { name: "Download" });
  await expect(button).toBeVisible();
  expect(await page.evaluate(() => window.__e2eBlobs.length)).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await button.click(); // a real click: the toast takes the press (pointer-events)
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("note.md");
  await expect(page.locator("#toastContainer")).toContainText("Downloading: note.md. It's still not saved.");
  await expect(toast).toHaveCount(0);
  const saved = await page.evaluate(async () => ({ count: window.__e2eBlobs.length, text: await window.__e2eBlobs[0]?.text() }));
  expect(saved).toEqual({ count: 1, text: NOTE.text });
});

test("INV-109 each save step writes one line on the console; no names, paths or text", async ({ page }) => {
  const lines = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("GRSMD save: ")) lines.push({ type: msg.type(), text: msg.text() });
  });
  await page.addInitScript(fakeSaveDialog, "write");
  await openNoteWithPalette(page);

  await page.locator("#paletteSaveAs").click();
  await expect(page.locator("#toastContainer")).toContainText("Saved: secret-name.md");
  await expect.poll(() => lines.length).toBe(4);
  const shape = /^GRSMD save: (picker|createWritable|write|close) ok \d+ ms id=yes startIn=(yes|no) type=\.md \S+ build=\d{4}-\d{2}-\d{2}$/;
  expect(lines.map((l) => l.text.split(" ")[2])).toEqual(["picker", "createWritable", "write", "close"]);
  for (const line of lines) {
    expect(line.type).toBe("info");
    expect(line.text).toMatch(shape);
    expect(line.text).not.toMatch(/secret|note|Body/);
  }
  // nothing on the page, nothing stored
  await expect(page.locator("body")).not.toContainText("GRSMD save:");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test("INV-109 the save dialog's AbortError writes the fail line (R5)", async ({ page }) => {
  const lines = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("GRSMD save: ")) lines.push(msg.text());
  });
  await page.addInitScript(fakeSaveDialog, "abort");
  await openNoteWithPalette(page);

  await page.locator("#paletteSaveAs").click();
  await expect(page.locator("#toastContainer .toast-action")).toContainText("Not saved.");
  await expect.poll(() => lines.length).toBe(1);
  expect(lines[0]).toMatch(/^GRSMD save: picker fail AbortError "The user aborted a request\." \d+ ms id=yes startIn=(yes|no) type=\.md \S+ build=\d{4}-\d{2}-\d{2}$/);
});
