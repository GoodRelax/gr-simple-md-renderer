import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG } from "../src/js/config.js";
import { test, expect } from "./fixtures.js";

// The PowerShell launcher end to end (launcher spec SC-L01, SC-L07; main spec
// INV-104): the launcher makes a temporary copy of the build (output/e2e,
// made by npm run test:e2e) with the file in it, and the copy opened by
// file:/// shows the file as a dropped one. The fixtures' guards hold: no
// request leaves the browser, and no console error (a library that cannot
// run is one). Chromium only: the launcher targets Edge and Chrome on Windows.

const BUILD = join(process.cwd(), "output", "e2e", "index.html");
const SCRIPT = join(process.cwd(), "launcher", "Open-Grsmd.ps1");
const hasPowerShell = process.platform === "win32" && spawnSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;

test.skip(({ browserName }) => browserName !== "chromium" || !hasPowerShell, "the launcher runs on Windows; the copy is checked in Chromium");

let dir;
let launcher;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grsmd-launcher-e2e-"));
  copyFileSync(SCRIPT, join(dir, "Open-Grsmd.ps1"));
  copyFileSync(BUILD, join(dir, "GRSMD.html"));
  mkdirSync(join(dir, "tmp"));
});
test.afterEach(async () => {
  if (launcher && launcher.exitCode === null) {
    const ended = new Promise((resolve) => launcher.on("exit", resolve));
    launcher.kill();
    await ended;
  }
  launcher = null;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Open the copy. The fixtures' guard aborts every request outside the test
 * server; a page route (it wins over the guard's context route) lets through
 * this one file:/// URL and nothing else.
 */
async function openCopy(page, url) {
  await page.route(url, (route) => route.continue());
  await page.goto(url);
}

/** Run the launcher with -NoStart and return the file:/// URL of its copy. */
async function launch(fileName, text) {
  writeFileSync(join(dir, fileName), text);
  launcher = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), join(dir, fileName), "-NoStart", "-KeepSeconds", "60"], {
    env: { ...process.env, TEMP: join(dir, "tmp"), TMP: join(dir, "tmp") }, // the copy goes under TEMP (PL-14); not the real one
  });
  let stdout = "";
  launcher.stdout.on("data", (d) => (stdout += d));
  await expect.poll(() => /Temporary copy: (.+\.html)/.test(stdout), { timeout: 20_000 }).toBe(true);
  const copy = /Temporary copy: (.+\.html)/.exec(stdout)[1].trim();
  expect(existsSync(copy)).toBe(true);
  expect(readdirSync(join(dir, "tmp", "grsmd-launcher"))).toHaveLength(1);
  return pathToFileURL(copy).href;
}

test("AT-LAUNCH-40 SC-L01: a .md file with a diagram and math opens as a dropped file, and the block is gone", async ({ page }) => {
  const url = await launch("note.md", "# Launched heading\n\nInline $x^2$ math.\n\n```mermaid\ngraph LR\n  A --> B\n```\n");
  await openCopy(page, url);
  await expect(page.locator("body")).toHaveClass(/\bview-markdown\b/);
  await expect(page.locator("#preview h1")).toHaveText("Launched heading");
  await expect(page.locator("#preview .katex").first()).toBeVisible();
  await expect(page.locator("#preview svg").first()).toBeVisible();
  await expect(page.locator("#grsmd-launch-file")).toHaveCount(0);
});

test("AT-LAUNCH-41 SC-L07: another text file opens in the code view", async ({ page }) => {
  const url = await launch("app.js", "function hello() {\n  return 'world';\n}\n");
  await openCopy(page, url);
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await expect(page.locator("#fileInfo")).toContainText("app.js");
  await expect(page.locator("#preview")).toContainText("function hello()");
});

test("AT-LAUNCH-42 SC-L07: a binary file is refused by GRSMD with its message, as on a drop", async ({ page }) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const url = await launch("image.png", png);
  const messages = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.accept();
  });
  await openCopy(page, url);
  await expect.poll(() => messages).toEqual([CONFIG.fileDrop.messages.binaryFile]);
  await expect(page.locator("body")).not.toHaveClass(/\bview-(markdown|code)\b/);
  await expect(page.locator("#grsmd-launch-file")).toHaveCount(0);
});
