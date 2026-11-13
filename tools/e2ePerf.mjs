// Spec: INV-86 (performance), PRT-AJ19 step 8.
// Why: one worker, no retry, GRSMD_PERF=1: other work on the machine stretches these times, so the whole e2e run skips them
// Why: on the P cores, because the limits are set for them: on the E cores alone WebKit takes 4.22 to 4.50 ms a key (spec 5.19.12)
import { spawnSync } from "node:child_process";
import { cpuSetsFromText, performanceCoreMask, pinningReport } from "./e2ePerfPinning.mjs";

// Why: GetSystemCpuSetInformation is the one Windows call that gives each logical processor's efficiency class
const READ_CPU_SETS_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CpuSets {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetSystemCpuSetInformation(IntPtr info, int length, out int returned, IntPtr process, int flags);
  public static void Print() {
    int length;
    GetSystemCpuSetInformation(IntPtr.Zero, 0, out length, IntPtr.Zero, 0);
    IntPtr info = Marshal.AllocHGlobal(length);
    GetSystemCpuSetInformation(info, length, out length, IntPtr.Zero, 0);
    for (int at = 0; at < length; at += Marshal.ReadInt32(info, at)) {
      if (Marshal.ReadInt16(info, at + 12) == 0) Console.WriteLine(Marshal.ReadByte(info, at + 14) + "," + Marshal.ReadByte(info, at + 18));
    }
    Marshal.FreeHGlobal(info);
  }
}
'@
[CpuSets]::Print()
`;

// Section: semi-pure-mutable

/**
 * @purity semi-pure-mutable
 * @returns {string} empty when the CPU sets cannot be read
 */
function readCpuSetsText() {
  if (process.platform !== "win32") return "";
  const encoded = Buffer.from(READ_CPU_SETS_SCRIPT, "utf16le").toString("base64");
  const { stdout } = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  return stdout ?? "";
}

// Section: non-pure

/**
 * Why: this process, not a "start /affinity" wrapper: the wrapper loses the tests' exit code, and a child takes its parent's affinity
 * @purity non-pure
 * @param {string} mask - performanceCoreMask
 * @returns {boolean} the affinity was set
 */
function pinThisProcess(mask) {
  const script = `$ErrorActionPreference = 'Stop'; (Get-Process -Id ${process.pid}).ProcessorAffinity = [IntPtr]0x${mask}`;
  return spawnSync("powershell", ["-NoProfile", "-Command", script]).status === 0;
}

/**
 * @purity non-pure
 * @returns {number} the exit code
 */
function runPerfTests() {
  const cpuSets = cpuSetsFromText(readCpuSetsText());
  const mask = performanceCoreMask(cpuSets);
  const isPinned = mask !== null && pinThisProcess(mask);
  console.log(pinningReport(mask, isPinned, cpuSets.length, process.platform));
  const cli = "node_modules/@playwright/test/cli.js";
  const testArguments = [cli, "test", "e2e/codeEditorTyping.e2e.js", "-g", "INV-86..performance", "--workers=1", "--retries=0"];
  const { status } = spawnSync(process.execPath, testArguments, { stdio: "inherit", env: { ...process.env, GRSMD_PERF: "1" } });
  return status ?? 1;
}

process.exit(runPerfTests());
