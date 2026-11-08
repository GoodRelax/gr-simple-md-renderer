// The browser tokens tried in order: Edge and Opera also carry "Chrome/",
// and Chrome on iOS carries "Safari/", so the more specific ones come first.
const BROWSER_TOKENS = ["EdgA", "EdgiOS", "Edg", "OPR", "FxiOS", "Firefox", "CriOS", "Chrome"];
const MESSAGE_MAX_CHARS = 200;
const HIDDEN_MESSAGE = "<hidden>"; // INV-109 (4): a message that may hold a path

/**
 * The save log (INV-109): one line per step of a save on the DevTools
 * console only, to find out why a save did not write (R5). A line holds the
 * step, the result, the error's name and message, the time since the press,
 * whether the save dialog got an id, a startIn and a file type, the browser
 * and the build date. It holds no path, no file name and no content (the
 * file type is its extension only). Nothing is shown, sent or stored.
 * A failure to make or write a line is dropped: the log never changes the
 * save (INV-109 (6)).
 *
 * One trace is one save: it starts at the press (the permission request or
 * the save dialog, INV-33) and MarkdownFileAccess writes its lines.
 */
export default class SaveTrace {
  /**
   * @purity non-pure
   * @param {object} context
   * @param {boolean|null} context.id - the save dialog got an id; null: no save dialog (Save in place)
   * @param {boolean|null} context.startIn - the save dialog got a startIn; null: no save dialog
   * @param {string} context.type - the file type's extension (".md"), or "none"
   * @param {string[]} [context.names] - file names to keep out of the messages
   * @param {object} [env] - SaveTrace.environment() (injected for tests)
   */
  constructor(context, env = SaveTrace.environment()) {
    this._context = context;
    this._names = (context.names ?? []).filter(Boolean);
    this._env = env;
    this._startedAt = env.now();
  }

  /**
   * A trace that writes nothing: MarkdownFileAccess uses it when a trace
   * cannot be made (INV-109 (6)).
   * @purity pure
   * @returns {{addName: Function, ok: Function, fail: Function, permission: Function}}
   */
  static silent() {
    const nothing = () => undefined;
    return { addName: nothing, ok: nothing, fail: nothing, permission: nothing };
  }

  /**
   * What a trace reads from the page: the clock, the console, the browser
   * and the build date (the help's version date, spec 1.7).
   * @purity semi-pure-mutable
   * @returns {{now: () => number, log: (line: string) => void, userAgent: string, buildDate: string}}
   */
  static environment() {
    return {
      now: () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
      /** @purity non-pure */
      log: (line) => console.info(line),
      userAgent: globalThis.navigator?.userAgent ?? "",
      buildDate: buildDateOf(globalThis.document),
    };
  }

  /**
   * A file name to keep out of the messages from now on (the chosen file).
   * @purity non-pure
   * @param {string} name
   */
  addName(name) {
    if (name) this._names.push(name);
  }

  /**
   * @purity non-pure
   * @param {string} step - picker | permission | createWritable | write | close
   */
  ok(step) {
    this._write(() => `${step} ok`);
  }

  /**
   * @purity non-pure
   * @param {string} step
   * @param {*} error
   */
  fail(step, error) {
    this._write(() => `${step} fail ${errorNameOf(error)} "${cleanMessage(error?.message, this._names)}"`);
  }

  /**
   * The permission request settled without an error: "granted" is ok, any
   * other state is a fail with that state.
   * @purity non-pure
   * @param {string} state
   */
  permission(state) {
    if (state === "granted") this.ok("permission");
    else this._write(() => `permission fail state=${String(state).replace(/[^A-Za-z]/g, "") || "unknown"}`);
  }

  /**
   * Make and write one line; any error on the way is dropped (INV-109 (6)).
   * @purity non-pure
   * @param {() => string} head - the step and its result
   */
  _write(head) {
    try {
      const ms = Math.max(0, Math.round(this._env.now() - this._startedAt));
      const { id, startIn, type } = this._context;
      const flag = (value) => (value === null ? "-" : value ? "yes" : "no");
      const browser = browserOf(this._env.userAgent);
      this._env.log(`GRSMD save: ${head()} ${ms} ms id=${flag(id)} startIn=${flag(startIn)} type=${type} ${browser} build=${this._env.buildDate}`);
    } catch {
      // the log never changes the save
    }
  }
}

/**
 * The browser's name and version from the user agent, e.g. "Edg/156.0.4314.58";
 * Safari as "Safari/<Version>"; "unknown" otherwise.
 * @purity pure
 * @param {string} userAgent
 * @returns {string}
 */
export function browserOf(userAgent) {
  const ua = String(userAgent ?? "");
  for (const token of BROWSER_TOKENS) {
    const match = new RegExp(`\\b${token}/([0-9.]+)`).exec(ua);
    if (match) return `${token}/${match[1]}`;
  }
  const safari = /\bVersion\/([0-9.]+).*\bSafari\//.exec(ua);
  return safari ? `Safari/${safari[1]}` : "unknown";
}

/**
 * The build date (YYYY-MM-DD) from the help's version slot (spec 1.7), or
 * "unknown" (the dev server before the slot is stamped, the tests).
 * @purity semi-pure-mutable
 * @param {Document|undefined} doc
 * @returns {string}
 */
export function buildDateOf(doc) {
  const instant = doc?.querySelector?.("[data-build-version] time[datetime]")?.getAttribute("datetime") ?? "";
  return /^\d{4}-\d{2}-\d{2}/.test(instant) ? instant.slice(0, 10) : "unknown";
}

/**
 * The file type's extension for the log: the first extension a save
 * dialog's types offer, or of a file name; "none" without one.
 * @purity pure
 * @param {object[]|string} typesOrName
 * @returns {string}
 */
export function typeOf(typesOrName) {
  if (typeof typesOrName === "string") {
    const match = /(\.[A-Za-z0-9+]{1,15})$/.exec(typesOrName);
    return match ? match[1].toLowerCase() : "none";
  }
  const first = Object.values(typesOrName?.[0]?.accept ?? {})[0]?.[0];
  return typeof first === "string" && /^\.[A-Za-z0-9+]{1,15}$/.test(first) ? first.toLowerCase() : "none";
}

/**
 * @purity pure
 * @param {*} error
 * @returns {string} ASCII letters, digits and "_" only
 */
function errorNameOf(error) {
  const name = String(error?.name ?? "").replace(/[^A-Za-z0-9_]/g, "");
  return name || "Error";
}

/**
 * An error message for the log, in ASCII: the file names are replaced; a
 * message that still holds a path character ("\", "/" or "~": any absolute,
 * UNC, file: or relative path, with spaces or quotes or not) is not written
 * at all, only HIDDEN_MESSAGE (INV-109 (4)); quotes become apostrophes;
 * other characters are \u escapes; at most MESSAGE_MAX_CHARS characters.
 * @purity pure
 * @param {*} message
 * @param {string[]} names
 * @returns {string}
 */
export function cleanMessage(message, names = []) {
  let text = String(message ?? "");
  for (const name of names) text = text.split(name).join("<name>");
  if (/[\\/~]/.test(text)) return HIDDEN_MESSAGE;
  text = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return text.length > MESSAGE_MAX_CHARS ? `${text.slice(0, MESSAGE_MAX_CHARS)}...` : text;
}
