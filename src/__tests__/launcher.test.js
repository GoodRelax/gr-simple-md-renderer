// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_SLOT } from "../../vite.config.js";
import { LAUNCH_BLOCK_ID } from "../js/earlyInput.js";

// The PowerShell launcher (launcher/Open-Grsmd.ps1; spec
// grsmd_launcher_spec_en.md, FR-L01 to FR-L14, SC-L03 to SC-L06). Each test
// copies the script into its own temporary folder with a small GRSMD.html,
// and runs it with -NoStart (no browser, no clipboard) under Windows
// PowerShell 5.1 and, when installed, PowerShell 7. The execution policy is
// bypassed for that one process only (no setting changes).

const SCRIPT = join(process.cwd(), "launcher", "Open-Grsmd.ps1");
const MAX_BYTES = 5 * 1024 * 1024;
const RUN_TIMEOUT = 60_000;

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
  return dir;
}

/** Run the launcher to its end. */
function run(shell, dir, args, cwd = dir) {
  const result = spawnSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** The copies in the temp folder next to the launcher. */
function copies(dir) {
  const temp = join(dir, "temp");
  return existsSync(temp) ? readdirSync(temp).filter((n) => n.endsWith(".html")) : [];
}

/** Run with a wait, take the copy while it exists, then wait for the end. */
async function runAndTakeCopy(shell, dir, args) {
  const child = spawn(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, "Open-Grsmd.ps1"), ...args, "-NoStart", "-KeepSeconds", "30"]);
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const ended = new Promise((resolve) => child.on("exit", resolve));
  let names = [];
  for (let i = 0; i < 300 && names.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    names = copies(dir);
  }
  await new Promise((resolve) => setTimeout(resolve, 300)); // the file is closed
  const copy = readFileSync(join(dir, "temp", names[0]));
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

  it("AT-LAUNCH-04 names the same slot and block id as the build and the receiver", () => {
    const source = text.toString("ascii");
    expect(source).toContain(`$LaunchSlot = '${LAUNCH_SLOT}'`);
    expect(source).toContain(`$LaunchBlockId = '${LAUNCH_BLOCK_ID}'`);
  });
});

