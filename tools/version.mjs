// Version helpers shared by the build (vite.config.js: buildVersion), the
// version test (src/__tests__/versions.test.js) and the release tool
// (tools/release.mjs). The rule itself -- the forms, who writes a version and
// when -- is spec/grsmd_gen2_spec_ja.md section 1.7 only.

/** The compact form, e.g. 20261022T013000Z. */
export const COMPACT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
/** The separated form, e.g. 2026-10-22T01:30:00Z. */
export const SEPARATED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/**
 * True when the six fields name a real UTC instant (no month 13, no Feb 30).
 * @param {string[]} parts year, month, day, hour, minute, second
 * @returns {boolean}
 * @purity pure
 */
function isRealInstant(parts) {
  const [y, mo, d, h, mi, s] = parts.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/**
 * @param {string} text
 * @returns {boolean}
 * @purity pure
 */
export function isCompact(text) {
  const m = COMPACT.exec(String(text));
  return m !== null && isRealInstant(m.slice(1));
}

/**
 * 20261022T013000Z -> 2026-10-22T01:30:00Z. Throws on anything else.
 * @param {string} compact
 * @returns {string}
 * @purity pure
 */
export function separatedOf(compact) {
  const m = COMPACT.exec(String(compact));
  if (m === null || !isRealInstant(m.slice(1))) {
    throw new Error(`not a compact version (YYYYMMDDTHHMMSSZ): "${compact}"`);
  }
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

/**
 * 2026-10-22T01:30:00Z -> 20261022T013000Z. Throws on anything else.
 * @param {string} separated
 * @returns {string}
 * @purity pure
 */
export function compactOf(separated) {
  const m = SEPARATED.exec(String(separated));
  if (m === null || !isRealInstant(m.slice(1))) {
    throw new Error(`not a separated version (YYYY-MM-DDTHH:MM:SSZ): "${separated}"`);
  }
  return m.slice(1).join("").replace(/^(\d{8})/, "$1T") + "Z";
}

/**
 * An instant in whole seconds, in the separated form (UTC, no fraction).
 * @param {number} epochSeconds
 * @returns {string}
 * @purity pure
 */
export function separatedOfEpochSeconds(epochSeconds) {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0) {
    throw new Error(`not a time in seconds: "${epochSeconds}"`);
  }
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const SLOT = /<p\b[^>]*\bdata-build-version\b[^>]*>([\s\S]*?)<\/p>/g;
const KIND_SPAN = (kind) =>
  new RegExp(`<span\\b[^>]*\\bdata-build-kind="${kind}"[^>]*>[\\s\\S]*?<\\/span>`, "g");
const EMPTY_TIME = /<time><\/time>/g;
export const BUILD_KINDS = ["release", "dev"];

/**
 * Write the build's version into the help (R3): in each version slot keep
 * the label of this kind ("Version" / "Development build", and the Japanese
 * ones), drop the other, and fill the empty <time>. The help has exactly one
 * slot per language (2); anything else is an error.
 * @param {string} html
 * @param {{kind: "release"|"dev", instant: string}} build  instant: separated form
 * @returns {string}
 * @purity pure
 */
export function stampBuildVersion(html, { kind, instant }) {
  if (!BUILD_KINDS.includes(kind)) throw new Error(`unknown build kind "${kind}"`);
  compactOf(instant); // throws unless the separated form
  const slots = [...html.matchAll(SLOT)];
  if (slots.length !== 2) {
    throw new Error(`the help needs 2 version slots (data-build-version), found ${slots.length}`);
  }
  return html.replace(SLOT, (whole, inner) => {
    for (const each of BUILD_KINDS) {
      const count = (inner.match(KIND_SPAN(each)) ?? []).length;
      if (count !== 1) throw new Error(`a version slot needs one data-build-kind="${each}" label, found ${count}`);
    }
    const times = (inner.match(EMPTY_TIME) ?? []).length;
    if (times !== 1) throw new Error(`a version slot needs one empty <time></time>, found ${times}`);
    const other = BUILD_KINDS.find((each) => each !== kind);
    const stamped = inner
      .replace(KIND_SPAN(other), "")
      .replace(EMPTY_TIME, `<time datetime="${instant}">${instant}</time>`);
    return whole.replace(inner, () => stamped);
  });
}
