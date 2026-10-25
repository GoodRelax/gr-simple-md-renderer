import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import LibraryLoader, { LIBRARY_NAMES, DATA_ID_PREFIX } from "../js/classes/LibraryLoader.js";
import { LAZY_LIBRARIES, DATA_ID_PREFIX as BUILD_DATA_ID_PREFIX } from "../../tools/fastStartup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BOOT = readFileSync(resolve(here, "../js/boot.js"), "utf8");

/** jsdom has no User Timing marks: a list stands in (window.marks). */
function withMarks(window) {
  window.marks = [];
  window.performance.mark = (name) => window.marks.push(name);
}

/**
 * A page that runs its scripts, with the receiver in it, as the built file
 * has it before the core runs. Libraries come as data blocks added later.
 */
function page() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { runScripts: "dangerously" });
  withMarks(dom.window);
  dom.window.eval(BOOT);
  const { window } = dom;
  const idleTasks = [];
  const loader = new LibraryLoader(window.__grsmdBoot, window.document, { idle: (task) => idleTasks.push(task) });
  /** The data block of a library, then (by default) its arrival note. */
  const addData = (name, code = `__grsmdBoot.provide(${JSON.stringify(name)}, { name: ${JSON.stringify(name)}, runs: (window.runs = (window.runs || 0) + 1) });`, arrive = true) => {
    const data = window.document.createElement("script");
    data.type = "text/plain";
    data.id = `${DATA_ID_PREFIX}${name}`;
    data.textContent = code;
    window.document.body.append(data);
    if (arrive) window.__grsmdBoot.arrive(name);
  };
  const runIdle = () => {
    const task = idleTasks.shift();
    if (task) task();
    return task !== undefined;
  };
  return { window, loader, addData, runIdle, idleTasks };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LibraryLoader (INV-81 (2), spec 5.17.2)", () => {
  it("AT-FAST-01 the names and the data id are the build's (O2 order)", () => {
    expect(LIBRARY_NAMES).toEqual(LAZY_LIBRARIES.map((l) => l.name));
    expect(LIBRARY_NAMES).toEqual(["mermaid", "hljs", "katex", "plantuml"]);
    expect(DATA_ID_PREFIX).toBe(BUILD_DATA_ID_PREFIX);
  });

  it("AT-FAST-02 data that arrived first: loadIfArrived runs it at once, once; its data block and script leave", () => {
    const { window, loader, addData } = page();
    addData("hljs");
    expect(loader.isArrived("hljs")).toBe(true);
    expect(loader.peek("hljs")).toBeNull();
    const lib = loader.loadIfArrived("hljs");
    expect(lib).toEqual({ name: "hljs", runs: 1 });
    expect(loader.loadIfArrived("hljs")).toBe(lib);
    expect(window.runs).toBe(1);
    expect(window.document.getElementById(`${DATA_ID_PREFIX}hljs`)).toBeNull();
    expect(window.document.querySelectorAll("script")).toHaveLength(0);
  });

  it("AT-FAST-03 data not yet in: loadIfArrived is null and runs nothing; get() settles when it arrives", async () => {
    const { window, loader, addData } = page();
    expect(loader.loadIfArrived("katex")).toBeNull();
    const got = loader.get("katex");
    expect(loader.get("katex")).toBe(got); // the same promise
    // the data block is parsed but its arrival note has not run yet
    addData("katex", undefined, false);
    await flush();
    expect(window.runs).toBeUndefined();
    window.__grsmdBoot.arrive("katex");
    await expect(got).resolves.toEqual({ name: "katex", runs: 1 });
    await loader.get("katex");
    expect(window.runs).toBe(1);
  });

  it("AT-FAST-04 a library that does not hand itself over (blocked or failing): null, logged once, get() rejects", async () => {
    const { loader, addData } = page();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    addData("mermaid", "/* provides nothing */");
    expect(loader.loadIfArrived("mermaid")).toBeNull();
    expect(loader.loadIfArrived("mermaid")).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    await expect(loader.get("mermaid")).rejects.toThrow(/mermaid did not run/);
  });

  it("AT-FAST-05 an arrival without a data block fails the same way", async () => {
    const { window, loader } = page();
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.__grsmdBoot.arrive("plantuml");
    await expect(loader.get("plantuml")).rejects.toThrow(/no data block for plantuml/);
  });

  it("AT-FAST-06 a library the page provides (the dev server) is used as it is, with no data block", async () => {
    const { window, loader } = page();
    const lib = { dev: true };
    window.__grsmdBoot.provide("mermaid", lib);
    expect(loader.isArrived("mermaid")).toBe(true);
    expect(loader.peek("mermaid")).toBe(lib);
    await expect(loader.get("mermaid")).resolves.toBe(lib);
  });

  it("AT-FAST-07 preloadWhenIdle runs each library in its own idle time, in order, after it arrives (owner ruling 2026-10-25)", async () => {
    const { window, loader, addData, runIdle } = page();
    const loaded = [];
    loader.preloadWhenIdle((name, lib) => loaded.push([name, lib.runs]));
    loader.preloadWhenIdle(() => loaded.push("twice")); // started once only
    addData("mermaid");
    expect(window.runs).toBeUndefined(); // arriving runs nothing
    runIdle(); // the first step only asks for mermaid
    await flush();
    expect(window.runs).toBeUndefined();
    expect(runIdle()).toBe(true); // mermaid runs in an idle time of its own
    expect(loaded).toEqual([["mermaid", 1]]);
    await flush();
    // hljs is not in yet: nothing waits in the idle queue
    expect(runIdle()).toBe(false);
    addData("hljs");
    await flush();
    runIdle();
    expect(loaded.map((l) => l[0])).toEqual(["mermaid", "hljs"]);
    // katex ran meanwhile because a render needed it: not told again
    addData("katex");
    loader.loadIfArrived("katex");
    addData("plantuml");
    await flush();
    while (runIdle()) await flush();
    expect(loaded.map((l) => l[0])).toEqual(["mermaid", "hljs", "plantuml"]);
  });

  it("AT-FAST-08 preloadWhenIdle skips a library that failed and goes on", async () => {
    const { loader, addData, runIdle } = page();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = [];
    loader.preloadWhenIdle((name) => loaded.push(name));
    addData("mermaid", "/* nothing */");
    addData("hljs");
    addData("katex");
    addData("plantuml");
    await flush();
    while (runIdle()) await flush();
    expect(loaded).toEqual(["hljs", "katex", "plantuml"]);
  });
});

