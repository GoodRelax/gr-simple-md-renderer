// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_SLOT } from "../../vite.config.js";
import { CONFIG } from "../js/config.js";
import { LAUNCH_BLOCK_ID } from "../js/earlyInput.js";

// The PowerShell launcher (launcher/Open-Grsmd.ps1; spec
// grsmd_launcher_spec_en.md, chapter 2 and SC-L03 to SC-L06). Each test
// copies the script into its own temporary folder with a small GRSMD.html,
// and runs it with -NoStart (no browser, no clipboard) under Windows
// PowerShell 5.1 and, when installed, PowerShell 7. The execution policy is
// bypassed for that one process only (no setting changes). The only runs
// without -NoStart are refused in the checks, before a browser could start.
// The launcher writes its copy under the user's temporary folder (PL-14):
// each run gets TEMP and TMP of its own test folder, so the real one is
// never touched.

const SCRIPT = join(process.cwd(), "launcher", "Open-Grsmd.ps1");
const MAX_BYTES = CONFIG.fileDrop.maxBytes; // the launcher's limit is GRSMD's (AT-LAUNCH-04)
const RUN_TIMEOUT = 60_000;
const COPY_NAME = /^grsmd-launch-\d{8}T\d{6}Z-[0-9a-f]{32}\.html$/;
const RANDOM = "0123456789abcdef0123456789abcdef";

/** The PowerShell programs on this machine (Windows only). */
function shells() {
  if (process.platform !== "win32") return [];
  return ["powershell.exe", "pwsh.exe"].filter(
    (exe) => spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0,
  );
}
const SHELLS = shells();

/** A small GRSMD build: the slot in <head>, and "</head>" again in a script. */
const GRSMD = `<!doctype html><html><head><meta charset="UTF-8">\n${LAUNCH_SLOT}\n</head><body><script>var s = "</head>";</script></body></html>`;

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "grsmd-launcher-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A folder with the launcher and (unless grsmd is null) GRSMD.html. */
function setUp(grsmd = GRSMD) {
  const dir = mkdtempSync(join(root, "run-"));
  copyFileSync(SCRIPT, join(dir, "Open-Grsmd.ps1"));
  if (grsmd !== null) writeFileSync(join(dir, "GRSMD.html"), grsmd);
  mkdirSync(join(dir, "tmp"));
  return dir;
}

/** The environment of a run: TEMP and TMP point into the test folder. */
function envOf(dir) {
  return { ...process.env, TEMP: join(dir, "tmp"), TMP: join(dir, "tmp") };
}

/** The launcher's folder for its copies, under that TEMP. */
function tempOf(dir) {
  return join(dir, "tmp", "grsmd-launcher");
}

/** Run the launcher to its end. */
function run(shell, dir, args, cwd = dir) {
  const result = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), ...args], {
    cwd,
    env: envOf(dir),
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** The files in the launcher's temp folder. */
function copies(dir) {
  const temp = tempOf(dir);
  return existsSync(temp) ? readdirSync(temp).filter((n) => n.endsWith(".html")) : [];
}

/** The personal help the launcher writes next to itself (PL-16 to PL-18). */
function helpOf(dir) {
  return join(dir, "grsmd-launcher-personal-help.md");
}

/** Its exact text for a temp folder (spec 4.4). */
function helpText(tempFolder) {
  return [
    `Temporary folder of Open-Grsmd.ps1: \`${tempFolder}\``,
    "",
    "To open it, paste the path into the address bar of File Explorer.",
    "",
    "How to use the launcher: `Get-Help .\\Open-Grsmd.ps1 -Full`",
    "",
  ].join("\n");
}

/** A copy's name for a delete time (UTC). */
function copyName(date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `grsmd-launch-${stamp}-${RANDOM}.html`;
}

/**
 * Run with -NoStart and a wait, and read the copy while it exists. The
 * process is ended once the copy is read (kill does not run "finally").
 */
async function runAndTakeCopy(shell, dir, args, cwd = dir) {
  const child = spawn(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), ...args, "-NoStart", "-KeepSeconds", "30"], { cwd, env: envOf(dir) });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const ended = new Promise((resolve) => child.on("exit", resolve));
  let names = [];
  for (let i = 0; i < 300 && names.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    names = copies(dir);
  }
  await new Promise((resolve) => setTimeout(resolve, 300)); // the file is closed
  const copy = readFileSync(join(tempOf(dir), names[0]));
  child.kill();
  await ended;
  return { name: names[0], copy, stdout };
}

