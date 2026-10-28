import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { installBoot } from "../js/boot.js";
import LibraryLoader, {
  libraryStateMachine,
  pageStartupStateMachine,
  LIBRARY_STATES,
  PAGE_STARTUP_STATES,
} from "../js/classes/LibraryLoader.js";
import { LIBRARY_NAMES } from "../js/libraryNames.js";
import { fakeBoot } from "./helpers/fakeBoot.js";
import { diagramTransitions, tableTransitions } from "./helpers/specDiagram.js";

// Spec 3.3 11-g (owner rulings AQ2, AQ7): every cell of the library table
// (6 events x 4 states, with the guard's two branches) and of the page
// table (6 events x 4 states, with the two guards' branches), reached
// through dispatch() / dispatchPage() (the earlyInputArrived row through
// the receiver, installBoot, which does it). Each cell is checked twice: the
// transition taken (from, to, the actions run in order) and what each
// action does (the host's calls, the idle turn, get()'s promise, the log,
// the data block, the page's next event). The first states (3 branches)
// and the spec's diagrams are checked too (G9).

const LIB = "katex";
const STEP = { step: "partial" };

/** The spec table 11-g (1), written out again: [to, actions] or null ("-"). */
const LIBRARY_TABLE = {
  dataArrived: {
    notArrived: { shown: ["arrived", ["runLibrary"]], notShown: ["arrived", ["requestIdleTurn"]] },
    arrived: null,
    ready: null,
    failed: null,
  },
  needed: {
    notArrived: null,
    arrived: ["arrived", ["runLibrary"]],
    ready: ["ready", ["handToRenderers", "redrawShownWithout"]],
    failed: ["failed", ["showFailure"]],
  },
  idleTurn: { notArrived: null, arrived: ["arrived", ["runLibrary"]], ready: null, failed: null },
  libraryRan: {
    notArrived: null,
    arrived: ["ready", ["handToRenderers", "redrawShownWithout", "settleWaiters", "requestIdleTurn", "checkSettled"]],
    ready: null,
    failed: null,
  },
  libraryRunFailed: {
    notArrived: null,
    arrived: ["failed", ["logRunError", "showFailure", "settleWaiters", "requestIdleTurn", "checkSettled"]],
    ready: null,
    failed: null,
  },
  parsingEnded: {
    notArrived: ["failed", ["logNotArrived", "showFailure", "settleWaiters", "checkSettled"]],
    arrived: null,
    ready: null,
    failed: null,
  },
};

const CORE = ["takeEarlyInput", "receiveEarlyInput", "requestIdleTurn"];
/**
 * The spec table 11-g (2), written out again: [to, actions], null ("-"), or
 * the branches of a guard: {label: [[to, actions], test options]}.
 */
const PAGE_TABLE = {
  earlyInputArrived: { receiving: ["receiving", ["keepLastInput"]], loading: null, answering: null, settled: null },
  coreStarted: {
    receiving: {
      areLibrariesSettled: [["settled", CORE], { libsFinal: true }],
      else: [["loading", CORE], { libsFinal: false }],
    },
    loading: null,
    answering: null,
    settled: null,
  },
  librariesSettled: { receiving: null, loading: ["answering", ["runWaitingPlantUml"]], answering: null, settled: null },
  plantUmlStepReached: {
    receiving: null,
    loading: ["loading", ["holdPlantUml"]],
    answering: {
      isConsentStep: [["answering", ["holdPlantUml"]], { mode: "consent" }],
      else: [["answering", ["runPlantUmlStep"]], { mode: "placeholder" }],
    },
    settled: ["settled", ["runPlantUmlStep"]],
  },
  waitingPlantUmlAnswered: { receiving: null, loading: null, answering: ["settled", []], settled: null },
  blockReleased: { receiving: null, loading: null, answering: null, settled: ["settled", ["turnHeldPlantUmlToRender"]] },
};

const LIB_OBJECT = { name: LIB };

/**
 * A loader with katex in `state`, the other libraries ready (othersFinal)
 * or notArrived, the page in `page`, a host made of spies, idle turns kept
 * in a list, and a trace of every step: {machine, event, from, to, actions}.
 */
