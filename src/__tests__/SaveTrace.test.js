import { describe, it, expect, vi, afterEach } from "vitest";
import SaveTrace, { browserOf, buildDateOf, typeOf, cleanMessage } from "../js/classes/SaveTrace.js";

// AT-STR: the save log (INV-109). MarkdownFileAccess writes the lines
// (AT-FA-12..16); these tests pin the line itself.

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function env(over = {}) {
  const state = { t: 50, lines: [] };
  return {
    state,
    value: {
      now: () => state.t,
      log: (line) => state.lines.push(line),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.58",
      buildDate: "2026-11-01",
      ...over,
    },
  };
}

describe("AT-STR SaveTrace (INV-109)", () => {
  it("AT-STR-01 (INV-109 (2)) the line of the R5 example, ok lines, and the permission state", () => {
    const { state, value } = env();
    const trace = new SaveTrace({ id: true, startIn: false, type: ".md" }, value);
    state.t = 462.4;
    trace.fail("picker", new DOMException("The user aborted a request.", "AbortError"));
    trace.ok("write");
    trace.permission("granted");
    trace.permission("denied");
    trace.permission(undefined);
    expect(state.lines).toEqual([
      'GRSMD save: picker fail AbortError "The user aborted a request." 412 ms id=yes startIn=no type=.md Edg/156.0.4314.58 build=2026-11-01',
      "GRSMD save: write ok 412 ms id=yes startIn=no type=.md Edg/156.0.4314.58 build=2026-11-01",
      "GRSMD save: permission ok 412 ms id=yes startIn=no type=.md Edg/156.0.4314.58 build=2026-11-01",
      "GRSMD save: permission fail state=denied 412 ms id=yes startIn=no type=.md Edg/156.0.4314.58 build=2026-11-01",
      "GRSMD save: permission fail state=undefined 412 ms id=yes startIn=no type=.md Edg/156.0.4314.58 build=2026-11-01",
    ]);
  });

  it("AT-STR-02 (INV-109 (3)) no save dialog: id and startIn are -; an error without a name or message", () => {
    const { state, value } = env();
    const trace = new SaveTrace({ id: null, startIn: null, type: "none" }, value);
    trace.fail("close", null);
    trace.fail("write", { name: "Bad Name!", message: undefined });
    expect(state.lines).toEqual([
      'GRSMD save: close fail Error "" 0 ms id=- startIn=- type=none Edg/156.0.4314.58 build=2026-11-01',
      'GRSMD save: write fail BadName "" 0 ms id=- startIn=- type=none Edg/156.0.4314.58 build=2026-11-01',
    ]);
  });

  it("AT-STR-03 (INV-109 (3)) the browser and its version from the user agent", () => {
    const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
    expect(browserOf(`${win} Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.58`)).toBe("Edg/156.0.4314.58");
    expect(browserOf(`${win} Chrome/156.0.7000.1 Safari/537.36`)).toBe("Chrome/156.0.7000.1");
    expect(browserOf(`${win} Chrome/150.0.0.0 Safari/537.36 OPR/120.0.0.0`)).toBe("OPR/120.0.0.0");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox/140.0");
    expect(browserOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15")).toBe("Safari/19.0");
    expect(browserOf("Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1")).toBe("CriOS/156.0.0.0");
    expect(browserOf("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36 EdgA/156.0.0.0")).toBe("EdgA/156.0.0.0");
    expect(browserOf("")).toBe("unknown");
    expect(browserOf(undefined)).toBe("unknown");
  });

  it("AT-STR-04 (INV-109 (3)) the build date is the help's version date; unknown without it", () => {
    expect(buildDateOf(document)).toBe("unknown");
    document.body.innerHTML = '<p data-build-version><time datetime="2026-11-01T02:30:00Z">2026-11-01T02:30:00Z</time></p>';
    expect(buildDateOf(document)).toBe("2026-11-01");
    document.body.innerHTML = '<p data-build-version><time></time></p>';
    expect(buildDateOf(document)).toBe("unknown");
    expect(buildDateOf(undefined)).toBe("unknown");
  });

  it("AT-STR-05 (INV-109 (3)) the file type is an extension only: the first a save dialog offers, or a name's", () => {
    expect(typeOf([{ description: "Markdown", accept: { "text/markdown": [".md"] } }])).toBe(".md");
    expect(typeOf([{ description: "PY file", accept: { "text/plain": [".PY"] } }])).toBe(".py");
    expect(typeOf([])).toBe("none");
    expect(typeOf(undefined)).toBe("none");
    expect(typeOf("my notes.md")).toBe(".md");
    expect(typeOf("Makefile")).toBe("none");
    expect(typeOf("")).toBe("none");
  });

  it("AT-STR-06 (INV-109 (4)) a message keeps no file name or path, and is ASCII with apostrophes for quotes, at most 200 characters", () => {
    expect(cleanMessage("Could not write notes.md", ["notes.md"])).toBe("Could not write <name>");
    // any path character left: the whole message is hidden (review 1, finding 2)
    for (const withPath of [
      "at C:\\Users\\me\\a.md now",
      "at C:\\Users\\Taro Yamada\\OneDrive - Contoso\\x.md now",
      "at \\\\server\\share name\\a.md",
      "see file:///C:/x/a.md",
      "in /home/me/a.md",
      "in '/Users/me/a.md'",
      "in \"/Users/me/my notes.md\"",
      "in (/home/me/a.md)",
      "in Documents\\private\\a.md",
      "in Documents/private/a.md",
      "in ~/a.md",
      "read/write", // no path, hidden all the same: the safe side
    ]) {
      expect(cleanMessage(withPath), withPath).toBe("<hidden>");
    }
    expect(cleanMessage("C:\\Users\\me\\a.md", ["a.md"])).toBe("<hidden>");
    expect(cleanMessage('say "no"\nnow')).toBe("say 'no' now");
    expect(cleanMessage("\u3042 \u{1F600}")).toBe("\\u3042 \\ud83d\\ude00");
    expect(cleanMessage("x".repeat(250))).toBe(`${"x".repeat(200)}...`);
    expect(cleanMessage(undefined)).toBe("");
  });

  it("AT-STR-07 (INV-109 (4)) the chosen file's name, added later, is kept out too; the line is ASCII", () => {
    const { state, value } = env({ userAgent: "" });
    const trace = new SaveTrace({ id: true, startIn: true, type: ".md", names: ["untitled.md", ""] }, value);
    trace.addName("plan.md");
    trace.addName(undefined);
    trace.fail("close", new DOMException("plan.md and untitled.md: \u3042", "InvalidStateError"));
    expect(state.lines).toEqual([
      'GRSMD save: close fail InvalidStateError "<name> and <name>: \\u3042" 0 ms id=yes startIn=yes type=.md unknown build=2026-11-01',
    ]);
    expect(state.lines[0]).toMatch(/^[\x20-\x7e]+$/);
  });

  it("AT-STR-09 (INV-109 (6)) a line that cannot be made or written is dropped: no step throws; the silent trace writes nothing", () => {
    const throwing = { now: () => 0, log: () => { throw new Error("console replaced"); }, userAgent: "", buildDate: "x" };
    const trace = new SaveTrace({ id: true, startIn: false, type: ".md" }, throwing);
    expect(() => trace.ok("close")).not.toThrow();
    expect(() => trace.fail("picker", new Error("e"))).not.toThrow();
    expect(() => trace.permission("denied")).not.toThrow();
    let reads = 0;
    const clockFailsLater = { ...throwing, log: () => {}, now: () => { if (reads++ > 0) throw new Error("clock"); return 0; } };
    expect(() => new SaveTrace({ id: true, startIn: false, type: ".md" }, clockFailsLater).ok("write")).not.toThrow();
    const errorWithBadMessage = { name: "AbortError", get message() { throw new Error("getter"); } };
    expect(() => trace.fail("picker", errorWithBadMessage)).not.toThrow();
    const silent = SaveTrace.silent();
    expect(() => [silent.addName("a.md"), silent.ok("x"), silent.fail("x", null), silent.permission("granted")]).not.toThrow();
  });

  it("AT-STR-08 (INV-109 (5)) the default environment writes with console.info only", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const environment = SaveTrace.environment();
    expect(typeof environment.now()).toBe("number");
    environment.log("GRSMD save: x");
    expect(info).toHaveBeenCalledWith("GRSMD save: x");
    expect(log).not.toHaveBeenCalled();
    expect(environment.buildDate).toBe("unknown");
  });
});
