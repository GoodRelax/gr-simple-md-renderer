import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpuSetsFromText, performanceCoreMask, pinningReport } from "../../tools/e2ePerfPinning.mjs";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "../../tools");

// Spec: INV-86 (performance)
describe("AT-E2EP (INV-86 (performance)) tools/e2ePerf.mjs: the key times run on the P cores", () => {
  const hybrid = [
    { index: 0, efficiencyClass: 1 },
    { index: 1, efficiencyClass: 1 },
    { index: 2, efficiencyClass: 0 },
  ];

  it("01 reads each logical processor and its efficiency class, and skips other lines", () => {
    // Spec: INV-86 (performance)
    expect(cpuSetsFromText("0,1\r\n12,0\r\nnoise\r\n")).toEqual([
      { index: 0, efficiencyClass: 1 },
      { index: 12, efficiencyClass: 0 },
    ]);
  });

  it("02 the mask holds the most performant class only", () => {
    // Spec: INV-86 (performance)
    expect(performanceCoreMask(hybrid)).toBe("3");
    expect(performanceCoreMask(Array.from({ length: 16 }, (_, index) => ({ index, efficiencyClass: index < 12 ? 1 : 0 })))).toBe("FFF");
  });

  it("03 a machine with one kind of core, or none read, gets no mask", () => {
    // Spec: INV-86 (performance)
    expect(performanceCoreMask([{ index: 0, efficiencyClass: 0 }])).toBeNull();
    expect(performanceCoreMask([])).toBeNull();
  });

  it.each([
    ["FFF", true, 16, "win32", "e2ePerf: pinned to the P cores (affinity FFF)"],
    ["FFF", false, 16, "win32", "e2ePerf: not pinned: the affinity FFF could not be set"],
    [null, false, 8, "win32", "e2ePerf: not pinned: this machine has one kind of core"],
    [null, false, 0, "win32", "e2ePerf: not pinned: the CPU sets could not be read"],
    [null, false, 0, "linux", "e2ePerf: not pinned: no way to pin on linux"],
  ])("04 the output says whether the run is pinned: %s, %s, %i, %s", (mask, isPinned, count, platform, line) => {
    // Spec: INV-86 (performance)
    expect(pinningReport(mask, isPinned, count, platform)).toBe(line);
  });

  it.each(["the real path", "a junction"])(
    "05 the tool run through %s runs the key-time tests with GRSMD_PERF=1 and returns their exit code",
    (kind) => {
      // Spec: INV-86 (performance)
      // Why: a fake Playwright that fails: the test runs the tool's entry and never the key times
      const place = mkdtempSync(join(tmpdir(), "e2eperf-"));
      try {
        const cli = join(place, "node_modules/@playwright/test");
        mkdirSync(cli, { recursive: true });
        writeFileSync(join(cli, "cli.js"), 'console.log("FAKE " + JSON.stringify({ args: process.argv.slice(2), perf: process.env.GRSMD_PERF })); process.exit(7);');
        const tools = join(place, "tools-link");
        if (kind === "a junction") symlinkSync(TOOLS, tools, "junction");
        const script = join(kind === "a junction" ? tools : TOOLS, "e2ePerf.mjs");
        // Why: with no GRSMD_PERF the tests skip and exit 0, so the variable must come from the tool, not from this run
        const { status, stdout } = spawnSync(process.execPath, [script], { cwd: place, encoding: "utf8", env: { ...process.env, GRSMD_PERF: undefined } });
        expect(status).toBe(7);
        expect(stdout).toMatch(/^e2ePerf: /);
        expect(JSON.parse(stdout.match(/^FAKE (.*)$/m)[1])).toEqual({
          args: ["test", "e2e/codeEditorTyping.e2e.js", "-g", "INV-86..performance", "--workers=1", "--retries=0"],
          perf: "1",
        });
      } finally {
        rmSync(place, { recursive: true, force: true });
      }
    },
    60000,
  );
});