/** The launch block of a copy: [name, bytes]. */
function blockOf(copyText) {
  const m = new RegExp(`<script type="text/plain" id="${LAUNCH_BLOCK_ID}" data-name="([A-Za-z0-9+/=]*)">([A-Za-z0-9+/=]*)</script>`).exec(copyText);
  return [Buffer.from(m[1], "base64").toString("utf8"), Buffer.from(m[2], "base64")];
}

describe("the launcher file (NFR-L02, NFR-L05, FR-L14, spec 4.4)", () => {
  const text = readFileSync(SCRIPT);

  it("AT-LAUNCH-01 is ASCII only", () => {
    const outside = [...text].filter((b) => b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09));
    expect(outside).toEqual([]);
  });

  it("AT-LAUNCH-02 uses no network command or class (CON-L1)", () => {
    const source = text.toString("ascii");
    for (const name of ["Invoke-WebRequest", "Invoke-RestMethod", "Start-BitsTransfer", "WebClient", "HttpClient", "curl", "wget", "iwr", "irm"]) {
      expect(new RegExp(`\\b${name}\\b`, "i").test(source), name).toBe(false);
    }
  });

  it("AT-LAUNCH-03 has the help of FR-L14", () => {
    const source = text.toString("ascii");
    for (const part of [".SYNOPSIS", ".DESCRIPTION", ".PARAMETER Path", ".PARAMETER GrsmdPath", ".PARAMETER Browser", ".PARAMETER KeepSeconds", ".PARAMETER NoStart", ".EXAMPLE", ".NOTES", "Save as", "Unblock-File", "ExecutionPolicy Bypass", "shortcut"]) {
      expect(source.includes(part), part).toBe(true);
    }
  });

  it("AT-LAUNCH-04 names the same slot, block id and size limit as the build, the receiver and CONFIG", () => {
    const source = text.toString("ascii");
    expect(source).toContain(`$LaunchSlot = '${LAUNCH_SLOT}'`);
    expect(source).toContain(`$LaunchBlockId = '${LAUNCH_BLOCK_ID}'`);
    expect(source).toContain(`$MaxBytes = ${CONFIG.fileDrop.maxBytes}`);
  });

  // The personal help holds the user's temp path (with the user's name), and
  // GRSMD.html is the user's own copy: git never shows them (spec L-7).
  it.each(["launcher/grsmd-launcher-personal-help.md", "launcher/GRSMD.html"])("AT-LAUNCH-34 git ignores %s", (path) => {
    expect(spawnSync("git", ["check-ignore", "-q", path], { cwd: process.cwd() }).status).toBe(0);
  });
});

