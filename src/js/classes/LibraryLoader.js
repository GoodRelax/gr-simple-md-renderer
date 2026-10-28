// The libraries that run on demand (INV-81 (2), spec 5.17): mermaid,
// highlight.js, KaTeX and the PlantUML encoder are in the file as data
// blocks (<script type="text/plain" id="grsmd-lib-NAME">) after the core,
// each followed by a one-line script that says it has arrived and hands
// the block over by reference (boot.js keeps it). A library runs once: the
// block's text goes into a new <script> element, whose text the build's CSP
// allows by its sha256 hash (no unsafe-eval, no unsafe-inline), and the
// library hands itself over through window.__grsmdBoot.provide. The block
// is never looked up by its id: a document's element with the same id
// would stand in for it (INV-81 (5)). A library the page already provides
// (the dev server imports them) is used as it is.
//
// Spec 3.3 11-g: two state machines. One per library (libraryStateMachine,
// the four libraries share the table) and one for the page
// (pageStartupStateMachine). They are joined by an event: the library
// action checkSettled sends librariesSettled to the page. The state is only
// _libraryStates (one value per library) and _pageStartupState; the
// drawing side is the LibraryHost port (RendererOrchestrator). The actions
// run inside dispatch() / dispatchPage(); the events they raise are handled
// after them in the same call, not nested.

import { LIBRARY_NAMES } from "../libraryNames.js";
import { cell, row, choice, selectCell } from "../stateTable.js";

const NOT_ARRIVED = "notArrived";
const ARRIVED = "arrived";
const READY = "ready";
const FAILED = "failed";

/** The states of one library (spec 11-g (1)), in the order of the table's columns. */
export const LIBRARY_STATES = Object.freeze([NOT_ARRIVED, ARRIVED, READY, FAILED]);
const library = (...cells) => row(LIBRARY_STATES, cells);

/** Spec 11-g (1): event -> current state -> cell (null = no change). */
export const libraryStateMachine = Object.freeze({
  dataArrived: library(choice(cell(ARRIVED, ["runLibrary"], "isShownWithout"), cell(ARRIVED, ["requestIdleTurn"]))),
  needed: library(
    null,
    cell(ARRIVED, ["runLibrary"]),
    cell(READY, ["handToRenderers", "redrawShownWithout"]),
    cell(FAILED, ["showFailure"]),
  ),
  idleTurn: library(null, cell(ARRIVED, ["runLibrary"])),
  libraryRan: library(null, cell(READY, ["handToRenderers", "redrawShownWithout", "settleWaiters", "requestIdleTurn", "checkSettled"])),
  libraryRunFailed: library(null, cell(FAILED, ["logRunError", "showFailure", "settleWaiters", "requestIdleTurn", "checkSettled"])),
  parsingEnded: library(cell(FAILED, ["logNotArrived", "showFailure", "settleWaiters", "checkSettled"])),
});

const RECEIVING = "receiving";
const LOADING = "loading";
const ANSWERING = "answering";
const SETTLED = "settled";

/** The states of the page (spec 11-g (2)), in the order of the table's columns. */
export const PAGE_STARTUP_STATES = Object.freeze([RECEIVING, LOADING, ANSWERING, SETTLED]);
const page = (...cells) => row(PAGE_STARTUP_STATES, cells);
const CORE_STARTED_ACTIONS = ["takeEarlyInput", "receiveEarlyInput", "requestIdleTurn"];

/**
 * The events whose cells the receiver (boot.js) handles before the core
 * runs: they are in the table to match the spec; the core never gets them
 * (spec 11-g (2)).
 */
const RECEIVER_EVENTS = Object.freeze(new Set(["earlyInputArrived"]));

/** Spec 11-g (2): event -> current state -> cell (null = no change). */
export const pageStartupStateMachine = Object.freeze({
  earlyInputArrived: page(cell(RECEIVING, ["keepLastInput"])), // done by the receiver (RECEIVER_EVENTS)
  coreStarted: page(choice(cell(SETTLED, CORE_STARTED_ACTIONS, "areLibrariesSettled"), cell(LOADING, CORE_STARTED_ACTIONS))),
  librariesSettled: page(null, cell(ANSWERING, ["runWaitingPlantUml"])),
  plantUmlStepReached: page(
    null,
    cell(LOADING, ["holdPlantUml"]),
    choice(cell(ANSWERING, ["holdPlantUml"], "isConsentStep"), cell(ANSWERING, ["runPlantUmlStep"])),
    cell(SETTLED, ["runPlantUmlStep"]),
  ),
  waitingPlantUmlAnswered: page(null, null, cell(SETTLED, [])),
  blockReleased: page(null, null, null, cell(SETTLED, ["turnHeldPlantUmlToRender"])),
});