function loaderIn(state, { shown = false, othersFinal = true, page = "loading", libsFinal } = {}) {
  const doc = document.implementation.createHTMLDocument("");
  const boot = fakeBoot();
  const idle = [];
  const loader = new LibraryLoader(boot, doc, { idle: (task) => idle.push(task) });
  const host = {
    isShownWithout: vi.fn(() => shown),
    handToRenderers: vi.fn(),
    redrawShownWithout: vi.fn(),
    showFailure: vi.fn(),
    holdPlantUml: vi.fn(),
    runPlantUmlStep: vi.fn(),
    runWaitingPlantUml: vi.fn(),
    turnHeldPlantUmlToRender: vi.fn(),
  };
  loader.connect(host);
  for (const name of LIBRARY_NAMES) {
    if (name !== LIB) loader._libraryStates.set(name, (libsFinal ?? othersFinal) ? "ready" : "notArrived");
  }
  loader._libraryStates.set(LIB, libsFinal === undefined ? state : libsFinal ? "ready" : "notArrived");
  if (state === "arrived" || state === "ready") boot.provided.set(LIB, LIB_OBJECT);
  if (state === "arrived") {
    const data = doc.createElement("script");
    data.type = "text/plain";
    doc.body.append(data);
    boot.data.set(LIB, data);
  }
  loader._pageStartupState = page;
  const trace = [];
  const libraryStep = loader._libraryStep.bind(loader);
  const pageStep = loader._pageStep.bind(loader);
  const libraryAction = loader._runLibraryAction.bind(loader);
  const pageAction = loader._runPageAction.bind(loader);
  vi.spyOn(loader, "_libraryStep").mockImplementation((name, event, ...rest) => {
    const record = { machine: "library", name, event, from: loader.libraryState(name), actions: [] };
    trace.push(record);
    libraryStep(name, event, ...rest);
    record.to = loader.libraryState(name);
  });
  vi.spyOn(loader, "_pageStep").mockImplementation((event, ...rest) => {
    const record = { machine: "page", event, from: loader.pageStartupState, actions: [] };
    trace.push(record);
    pageStep(event, ...rest);
    record.to = loader.pageStartupState;
  });
  vi.spyOn(loader, "_runLibraryAction").mockImplementation((action, ...rest) => {
    trace.at(-1).actions.push(action);
    return libraryAction(action, ...rest);
  });
  vi.spyOn(loader, "_runPageAction").mockImplementation((action, ...rest) => {
    trace.at(-1).actions.push(action);
    return pageAction(action, ...rest);
  });
  return { loader, boot, host, idle, trace };
}

/** What each library action does, seen from outside the table. */
async function checkLibraryAction(action, { loader, boot, host, idle, trace, errors, waiter }) {
  switch (action) {
    case "runLibrary":
      expect(boot.data.has(LIB)).toBe(false); // the block ran and left
      expect(trace[1]).toMatchObject({ machine: "library", event: "libraryRan" }); // after the step, not nested
      break;
    case "requestIdleTurn":
      expect(idle.length).toBe(1); // one reservation
      break;
    case "handToRenderers":
      expect(host.handToRenderers).toHaveBeenCalledWith(LIB, LIB_OBJECT);
      break;
    case "redrawShownWithout":
      expect(host.redrawShownWithout).toHaveBeenCalledWith(LIB, "partial");
      break;
    case "showFailure":
      expect(host.showFailure).toHaveBeenCalledWith(LIB);
      break;
    case "settleWaiters":
      if (loader.libraryState(LIB) === "ready") await expect(waiter).resolves.toBe(LIB_OBJECT);
      else await expect(waiter).rejects.toThrow(/katex could not run/);
      break;
    case "checkSettled":
      // the other three are ready: the page goes on to answering (the held PlantUML boxes)
      expect(trace.some((t) => t.machine === "page" && t.event === "librariesSettled")).toBe(true);
      expect(loader.pageStartupState).toBe("answering");
      expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
      break;
    case "logRunError":
    case "logNotArrived":
      expect(errors).toHaveBeenCalledTimes(1);
      break;
    default:
      throw new Error(`no check for ${action}`);
  }
}