describe.skipIf(SHELLS.length === 0).each(SHELLS)("the launcher under %s", (shell) => {
  it("AT-LAUNCH-05 writes the build with the slot replaced by the block, then deletes it (FR-L07, FR-L11, SC-L03)", async () => {
    const dir = setUp();
    const name = `${String.fromCharCode(0x30e1, 0x30e2)} 1.md`; // non-ASCII and a space
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# A\r\n\r\n$x$ </script>\n"), Buffer.from([0, 255])]);
    writeFileSync(join(dir, name), bytes);
    const taken = await runAndTakeCopy(shell, dir, [join(dir, name)]);
    expect(taken.name).toMatch(/^grsmd-launch-[0-9a-f]{32}\.html$/);
    const text = taken.copy.toString("latin1");
    const [before, after] = GRSMD.split(LAUNCH_SLOT);
    expect(text.startsWith(before)).toBe(true);
    expect(text.endsWith(after)).toBe(true);
    const [decodedName, decodedBytes] = blockOf(text);
    expect(decodedName).toBe(name);
    expect(decodedBytes.equals(bytes)).toBe(true);
    expect(text).not.toContain(LAUNCH_SLOT);
    expect(taken.stdout).toContain(`Temporary copy: ${join(dir, "temp", taken.name)}`);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-06 ends with exit 0 and leaves no copy (KeepSeconds 0)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Temporary copy: .*grsmd-launch-[0-9a-f]{32}\.html\r?\nThe temporary copy is deleted in 0 s \(Ctrl\+C deletes it now\)\.$/);
    expect(result.stderr).toBe("");
    expect(copies(dir)).toEqual([]);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-07 deletes copies older than KeepSeconds before writing, and keeps newer ones (FR-L08, SC-L04)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    mkdirSync(join(dir, "temp"));
    const old = join(dir, "temp", "grsmd-launch-old.html");
    const recent = join(dir, "temp", "grsmd-launch-recent.html");
    const other = join(dir, "temp", "notes.html");
    for (const f of [old, recent, other]) writeFileSync(f, "x");
    const now = Date.now() / 1000;
    utimesSync(old, now - 120, now - 120);
    utimesSync(other, now - 120, now - 120);
    utimesSync(recent, now + 60, now + 60);
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "1"]);
    expect(result.status).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(copies(dir).sort()).toEqual(["grsmd-launch-recent.html", "notes.html"]);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-08 takes a relative path literally (brackets are not wildcards) (FR-L02)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a[1].md"), "# A\n");
    writeFileSync(join(dir, "a1.md"), "# wrong\n");
    const result = run(shell, dir, ["a[1].md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-09 accepts exactly 5,242,880 bytes and an empty file (FR-L04)", () => {
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
    ["the file is missing", (dir) => [["nope.md"], `Open-Grsmd: File not found: ${join(dir, "nope.md")}`]],
    ["the path is a folder", (dir) => (mkdirSync(join(dir, "sub")), [["sub"], `Open-Grsmd: Not a file: ${join(dir, "sub")}`])],
    [
      "the file has 5,242,881 bytes",
      (dir) => (writeFileSync(join(dir, "big.md"), Buffer.alloc(MAX_BYTES + 1, 0x41)), [["big.md"], `Open-Grsmd: The file is larger than 5 MB (5242881 bytes): ${join(dir, "big.md")}`]),
    ],
    [
      "-GrsmdPath names no file",
      (dir) => [["a.md", "-GrsmdPath", "none.html"], `Open-Grsmd: GRSMD.html not found: ${join(dir, "none.html")}. Put GRSMD.html next to this script or pass -GrsmdPath.`],
    ],
    [
      "GRSMD.html has no slot",
      (dir) => (writeFileSync(join(dir, "GRSMD.html"), GRSMD.replace(LAUNCH_SLOT, "")), [["a.md"], `Open-Grsmd: ${join(dir, "GRSMD.html")} has no launch slot. Use a newer GRSMD.html.`]),
    ],
    [
      "the slot is after </head>",
      (dir) => (
        writeFileSync(join(dir, "GRSMD.html"), GRSMD.replace(LAUNCH_SLOT, "").replace("<body>", `<body>${LAUNCH_SLOT}`)),
        [["a.md"], `Open-Grsmd: ${join(dir, "GRSMD.html")} has no launch slot. Use a newer GRSMD.html.`]
      ),
    ],
  ])("AT-LAUNCH-11 stops with exit 1 before writing anything when %s (FR-L03 to FR-L06, SC-L05)", (_label, arrange) => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const [args, message] = arrange(dir);
    const result = run(shell, dir, [...args, "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(message);
    expect(result.stdout).toBe("");
    expect(existsSync(join(dir, "temp"))).toBe(false);
  }, RUN_TIMEOUT);

  it("AT-LAUNCH-12 stops when GRSMD.html is not next to the script (FR-L05)", () => {
    const dir = setUp(null);
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-NoStart", "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Open-Grsmd: GRSMD.html not found: ${join(dir, "GRSMD.html")}. Put GRSMD.html next to this script or pass -GrsmdPath.`);
  }, RUN_TIMEOUT);

  const firefoxRegistered = ["HKCU", "HKLM"].some(
    (hive) => spawnSync("reg", ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe`], { stdio: "ignore" }).status === 0,
  );
  it.skipIf(firefoxRegistered)("AT-LAUNCH-13 stops when the chosen browser is not installed (FR-L09, FR-L13, SC-L06)", () => {
    const dir = setUp();
    writeFileSync(join(dir, "a.md"), "# A\n");
    const result = run(shell, dir, ["a.md", "-Browser", "Firefox", "-KeepSeconds", "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Open-Grsmd: Firefox was not found.");
    expect(existsSync(join(dir, "temp"))).toBe(false);
  }, RUN_TIMEOUT);
});