/**
 * The first state of a library (spec 11-g (1), tried in order): the page
 * provides it (the dev server) -> ready; its arrival note came before the
 * loader was made -> arrived; else notArrived.
 * @purity semi-pure-a
 * @param {{provided: Map<string, object>, arrived: Set<string>}} boot
 * @param {string} name
 * @returns {string}
 */
export function initialLibraryState(boot, name) {
  if (boot.provided.has(name)) return READY; // isProvided
  if (boot.arrived.has(name)) return ARRIVED; // hasArrivedBefore
  return NOT_ARRIVED;
}

/**
 * Run a function when the page has nothing else to do.
 * @purity non-pure
 * @param {Function} task
 */
function whenIdle(task) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => task());
  else setTimeout(task, 0);
}

/**
 * @purity pure
 * @param {string} state
 * @returns {boolean} ready or failed: the library will not change any more
 */
function isFinal(state) {
  return state === READY || state === FAILED;
}

/**
 * LibraryHost (port, spec 11-g): the drawing side, RendererOrchestrator.
 *   isShownWithout(name) -> boolean   the screen shows something drawn without it
 *   handToRenderers(name, library)
 *   redrawShownWithout(name, step)    step "full" / "partial": inside that render
 *                                     step, returns Promise<boolean> (blocks drawn
 *                                     again); null: queued, returns nothing
 *   showFailure(name)
 *   holdPlantUml({theme, root, mode, keepRender})
 *   runPlantUmlStep({theme, root, mode, keepRender}) -> Promise
 *   runWaitingPlantUml()              queued once, returns nothing; when it has
 *                                     dealt with the held boxes it sends
 *                                     waitingPlantUmlAnswered
 *   turnHeldPlantUmlToRender()        held boxes an open editor kept aside
 *                                     become [Render] boxes
 * keepRender: Map<theme, Set<source>> of the diagrams that wait for [Render], or null.
 * A host action that throws is logged; the loader's own actions still run.
 */
export default class LibraryLoader {
  /**
   * @param {{arrived: Set<string>, data: Map<string, Element>, provided: Map<string, object>, onArrive: Function|null, early: object|null, takeEarlyInput: Function}} boot - window.__grsmdBoot
   * @param {Document} [doc]
   * @param {{idle?: Function}} [options] - idle: runs a task when the page is idle
   * @purity non-pure
   */
  constructor(boot, doc = document, { idle = whenIdle } = {}) {
    this.boot = boot;
    this.doc = doc;
    this.idle = idle;
    this._host = null;
    this._libraryStates = new Map(LIBRARY_NAMES.map((name) => [name, initialLibraryState(boot, name)]));
    this._pageStartupState = RECEIVING;
    // get(): one promise per library for those who wait (not a state)
    this._waiters = new Map(); // name -> {promise, resolve, reject}
    // requestIdleTurn keeps one reservation at a time (a scheduling handle, not a state)
    this._idleTurnRequested = false;
    /** @purity non-pure */
    boot.onArrive = (name) => this.dispatch(name, "dataArrived");
    /** @purity non-pure */
    const parsingEnded = () => {
      for (const name of LIBRARY_NAMES) this.dispatch(name, "parsingEnded");
    };
    // made after the file was parsed: DOMContentLoaded has gone already
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", parsingEnded);
    else parsingEnded();
  }

  /**
   * The drawing side (RendererOrchestrator). main.js connects it before coreStarted.
   * @param {object} host - LibraryHost
   * @purity non-pure
   */
  connect(host) {
    this._host = host;
  }

  /**
   * @returns {string} receiving | loading | answering | settled (spec 11-g (2))
   * @purity semi-pure-b
   */
  get pageStartupState() {
    return this._pageStartupState;
  }

  /**
   * @returns {boolean} the page is settled: the four libraries are ready or
   *   failed, and the held PlantUML boxes have been dealt with
   * @purity semi-pure-b
   */
  isSettled() {
    return this._pageStartupState === SETTLED;
  }

  /**
   * @param {string} name
   * @returns {string} notArrived | arrived | ready | failed (spec 11-g (1))
   * @purity semi-pure-b
   */
  libraryState(name) {
    return this._libraryStates.get(name);
  }

  /**
   * The library, when it is ready (no waiting, nothing run).
   * @param {string} name
   * @returns {object|null}
   * @purity semi-pure-b
   */
  peek(name) {
    return this._libraryStates.get(name) === READY ? (this.boot.provided.get(name) ?? null) : null;
  }

  /**
   * Whether all of the library's data is in the page (arrived or ready).
   * @param {string} name
   * @returns {boolean}
   * @purity semi-pure-b
   */
  isArrived(name) {
    const state = this._libraryStates.get(name);
    return state === ARRIVED || state === READY;
  }