const libraryCells = [];
for (const [event, byState] of Object.entries(LIBRARY_TABLE)) {
  for (const state of LIBRARY_STATES) {
    const entry = byState[state];
    if (entry && !Array.isArray(entry)) {
      libraryCells.push([event, state, "isShownWithout", entry.shown, { shown: true }]);
      libraryCells.push([event, state, "else", entry.notShown, { shown: false }]);
    } else {
      libraryCells.push([event, state, "", entry, {}]);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AT-LSM library state machine (spec 11-g (1), INV-81 (2), owner ruling AQ2)", () => {
  it("AT-LSM-01 (INV-81) the table has 6 events x 4 states: 24 cells, 25 with the guard's two branches", () => {
    expect(Object.keys(libraryStateMachine)).toEqual(Object.keys(LIBRARY_TABLE));
    for (const byState of Object.values(libraryStateMachine)) expect(Object.keys(byState)).toEqual(LIBRARY_STATES);
    expect(libraryCells).toHaveLength(25);
  });

  it.each(libraryCells)("AT-LSM-02 (INV-81) %s in %s %s: the cell of the spec table and what its actions do", async (event, state, _guard, expected, options) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // libraryRunFailed's input carries the error; libraryRan's the library
    const input = event === "libraryRunFailed" ? { ...STEP, error: new Error("blocked") } : event === "libraryRan" ? { ...STEP, library: LIB_OBJECT } : STEP;
    // for libraryRunFailed / parsingEnded the library does not hand itself over
    const ctx = loaderIn(state, options);
    if (event === "libraryRunFailed") ctx.boot.provided.delete(LIB);
    if (event === "libraryRan" && state === "arrived") ctx.boot.data.delete(LIB);
    if (event === "dataArrived" && state === "notArrived") {
      ctx.boot.data.set(LIB, document.createElement("script")); // the block is in when its note runs
      ctx.boot.provided.set(LIB, LIB_OBJECT);
    }
    const waiter = ctx.loader._waiter(LIB).promise;
    waiter.catch(() => {});
    ctx.loader.dispatch(LIB, event, input);
    const first = ctx.trace[0];
    if (!expected) {
      expect(first).toMatchObject({ event, from: state, to: state, actions: [] });
      expect(ctx.trace).toHaveLength(1);
      expect(ctx.idle).toHaveLength(0);
      for (const spy of Object.values(ctx.host)) if (spy !== ctx.host.isShownWithout) expect(spy).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      return;
    }
    const [to, actions] = expected;
    expect(first).toEqual({ machine: "library", name: LIB, event, from: state, to, actions });
    for (const action of actions) await checkLibraryAction(action, { ...ctx, errors, waiter });
  });

  it("AT-LSM-03 (INV-81) checkSettled does not settle the page while another library is still on its way; the page's answering is entered once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loader, host, trace } = loaderIn("notArrived", { othersFinal: false });
    loader.dispatch(LIB, "parsingEnded");
    expect(trace.map((t) => t.event)).toEqual(["parsingEnded"]);
    expect(loader.pageStartupState).toBe("loading");
    for (const name of LIBRARY_NAMES.filter((n) => n !== LIB)) loader.dispatch(name, "parsingEnded");
    expect(loader.pageStartupState).toBe("answering");
    expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(4);
  });

  it("AT-LSM-04 (INV-81) the first state, tried in order: provided -> ready, arrived before the loader -> arrived, else notArrived", () => {
    const doc = document.implementation.createHTMLDocument("");
    const boot = fakeBoot({ provided: { mermaid: { dev: true } } });
    boot.arrived.add("mermaid"); // provided wins
    boot.arrived.add("hljs");
    const loader = new LibraryLoader(boot, doc, { idle: () => {} });
    expect(loader.libraryState("mermaid")).toBe("ready");
    expect(loader.libraryState("hljs")).toBe("arrived");
    expect(loader.libraryState("katex")).toBe("notArrived");
    expect(loader.libraryState("plantuml")).toBe("notArrived");
    expect(loader.pageStartupState).toBe("receiving");
    expect(loader.peek("mermaid")).toEqual({ dev: true });
    expect(loader.isArrived("hljs")).toBe(true);
    expect(loader.peek("hljs")).toBeNull();
  });

  it("AT-LSM-05 (INV-81) the spec's library diagram shows every transition of the code's table (11-b)", () => {
    expect(diagramTransitions("11-g", 0)).toEqual(tableTransitions(libraryStateMachine));
  });
});