describe("boot.js, the receiver before the core (INV-81 (4))", () => {
  function receiver() {
    const dom = new JSDOM('<!doctype html><html><body><textarea id="editor"></textarea><input id="searchInput"></body></html>', { runScripts: "dangerously" });
    withMarks(dom.window);
    dom.window.eval(BOOT);
    return dom.window;
  }
  function drop(window, files, handle) {
    const event = new window.Event("drop", { bubbles: true, cancelable: true });
    const calls = [];
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files,
        items: files.map(() => ({
          getAsFileSystemHandle: () => {
            calls.push("handle");
            return Promise.resolve(handle);
          },
        })),
      },
    });
    window.document.dispatchEvent(event);
    return { event, calls };
  }
  function paste(window, target, text) {
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    target.dispatchEvent(event);
    return event;
  }

  it("AT-FAST-09 a drop never opens the file; the last file is kept with its handle asked for inside the event (CON-01)", async () => {
    const window = receiver();
    const over = new window.Event("dragover", { bubbles: true, cancelable: true });
    window.document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const first = drop(window, [{ name: "a.md" }], null);
    const second = drop(window, [{ name: "b.md" }], "handle-b");
    expect(first.event.defaultPrevented && second.event.defaultPrevented).toBe(true);
    expect(second.calls).toEqual(["handle"]);
    const early = window.__grsmdBoot.takeEarlyInput();
    expect(early.kind).toBe("drop");
    expect(early.file.name).toBe("b.md");
    await expect(early.handlePromise).resolves.toBe("handle-b");
  });

  it("AT-FAST-10 a drop with no file (text) is stopped and not kept", () => {
    const window = receiver();
    const { event } = drop(window, [], null);
    expect(event.defaultPrevented).toBe(true);
    expect(window.__grsmdBoot.takeEarlyInput()).toBeNull();
  });

  it("AT-FAST-11 a paste into the empty editor (or the page) is kept; into a filled editor or another field it is left alone", () => {
    const window = receiver();
    const editor = window.document.getElementById("editor");
    const other = window.document.getElementById("searchInput");
    expect(paste(window, other, "query").defaultPrevented).toBe(false);
    expect(paste(window, window.document.body, "  ").defaultPrevented).toBe(false);
    expect(paste(window, editor, "# Pasted").defaultPrevented).toBe(true);
    expect(window.__grsmdBoot.takeEarlyInput()).toEqual({ kind: "paste", text: "# Pasted" });
    const window2 = receiver();
    window2.document.getElementById("editor").value = "typed";
    expect(paste(window2, window2.document.body, "x").defaultPrevented).toBe(false);
    expect(window2.__grsmdBoot.takeEarlyInput()).toBeNull();
  });

  it("AT-FAST-12 takeEarlyInput hands over once and removes the listeners (the core handles what comes after)", () => {
    const window = receiver();
    drop(window, [{ name: "a.md" }], null);
    expect(window.__grsmdBoot.takeEarlyInput().file.name).toBe("a.md");
    expect(window.__grsmdBoot.takeEarlyInput()).toBeNull();
    const { event } = drop(window, [{ name: "c.md" }], null);
    expect(event.defaultPrevented).toBe(false);
    expect(window.__grsmdBoot.takeEarlyInput()).toBeNull();
  });

  it("AT-FAST-13 arrive() records the arrival, marks it, and tells the loader; provide() keeps the library", () => {
    const window = receiver();
    const boot = window.__grsmdBoot;
    const told = [];
    boot.onArrive = (name) => told.push(name);
    boot.arrive("hljs");
    boot.provide("hljs", { x: 1 });
    expect([...boot.arrived]).toEqual(["hljs"]);
    expect(told).toEqual(["hljs"]);
    expect(boot.provided.get("hljs")).toEqual({ x: 1 });
    expect(window.marks).toEqual(["grsmd-arrived-hljs"]);
  });
});