  /**
   * Whether the library could not run: it never will in this page.
   * @param {string} name
   * @returns {boolean}
   * @purity semi-pure-b
   */
  hasFailed(name) {
    return this._libraryStates.get(name) === FAILED;
  }

  /**
   * Send needed, and the promise of the library: resolved when it is
   * ready, rejected when it failed. The same promise for every call.
   * @param {string} name
   * @returns {Promise<object>}
   * @purity non-pure
   */
  get(name) {
    const waiter = this._waiter(name);
    this.dispatch(name, "needed");
    return waiter.promise;
  }

  /**
   * Handle one event of a library's table (11-g (1)). The events the
   * actions raise (libraryRan / libraryRunFailed, librariesSettled) are
   * handled after this one, not nested.
   * @param {string} name
   * @param {string} event
   * @param {{step?: "full"|"partial", library?: object, error?: Error}} [input]
   * @returns {Promise<boolean>} true when the host drew blocks again inside the caller's render step
   * @purity non-pure
   */
  dispatch(name, event, input = {}) {
    return this._handle([{ name, event, input }]);
  }

  /**
   * Handle one event of the page's table (11-g (2)).
   * @param {string} event
   * @param {{theme?: string, root?: ParentNode|ParentNode[], mode?: "consent"|"placeholder", keepRender?: Map<string, Set<string>>|null, receiveEarlyInput?: Function}} [input]
   * @returns {Promise<boolean>}
   * @throws {Error} for an event the receiver handles (earlyInputArrived)
   * @purity non-pure
   */
  dispatchPage(event, input = {}) {
    return this._handle([{ name: null, event, input }]);
  }

  // ---- internals ----

  /**
   * One transition after another, in the order they were raised.
   * @param {Array<{name: string|null, event: string, input: object}>} queue
   * @returns {Promise<boolean>}
   * @purity non-pure
   */
  _handle(queue) {
    const results = [];
    while (queue.length > 0) {
      const { name, event, input } = queue.shift();
      if (name === null) this._pageStep(event, input, results);
      else this._libraryStep(name, event, input, queue, results);
    }
    /** @purity pure */
    return Promise.all(results).then((values) => values.includes(true));
  }

  /**
   * @purity non-pure
   */
  _libraryStep(name, event, input, queue, results) {
    const cells = libraryStateMachine[event];
    if (!cells) throw new Error(`Unknown library event: ${event}`);
    if (!this._libraryStates.has(name)) throw new Error(`Unknown library: ${name}`);
    const next = selectCell(cells[this._libraryStates.get(name)], (guard) => this._isLibraryGuardTrue(guard, name));
    if (!next) return;
    this._libraryStates.set(name, next.to);
    for (const action of next.actions) this._runLibraryAction(action, name, input, queue, results);
  }

  /**
   * @purity non-pure
   */
  _pageStep(event, input, results) {
    const cells = pageStartupStateMachine[event];
    if (!cells) throw new Error(`Unknown page startup event: ${event}`);
    if (RECEIVER_EVENTS.has(event)) throw new Error(`${event} is handled by the receiver (boot.js), not by the core`);
    const next = selectCell(cells[this._pageStartupState], (guard) => this._isPageGuardTrue(guard, input));
    if (!next) return;
    this._pageStartupState = next.to;
    const context = { early: null };
    for (const action of next.actions) this._runPageAction(action, input, context, results);
  }

  /**
   * @purity semi-pure-b
   */
  _isLibraryGuardTrue(guard, name) {
    if (guard === "isShownWithout") return Boolean(this._host?.isShownWithout(name));
    throw new Error(`Unknown library guard: ${guard}`);
  }

  /**
   * @purity semi-pure-b
   */
  _isPageGuardTrue(guard, input) {
    if (guard === "areLibrariesSettled") return this._areLibrariesSettled();
    if (guard === "isConsentStep") return input.mode === "consent";
    throw new Error(`Unknown page startup guard: ${guard}`);
  }

  /**
   * @purity semi-pure-b
   * @returns {boolean}
   */
  _areLibrariesSettled() {
    return [...this._libraryStates.values()].every(isFinal);
  }