/** What each page action does, seen from outside the table. */
function checkPageAction(action, { loader, boot, host, idle, input, early }) {
  switch (action) {
    case "takeEarlyInput":
      expect(boot.takeEarlyInput).toHaveBeenCalledTimes(1);
      expect(boot.early).toBeNull();
      break;
    case "receiveEarlyInput":
      expect(input.receiveEarlyInput).toHaveBeenCalledWith(early);
      break;
    case "requestIdleTurn":
      expect(idle).toHaveLength(1);
      break;
    case "runWaitingPlantUml":
      expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
      break;
    case "holdPlantUml":
      expect(host.holdPlantUml).toHaveBeenCalledWith(input);
      expect(host.runPlantUmlStep).not.toHaveBeenCalled();
      break;
    case "runPlantUmlStep":
      expect(host.runPlantUmlStep).toHaveBeenCalledWith(input);
      expect(host.holdPlantUml).not.toHaveBeenCalled();
      break;
    case "turnHeldPlantUmlToRender":
      expect(host.turnHeldPlantUmlToRender).toHaveBeenCalledTimes(1);
      break;
    default:
      throw new Error(`no check for ${action}`);
  }
  void loader;
}

const pageCells = [];
for (const [event, byState] of Object.entries(PAGE_TABLE)) {
  if (event === "earlyInputArrived") continue; // the receiver's row: AT-LSM-07 (receiver) below
  for (const state of PAGE_STARTUP_STATES) {
    const entry = byState[state];
    if (entry && !Array.isArray(entry)) {
      for (const [guard, [expected, options]] of Object.entries(entry)) pageCells.push([event, state, guard, expected, options]);
    } else {
      pageCells.push([event, state, "", entry, {}]);
    }
  }
}

