// The libraries that run on demand (INV-81 (2), spec 5.17): mermaid,
// highlight.js, KaTeX and the PlantUML encoder are in the file as data
// blocks (<script type="text/plain" id="grsmd-lib-NAME">) after the core,
// each followed by a one-line script that says it has arrived. A library
// runs once: its data goes into a new <script> element, whose text the
// build's CSP allows by its sha256 hash (no unsafe-eval, no unsafe-inline),
// and the library hands itself over through window.__grsmdBoot.provide.
// A library the page already provides (the dev server imports them) is
// used as it is.

/** The libraries, in the order they arrive (O2). */
export const LIBRARY_NAMES = Object.freeze(["mermaid", "hljs", "katex", "plantuml"]);

/** The id of a library's data block. */
export const DATA_ID_PREFIX = "grsmd-lib-";

/**
 * Run a function when the page has nothing else to do.
 * @purity non-pure
 * @param {Function} task
 */
function whenIdle(task) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => task());
  else setTimeout(task, 0);
}

export default class LibraryLoader {
  /**
   * @param {{arrived: Set<string>, provided: Map<string, object>, onArrive: Function|null}} boot - window.__grsmdBoot
   * @param {Document} [doc]
   * @param {{idle?: Function}} [options] - idle: runs a task when the page is idle
   * @purity non-pure
   */
  constructor(boot, doc = document, { idle = whenIdle } = {}) {
    this.boot = boot;
    this.doc = doc;
    this.idle = idle;
    this._arrivals = new Map(); // name -> {promise, resolve}: waits for a library's data
    this._promises = new Map(); // name -> the promise get() returns
    this._failed = new Map(); // name -> the error of a library that did not run
    this._preloading = false;
    /** @purity non-pure */
    boot.onArrive = (name) => this._arrived(name);
  }

  /**
   * The library, when it has run (no waiting, nothing run).
   * @param {string} name
   * @returns {object|null}
   * @purity semi-pure-b
   */
  peek(name) {
    return this.boot.provided.get(name) ?? null;
  }

  /**
   * Whether all of the library's data is in the page (or the page provides it).
   * @param {string} name
   * @returns {boolean}
   * @purity semi-pure-b
   */
  isArrived(name) {
    return this.boot.provided.has(name) || this.boot.arrived.has(name);
  }

  /**
   * The library now: run at once when its data has arrived, else null.
   * A library that fails to run is null, and get() rejects with the error.
   * @param {string} name
   * @returns {object|null}
   * @purity non-pure
   */
  loadIfArrived(name) {
    const library = this.peek(name);
    if (library || !this.isArrived(name) || this._failed.has(name)) return library;
    try {
      return this._run(name);
    } catch (error) {
      this._failed.set(name, error);
      console.error(`Library ${name} could not run:`, error);
      return null;
    }
  }

  /**
   * The library, when its data has arrived and it has run. The same promise
   * for every call.
   * @param {string} name
   * @returns {Promise<object>}
   * @purity non-pure
   */
  get(name) {
    let promise = this._promises.get(name);
    if (promise) return promise;
    /** @purity non-pure */
    promise = this._arrival(name).then(() => {
      const library = this.loadIfArrived(name);
      if (library) return library;
      throw this._failed.get(name);
    });
    this._promises.set(name, promise);
    return promise;
  }

  /**
   * Run every library when the page is idle, one per idle time, in the
   * order they arrive (owner ruling 2026-10-25): a library is ready before it
   * is needed. onLoaded(name, library) is told about each one that ran here.
   * @param {Function} onLoaded
   * @purity non-pure
   */
  preloadWhenIdle(onLoaded) {
    if (this._preloading) return;
    this._preloading = true;
    let index = 0;
    /** @purity non-pure */
    const next = () => {
      while (index < LIBRARY_NAMES.length && (this.peek(LIBRARY_NAMES[index]) || this._failed.has(LIBRARY_NAMES[index]))) index++;
      if (index >= LIBRARY_NAMES.length) return;
      const name = LIBRARY_NAMES[index];
      /** @purity non-pure */
      this._arrival(name).then(() =>
        this.idle(() => {
          const had = this.peek(name);
          const library = this.loadIfArrived(name);
          if (library && !had) onLoaded(name, library);
          index++;
          next();
        }),
      );
    };
    this.idle(next);
  }

  // ---- internals ----

  /**
   * Settles when the library's data has all arrived (nothing is run).
   * @param {string} name
   * @returns {Promise<void>}
   * @purity non-pure
   */
  _arrival(name) {
    if (this.isArrived(name)) return Promise.resolve();
    let entry = this._arrivals.get(name);
    if (!entry) {
      entry = {};
      /** @purity non-pure */
      entry.promise = new Promise((resolve) => (entry.resolve = resolve));
      this._arrivals.set(name, entry);
    }
    return entry.promise;
  }

  /**
   * The data of a library has all arrived: what waits for it goes on.
   * @param {string} name
   * @purity non-pure
   */
  _arrived(name) {
    const entry = this._arrivals.get(name);
    if (!entry) return;
    this._arrivals.delete(name);
    entry.resolve();
  }

  /**
   * Run a library's data as a script; its data block is dropped after.
   * @param {string} name
   * @returns {object}
   * @purity non-pure
   */
  _run(name) {
    const data = this.doc.getElementById(`${DATA_ID_PREFIX}${name}`);
    if (!data) throw new Error(`no data block for ${name}`);
    const script = this.doc.createElement("script");
    script.textContent = data.textContent;
    this.doc.head.append(script);
    script.remove();
    data.remove();
    const library = this.peek(name);
    if (!library) throw new Error(`${name} did not run (blocked by the CSP, or an error)`);
    performance.mark(`grsmd-ran-${name}`);
    return library;
  }
}