  /**
   * @purity non-pure
   */
  _runLibraryAction(action, name, input, queue, results) {
    const host = this._host;
    switch (action) {
      case "runLibrary":
        try {
          queue.push({ name, event: "libraryRan", input: { ...input, library: this._runScript(name) } });
        } catch (error) {
          queue.push({ name, event: "libraryRunFailed", input: { ...input, error } });
        }
        return;
      case "requestIdleTurn":
        this._requestIdleTurn();
        return;
      case "handToRenderers":
        this._callHost(action, () => host?.handToRenderers(name, this.peek(name)));
        return;
      case "redrawShownWithout":
        if (host) results.push(this._callHost(action, () => host.redrawShownWithout(name, input.step ?? null)));
        return;
      case "showFailure":
        this._callHost(action, () => host?.showFailure(name));
        return;
      case "settleWaiters":
        this._settleWaiter(name);
        return;
      case "checkSettled":
        if (this._areLibrariesSettled()) queue.push({ name: null, event: "librariesSettled", input: {} });
        return;
      case "logRunError":
        console.error(`Library ${name} could not run:`, input.error);
        return;
      case "logNotArrived":
        console.error(`Library ${name} did not arrive before the file was parsed.`);
        return;
      default:
        throw new Error(`Unknown library action: ${action}`);
    }
  }

  /**
   * @purity non-pure
   */
  _runPageAction(action, input, context, results) {
    const host = this._host;
    switch (action) {
      case "takeEarlyInput":
        context.early = this.boot.takeEarlyInput();
        return;
      case "receiveEarlyInput":
        if (context.early) input.receiveEarlyInput?.(context.early);
        return;
      case "requestIdleTurn":
        this._requestIdleTurn();
        return;
      case "runWaitingPlantUml":
        this._callHost(action, () => host?.runWaitingPlantUml()); // queued: never awaited here (the caller may be a render step)
        return;
      case "holdPlantUml":
        this._callHost(action, () => host?.holdPlantUml(input));
        return;
      case "runPlantUmlStep":
        if (host) results.push(this._callHost(action, () => host.runPlantUmlStep(input)));
        return;
      case "turnHeldPlantUmlToRender":
        this._callHost(action, () => host?.turnHeldPlantUmlToRender());
        return;
      default:
        throw new Error(`Unknown page startup action: ${action}`);
    }
  }

  /**
   * A host action (LibraryHost): a throw or a rejection is logged, and the
   * loader goes on with its own actions and the events after them, so the
   * page still reaches settled.
   * @param {string} action
   * @param {Function} call
   * @returns {Promise<unknown>} what the host returned (false when it failed)
   * @purity non-pure
   */
  _callHost(action, call) {
    /** @purity non-pure */
    const failed = (error) => {
      console.error(`LibraryHost ${action} failed:`, error);
      return false;
    };
    try {
      return Promise.resolve(call()).catch(failed);
    } catch (error) {
      return Promise.resolve(failed(error));
    }
  }

  /**
   * One idle turn at a time: when the page is idle, the first arrived
   * library in LIBRARY_NAMES order gets idleTurn (none: nothing is sent).
   * @purity non-pure
   */
  _requestIdleTurn() {
    if (this._idleTurnRequested) return;
    this._idleTurnRequested = true;
    /** @purity non-pure */
    this.idle(() => {
      this._idleTurnRequested = false;
      const name = LIBRARY_NAMES.find((n) => this._libraryStates.get(n) === ARRIVED);
      if (name) this.dispatch(name, "idleTurn");
    });
  }

  /**
   * The waiter of get(): made once, settled at once when the library is
   * already ready or failed.
   * @param {string} name
   * @returns {{promise: Promise<object>, resolve: Function, reject: Function}}
   * @purity non-pure
   */
  _waiter(name) {
    let waiter = this._waiters.get(name);
    if (waiter) return waiter;
    waiter = {};
    /** @purity non-pure */
    waiter.promise = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    this._waiters.set(name, waiter);
    this._settleWaiter(name);
    return waiter;
  }

  /**
   * settleWaiters: resolve get()'s promise when the library is ready,
   * reject it when it failed.
   * @param {string} name
   * @purity non-pure
   */
  _settleWaiter(name) {
    const waiter = this._waiters.get(name);
    if (!waiter) return;
    const state = this._libraryStates.get(name);
    if (state === READY) waiter.resolve(this.peek(name));
    else if (state === FAILED) waiter.reject(new Error(`Library ${name} could not run`));
  }

  /**
   * runLibrary: run a library's data as a script; its data block is dropped
   * after. The block is the one its arrival note handed over (never found
   * by id).
   * @param {string} name
   * @returns {object} the library it handed over
   * @throws {Error} no data block, or it did not hand itself over
   * @purity non-pure
   */
  _runScript(name) {
    const data = this.boot.data.get(name);
    if (!data) throw new Error(`no data block for ${name}`);
    this.boot.data.delete(name);
    const script = this.doc.createElement("script");
    script.textContent = data.textContent;
    this.doc.head.append(script);
    script.remove();
    data.remove();
    const library = this.boot.provided.get(name);
    if (!library) throw new Error(`${name} did not run (blocked by the CSP, or an error)`);
    performance.mark(`grsmd-ran-${name}`);
    return library;
  }
}