describe.skipIf(SHELLS.length === 0).each(SHELLS)("the launcher under %s", (shell) => {
  it("AT-LAUNCH-05 writes the build with the slot replaced by the block (FR-L07)", async () => {
    const dir = setUp();
    const name = `${String.fromCharCode(0x30e1, 0x30e2)} 1.md`; // non-ASCII and a space
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# A\r\n\r\n$x$ </script>\n"), Buffer.from([0, 255])]);
    writeFileSync(join(dir, name), bytes);
    const before = Date.now();
    const taken = await runAndTakeCopy(shell, dir, [join(dir, name)]);
    expect(taken.name).toMatch(COPY_NAME);
    // the name's delete time is about now + KeepSeconds (30)
    const stamp = /grsmd-launch-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(taken.name);
    const deleteAt = Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]);
    expect(deleteAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + 29_000);
    expect(deleteAt).toBeLessThanOrEqual(Date.now() + 31_000);
    const text = taken.copy.toString("latin1");
    const [head, tail] = GRSMD.split(LAUNCH_SLOT);
    expect(text.startsWith(head)).toBe(true);
    expect(text.endsWith(tail)).toBe(true);
    const [decodedName, decodedBytes] = blockOf(text);
    expect(decodedName).toBe(name);
    expect(decodedBytes.equals(bytes)).toBe(true);
    expect(text).not.toContain(LAUNCH_SLOT);
    expect(taken.stdout).toContain(`Temporary copy: ${join(tempOf(dir), taken.name)}`);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-06 ends with exit 0 and leaves no copy (KeepSeconds 0) (SC-L03)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Temporary copy: .*grsmd-launch-\d{8}T\d{6}Z-[0-9a-f]{32}\.html\r?\nThe temporary copy is deleted in 0 s \(Ctrl\+C deletes it now\)\.$/);
    expect(result.stderr).toBe("");
    expect(copies(dir)).toEqual([]);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-14 keeps the copy for KeepSeconds, then deletes it (FR-L11, SC-L03)", async () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const started = Date.now();
    const child = spawn(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), "a.md", "-NoStart", "-KeepSeconds", "3"], { cwd: dir, env: envOf(dir) });
    const ended = new Promise((resolve) => child.on("exit", resolve));
    let seen = [];
    for (let i = 0; i < 300 && seen.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      seen = copies(dir);
    }
    expect(seen).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(copies(dir)).toEqual(seen); // still there while it waits
    expect(await ended).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
    expect(copies(dir)).toEqual([]);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-07 deletes only copies whose delete time has passed, before writing (FR-L08, SC-L04)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    mkdirSync(tempOf(dir));
    const past = copyName(new Date(Date.now() - 120_000));
    const future = copyName(new Date(Date.now() + 600_000)); // another run that still waits
    const others = ["notes.html", `grsmd-launch-${RANDOM}.html`, "grsmd-launch-20201301T000000Z-bad.html"];
    for (const f of [past, future, ...others]) writeFileSync(join(tempOf(dir), f), "x");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(copies(dir).sort()).toEqual([future, ...others].sort());
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-17 warns and goes on when an old copy cannot be deleted (FR-L08)", async () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    mkdirSync(tempOf(dir));
    const locked = join(tempOf(dir), copyName(new Date(Date.now() - 120_000)));
    writeFileSync(locked, "x");
    // another process holds the file open with no sharing, so it cannot be deleted
    const holder = spawn(shell, ["-NoProfile", "-Command", `$f = [IO.File]::Open('${locked}', 'Open', 'Read', 'None'); 'held'; Start-Sleep 20; $f.Close()`]);
    const ended = new Promise((resolve) => holder.on("exit", resolve));
    await new Promise((resolve) => holder.stdout.on("data", (d) => String(d).includes("held") && resolve()));
    try {
      const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
      expect(result.status).toBe(0);
      // the host wraps a long warning, and its "WARNING:" word is in the language of Windows
      expect(`${result.stdout}${result.stderr}`.replace(/\r?\n/g, "")).toContain(`Could not delete an old temporary copy: ${locked}`);
      expect(existsSync(locked)).toBe(true);
    } finally {
      holder.kill();
      await ended;
    }
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-08 takes a relative path literally: brackets are not wildcards (FR-L02)", async () => {
    const dir = setUp();
    writeFileSync(join(dir, "a[1].md"), "# A\n");
    writeFileSync(join(dir, "a1.md"), "# wrong\n");
    const taken = await runAndTakeCopy(shell, dir, ["a[1].md"]);
    const [decodedName, decodedBytes] = blockOf(taken.copy.toString("latin1"));
    expect(decodedName).toBe("a[1].md");
    expect(decodedBytes.toString("utf8")).toBe("# A\n");
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-09 accepts exactly the size limit and an empty file (FR-L04)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "max.md"), Buffer.alloc(MAX_BYTES, 0x41));
    writeFileSync(join(dir, "empty.md"), "");
    expect(run(shell, dir, ["max.md", "-NoStart", "-KeepSeconds", "0"]).status).toBe(0);
    expect(run(shell, dir, ["empty.md", "-NoStart", "-KeepSeconds", "0"]).status).toBe(0);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-10 takes GRSMD.html from -GrsmdPath (FR-L05)", () => {
    const dir = setUp(null);
    writeFileSync(join(dir, "a.md"), "# A\n");
    writeFileSync(join(dir, "build.html"), GRSMD);
    const result = run(shell, dir, ["a.md", "-GrsmdPath", "build.html", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
  }, RUN_TIMEOUT);

  it.each([
    ["the file is missing", (dir) => [["nope.md", "-NoStart"], `Open-Grsmd: File not found: ${join(dir, "nope.md")}`]],
    ["the path is a folder", (dir) => (mkdirSync(join(dir, "sub")), [["sub", "-NoStart"], `Open-Grsmd: Not a file: ${join(dir, "sub")}`])],
    [
      "the file is 1 byte over the limit",
      (dir) => (
        writeFileSync(join(dir, "big.md"), Buffer.alloc(MAX_BYTES + 1, 0x41)),
        [["big.md", "-NoStart"], `Open-Grsmd: The file is larger than 5 MB (${MAX_BYTES + 1} bytes): ${join(dir, "big.md")}`]
      ),
    ],
    [
      "-GrsmdPath names no file",
      (dir) => [["a.md", "-GrsmdPath", "none.html", "-NoStart"], `Open-Grsmd: GRSMD.html not found: ${join(dir, "none.html")}. Put GRSMD.html next to this script or pass -GrsmdPath.`],
    ],
    [
      "GRSMD.html has no slot",
      (dir) => (writeFileSync(join(dir, "GRSMD.html"), GRSMD.replace(LAUNCH_SLOT, "")), [["a.md", "-NoStart"], `Open-Grsmd: ${join(dir, "GRSMD.html")} has no launch slot. Use a newer GRSMD.html.`]),
    ],
    [
      "the slot is after </head>",
      (dir) => (
        writeFileSync(join(dir, "GRSMD.html"), GRSMD.replace(LAUNCH_SLOT, "").replace("<body>", `<body>${LAUNCH_SLOT}`)),
        [["a.md", "-NoStart"], `Open-Grsmd: ${join(dir, "GRSMD.html")} has no launch slot. Use a newer GRSMD.html.`]
      ),
    ],
    [
      "a browser would start with KeepSeconds under 5",
      () => [["a.md"], "Open-Grsmd: -KeepSeconds must be 5 or more when a browser is started (0 to 4 only with -NoStart)."],
    ],
  ])("AT-LAUNCH-11 stops with exit 1 before writing anything when %s (FR-L03 to FR-L06, FR-L18, SC-L05)", (_label, arrange) => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const [args, message] = arrange(dir);
    const result = run(shell, dir, [...args, "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(message);
    expect(result.stdout).toBe("");
    expect(existsSync(tempOf(dir))).toBe(false);
    expect(existsSync(helpOf(dir))).toBe(false);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-12 stops when GRSMD.html is not next to the script (FR-L05)", () => {
    const dir = setUp(null);
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Open-Grsmd: GRSMD.html not found: ${join(dir, "GRSMD.html")}. Put GRSMD.html next to this script or pass -GrsmdPath.`);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-15 stops with exit 1 and leaves no copy when the copy cannot be written (FR-L13)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    writeFileSync(tempOf(dir), "a file where the temp folder should be");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    // the reason after the folder is Windows' own text, in its language (spec 4.3)
    expect(result.stderr.startsWith(`Open-Grsmd: Cannot write the temporary copy in ${tempOf(dir)}: `)).toBe(true);
    expect(result.stderr.split(/\r?\n/)).toHaveLength(1);
    expect(result.stdout).toBe("");
    expect(readFileSync(tempOf(dir), "utf8")).toBe("a file where the temp folder should be");
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-18 writes the personal help next to itself: the temp folder's full path, how to open it, Get-Help (FR-L27, PL-16 to PL-18)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "secret-name.md"), "# secret content\n");
    const result = run(shell, dir, ["secret-name.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    const text = readFileSync(helpOf(dir), "utf8");
    expect(text).toBe(helpText(tempOf(dir)));
    expect(text).not.toContain("secret");
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-19 leaves the personal help as it is when its text is the same (FR-L28)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    writeFileSync(helpOf(dir), helpText(tempOf(dir)));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(helpOf(dir), old, old);
    expect(run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]).status).toBe(0);
    expect(Math.abs(statSync(helpOf(dir)).mtimeMs - old.getTime())).toBeLessThan(2000);
    writeFileSync(helpOf(dir), "old text");
    expect(run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]).status).toBe(0);
    expect(readFileSync(helpOf(dir), "utf8")).toBe(helpText(tempOf(dir)));
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-33 warns and goes on when the personal help cannot be written (FR-L29)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    mkdirSync(helpOf(dir)); // a folder where the file should be
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`.replace(/\r?\n/g, "")).toContain(`Could not write ${helpOf(dir)}: `);
    expect(result.stdout).toContain("Temporary copy: ");
  }, RUN_TIMEOUT);

  const firefoxRegistered = ["HKCU", "HKLM"].some(
    (hive) => spawnSync("reg", ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe`], { stdio: "ignore" }).status === 0,
  );
  it.skipIf(firefoxRegistered)("AT-LAUNCH-13 stops when the chosen browser is not installed (FR-L09, FR-L16, SC-L06)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-Browser", "Firefox", "-KeepSeconds", "5"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Open-Grsmd: Firefox was not found.");
    expect(existsSync(tempOf(dir))).toBe(false);
  }, RUN_TIMEOUT);

  it.skipIf(firefoxRegistered)("AT-LAUNCH-16 does not look the browser up with -NoStart (FR-L16)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-Browser", "Firefox", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  }, RUN_TIMEOUT);
});