describe("AT-LSM page startup state machine (spec 11-g (2), INV-81 (3) (4), INV-02, owner rulings AQ2, AQ7)", () => {
  it("AT-LSM-06 (INV-81) the table has 6 events x 4 states: 24 cells, 26 with the two guards' branches", () => {
    expect(Object.keys(pageStartupStateMachine)).toEqual(Object.keys(PAGE_TABLE));
    for (const byState of Object.values(pageStartupStateMachine)) expect(Object.keys(byState)).toEqual(PAGE_STARTUP_STATES);
    expect(pageCells.length + PAGE_STARTUP_STATES.length).toBe(26); // + the receiver's row
  });

  it.each(pageCells)("AT-LSM-07 (INV-81) %s in %s %s: the cell of the spec table and what its actions do (INV-02: no PlantUML step before the libraries are settled; one batch while answering)", (event, state, _guard, expected, options) => {
    const ctx = loaderIn("notArrived", { page: state, libsFinal: options.libsFinal ?? false });
    const early = { kind: "paste", text: "# Early" };
    ctx.boot.early = early;
    const input =
      event === "coreStarted"
        ? { receiveEarlyInput: vi.fn() }
        : event === "plantUmlStepReached"
          ? { theme: "light", root: document.createElement("div"), mode: options.mode ?? "consent", keepRender: null }
          : {};
    ctx.loader.dispatchPage(event, input);
    const first = ctx.trace[0];
    if (!expected) {
      expect(first).toMatchObject({ event, from: state, to: state, actions: [] });
      for (const spy of Object.values(ctx.host)) if (spy !== ctx.host.isShownWithout) expect(spy).not.toHaveBeenCalled();
      expect(ctx.boot.takeEarlyInput).not.toHaveBeenCalled();
      expect(ctx.idle).toHaveLength(0);
      return;
    }
    const [to, actions] = expected;
    expect(first).toEqual({ machine: "page", event, from: state, to, actions });
    for (const action of actions) checkPageAction(action, { ...ctx, input, early });
  });

  // the receiver's row (11-g (2)): boot.js keeps the last early input
  // until the core takes it at coreStarted; after that it keeps nothing
  it.each(PAGE_STARTUP_STATES)("AT-LSM-07 (INV-81 (4)) earlyInputArrived in %s: the receiver (installBoot) does the cell of the spec table", (state) => {
    const { window } = new JSDOM('<!doctype html><html><body><textarea id="editor"></textarea></body></html>');
    installBoot(window);
    const boot = window.__grsmdBoot;
    const paste = (text) => {
      const event = new window.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      window.document.body.dispatchEvent(event);
    };
    const loader = new LibraryLoader(boot, document.implementation.createHTMLDocument(""), { idle: () => {} });
    loader.connect({ runWaitingPlantUml: vi.fn() });
    if (state !== "receiving") {
      loader.dispatchPage("coreStarted", {});
      loader._pageStartupState = state;
    }
    paste("# First");
    paste("# Last");
    if (state === "receiving") {
      expect(PAGE_TABLE.earlyInputArrived.receiving).toEqual(["receiving", ["keepLastInput"]]);
      expect(boot.early).toEqual({ kind: "paste", text: "# Last" }); // keepLastInput: the last one only
    } else {
      expect(PAGE_TABLE.earlyInputArrived[state]).toBeNull();
      expect(boot.early).toBeNull(); // the receiver's listeners went at coreStarted
    }
    expect(loader.pageStartupState).toBe(state);
  });

  it("AT-LSM-22 (INV-81 (4), review L5) the core never handles earlyInputArrived: dispatchPage refuses it and changes nothing", () => {
    const { loader, boot, trace } = loaderIn("notArrived", { page: "receiving" });
    expect(() => loader.dispatchPage("earlyInputArrived", { early: { kind: "paste", text: "x" } })).toThrow(/receiver/);
    expect(boot.early).toBeNull();
    expect(trace[0].actions).toEqual([]);
    expect(loader.pageStartupState).toBe("receiving");
  });

  it("AT-LSM-08 (INV-81) the spec's page diagram shows every transition of the code's table (11-b)", () => {
    expect(diagramTransitions("11-g", 1)).toEqual(tableTransitions(pageStartupStateMachine));
  });

  it("AT-LSM-09 (INV-81) a whole start: loading until the last library is ready, then answering (runWaitingPlantUml once) and settled; idle turns one at a time in O2 order (INV-81 (2))", async () => {
    const doc = document.implementation.createHTMLDocument("");
    const boot = fakeBoot();
    const idle = [];
    const loader = new LibraryLoader(boot, doc, { idle: (task) => idle.push(task) });
    const host = { isShownWithout: () => false, handToRenderers: vi.fn(), redrawShownWithout: vi.fn(), showFailure: vi.fn(), holdPlantUml: vi.fn(), runPlantUmlStep: vi.fn(), runWaitingPlantUml: vi.fn(), turnHeldPlantUmlToRender: vi.fn() };
    loader.connect(host);
    loader.dispatchPage("coreStarted", {});
    expect(loader.pageStartupState).toBe("loading");
    const { arriveData } = await import("./helpers/fakeBoot.js");
    for (const name of LIBRARY_NAMES) arriveData(boot, name, { name });
    // the coreStarted reservation is still the only one
    expect(idle).toHaveLength(1);
    const ran = [];
    while (idle.length > 0) {
      idle.shift()();
      ran.push(LIBRARY_NAMES.filter((n) => loader.libraryState(n) === "ready").length);
    }
    expect(ran).toEqual([1, 2, 3, 4, 4]); // the last turn finds no arrived library and sends nothing
    expect(host.handToRenderers.mock.calls.map((c) => c[0])).toEqual(LIBRARY_NAMES);
    expect(loader.pageStartupState).toBe("answering");
    expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
    loader.dispatchPage("waitingPlantUmlAnswered"); // the host dealt with the held boxes
    expect(loader.isSettled()).toBe(true);
    // a DOMContentLoaded after that changes nothing (failed / ready are final)
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    expect(LIBRARY_NAMES.map((n) => loader.libraryState(n))).toEqual(["ready", "ready", "ready", "ready"]);
    expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
  });

  it("AT-LSM-10 (INV-81) the dev server: every library provided, coreStarted goes straight to settled (no runWaitingPlantUml)", () => {
    const doc = document.implementation.createHTMLDocument("");
    const provided = Object.fromEntries(LIBRARY_NAMES.map((n) => [n, { n }]));
    const loader = new LibraryLoader(fakeBoot({ provided }), doc, { idle: () => {} });
    const host = { runWaitingPlantUml: vi.fn() };
    loader.connect(host);
    loader.dispatchPage("coreStarted", {});
    expect(loader.isSettled()).toBe(true);
    expect(host.runWaitingPlantUml).not.toHaveBeenCalled();
  });

  it("AT-LSM-11 (INV-81) DOMContentLoaded sends parsingEnded: a library that never arrived fails (logged), its get() rejects, the page settles", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = document.implementation.createHTMLDocument("");
    const boot = fakeBoot({ provided: { mermaid: {}, hljs: {}, katex: {} } });
    const loader = new LibraryLoader(boot, doc, { idle: () => {} });
    loader.dispatchPage("coreStarted", {});
    const got = loader.get("plantuml");
    expect(loader.pageStartupState).toBe("loading");
    doc.dispatchEvent(new Event("DOMContentLoaded"));
    expect(loader.hasFailed("plantuml")).toBe(true);
    await expect(got).rejects.toThrow(/plantuml could not run/);
    expect(loader.pageStartupState).toBe("answering"); // no host here answers the held boxes
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("AT-LSM-20 (INV-81 (3), review L3) a host action that throws is logged; the loader's own actions and the events after them still run, and the page still settles", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loader, host, idle } = loaderIn("arrived");
    host.handToRenderers.mockImplementation(() => {
      throw new Error("host broke");
    });
    host.redrawShownWithout.mockImplementation(() => Promise.reject(new Error("redraw broke")));
    const got = loader.get(LIB); // needed -> runLibrary -> libraryRan
    await expect(got).resolves.toBe(LIB_OBJECT); // settleWaiters ran
    expect(loader.libraryState(LIB)).toBe("ready");
    expect(idle).toHaveLength(1); // requestIdleTurn ran
    expect(loader.pageStartupState).toBe("answering"); // checkSettled ran
    expect(host.runWaitingPlantUml).toHaveBeenCalledTimes(1);
    await expect(loader.dispatch(LIB, "needed", STEP)).resolves.toBe(false); // a rejected redraw resolves as false
    expect(errors.mock.calls.map((c) => c[0])).toEqual(["LibraryHost handToRenderers failed:", "LibraryHost redrawShownWithout failed:", "LibraryHost handToRenderers failed:", "LibraryHost redrawShownWithout failed:"]);
  });

  it("AT-LSM-21 (INV-81 (2), review L4) a loader made after the file was parsed sends parsingEnded at once: a library that never arrived fails, and the page settles at coreStarted", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = document.implementation.createHTMLDocument("");
    Object.defineProperty(doc, "readyState", { value: "complete" });
    const boot = fakeBoot({ provided: { mermaid: {}, hljs: {}, katex: {} } });
    const loader = new LibraryLoader(boot, doc, { idle: () => {} });
    expect(loader.hasFailed("plantuml")).toBe(true);
    expect(loader.libraryState("mermaid")).toBe("ready");
    expect(errors).toHaveBeenCalledTimes(1);
    loader.dispatchPage("coreStarted", {});
    expect(loader.isSettled()).toBe(true);
  });
});
