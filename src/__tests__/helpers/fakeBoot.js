import { vi } from "vitest";
import { DATA_ID_PREFIX } from "../../js/libraryNames.js";

// A stand-in for window.__grsmdBoot (src/js/boot.js) in the test's own
// document, where scripts do not run: a library "arrives" with a data block
// and its arrival note, and what the block's script would hand over through
// provide() is put in place beforehand (LibraryLoader reads it only after it
// ran the block, so the states are the same as in the page).

/**
 * @param {{provided?: object}} [options] - libraries the page provides from the start (the dev server)
 * @returns {object} the boot object, as installBoot makes it
 */
export function fakeBoot({ provided = {} } = {}) {
  const boot = {
    arrived: new Set(),
    data: new Map(),
    provided: new Map(Object.entries(provided)),
    shared: {},
    onArrive: null,
    early: null,
    takeEarlyInput: vi.fn(() => {
      const early = boot.early;
      boot.early = null;
      return early;
    }),
  };
  return boot;
}

/**
 * The data block of a library and its arrival note.
 * @param {object} boot
 * @param {string} name
 * @param {object|Error} library - what its script hands over; an Error: it hands over nothing (blocked, failing)
 * @returns {HTMLScriptElement} the data block
 */
export function arriveData(boot, name, library) {
  const data = document.createElement("script");
  data.type = "text/plain";
  data.id = `${DATA_ID_PREFIX}${name}`;
  boot.data.set(name, data);
  boot.arrived.add(name);
  if (!(library instanceof Error)) boot.provided.set(name, library);
  boot.onArrive?.(name);
  return data;
}
