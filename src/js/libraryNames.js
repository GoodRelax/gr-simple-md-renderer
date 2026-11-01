// Names shared by the receiver (boot.js), the loader (LibraryLoader) and the
// build (tools/fastStartup.mjs), in one place (INV-81).

/**
 * The prefix of the ids the app keeps for itself. A document's own id that
 * starts with it is dropped when it is sanitized (INV-81 (5)).
 */
export const APP_ID_PREFIX = "grsmd-";

/** The id of a library's data block: the prefix and the library's name. */
export const DATA_ID_PREFIX = `${APP_ID_PREFIX}lib-`;

/** The libraries that run on demand, in the order they arrive (O2). */
export const LIBRARY_NAMES = Object.freeze(["mermaid", "hljs", "katex", "plantuml"]);
