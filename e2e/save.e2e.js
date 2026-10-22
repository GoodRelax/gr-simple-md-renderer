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
