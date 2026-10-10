import { CONFIG } from "../config.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Only these schemes are guaranteed not to touch the network. Everything else
// is external: http(s), protocol-relative "//host", and relative paths (the
// document is pasted or dropped, so a relative path would resolve against the
// host serving this app, which is a request the author of the .md controls).
const LOCAL_URL = /^\s*(?:data|blob):/i;

const PENDING_SRC = "data-external-src";
const PENDING_SRCSET = "data-external-srcset";
const PLACEHOLDER_CLASS = "external-image-placeholder";

// Attributes (other than <img src/srcset>) that DOMPurify keeps by default and
// that make the browser fetch a URL as soon as the element is rendered:
// <video src/poster>, <audio src>, <source src/srcset>, <track src>,
// <input type=image src>, <table background>, ... They are removed for good
// rather than gated: they are rare in Markdown, have no natural placeholder,
// and media is blocked by the CSP anyway (no media-src).
const FETCHING_ATTRS = ["src", "srcset", "poster", "background"];

// Attributes parsed as CSS, where url(...) or image-set(...) can fetch a
// remote resource. Only same-document fragments (url(#id)) and data: survive.
const CSS_ATTRS = [
  "style",
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
];
const CSS_URL = /url\(\s*(['"]?)\s*([^'")\s]*)/gi;
// CSS escapes (u\72l) and string-taking image functions are too easy to
// smuggle a URL through; any declaration that uses them is dropped.
const CSS_SUSPICIOUS = /\\|image-set\(|\bimage\(|cross-fade\(|\bsrc\(|@import/i;

/** @param {string} value */
function isLocalUrl(value) {
  return LOCAL_URL.test(value);
}

/**
 * Candidate URLs of a srcset value. Approximate (a comma inside a data: URL
 * splits it), which only errs toward treating the value as external.
 * @param {string} srcset
 * @returns {string[]}
 */
function srcsetUrls(srcset) {
  return srcset
    .split(/,\s*/)
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** @param {string} value */
function hasRemoteCssRef(value) {
  if (CSS_SUSPICIOUS.test(value)) return true;
  for (const match of value.matchAll(CSS_URL)) {
    const target = match[2];
    if (!target.startsWith("#") && !isLocalUrl(target)) return true;
  }
  return false;
}

/**
 * @param {string} url
 * @returns {string} host name for display, or the raw value if unparsable
 */
function hostOf(url) {
  try {
    return new URL(url, document.baseURI).host || url;
  } catch (_) {
    return url;
  }
}

/**
 * Consent gate for external images in rendered Markdown (CON-12, INV-19).
 *
 * - neutralize(): DOMPurify hook. Moves external <img src/srcset> into
 *   data-external-* attributes and strips every other attribute that would
 *   fetch a remote resource.
 * - apply(): after the sanitized HTML is in the preview, replaces each
 *   pending image with a click-to-load placeholder, or restores it directly
 *   when consent is already active.
 * - Consent is asked with window.confirm (same UI as PlantUML), held in
 *   memory only (INV-04), and revoked on Clear or when a new file is dropped.
 */
export default class ExternalImageGate {
  /** @param {HTMLElement} preview */
  constructor(preview) {
    this.preview = preview;
    this._granted = false;
    /** @type {WeakMap<HTMLElement, {img: HTMLImageElement, hosts: string[]}>} */
    this._held = new WeakMap();

    preview.addEventListener("click", (e) => {
      if (!this._placeholderFrom(e.target)) return;
      // The image may sit inside a link (badges): do not follow it.
      e.preventDefault();
      this.requestConsent();
    });
    preview.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!this._placeholderFrom(e.target)) return;
      e.preventDefault();
      this.requestConsent();
    });
  }

  // ---- Queries ----

  /** @returns {boolean} */
  isGranted() {
    return this._granted;
  }

  // ---- Commands ----

  /**
   * DOMPurify afterSanitizeAttributes hook. Runs on every element of the
   * sanitized fragment, before it is inserted into the live document, so no
   * request can start from the attributes it removes.
   * @param {Element} node
   */
  neutralize(node) {
    if (node.nodeType !== 1) return;
    const tag = node.nodeName.toLowerCase();

    // Only this class may write these markers; never trust the document's own.
    node.removeAttribute(PENDING_SRC);
    node.removeAttribute(PENDING_SRCSET);

    if (tag === "img" && node.namespaceURI !== SVG_NS) {
      this._holdAttribute(node, "src", PENDING_SRC);
      this._holdAttribute(node, "srcset", PENDING_SRCSET);
    } else {
      for (const name of FETCHING_ATTRS) {
        const value = node.getAttribute(name);
        if (value === null) continue;
        const urls = name === "srcset" ? srcsetUrls(value) : [value];
        if (!urls.every(isLocalUrl)) node.removeAttribute(name);
      }
    }

    // SVG <image>, <feImage>, ... load their href. Links (<a>) only navigate.
    if (node.namespaceURI === SVG_NS && tag !== "a") {
      for (const name of ["href", "xlink:href"]) {
        const value = node.getAttribute(name);
        if (value === null) continue;
        if (!value.trim().startsWith("#") && !isLocalUrl(value)) {
          node.removeAttribute(name);
        }
      }
    }

    for (const name of CSS_ATTRS) {
      const value = node.getAttribute(name);
      if (value !== null && hasRemoteCssRef(value)) node.removeAttribute(name);
    }
  }

  /**
   * Show placeholders for the pending images in the preview, or load them
   * right away if consent is active. Call after the sanitized HTML is set.
   */
  apply() {
    const pending = this.preview.querySelectorAll(
      `img[${PENDING_SRC}], img[${PENDING_SRCSET}]`,
    );
    pending.forEach((img) => {
      if (this._granted) {
        this._restoreImage(img);
      } else {
        img.replaceWith(this._createPlaceholder(img));
      }
    });
  }

  /**
   * Ask once for all external images in the current preview. On OK, keep
   * consent for later renders and load the pending images.
   * @returns {boolean} true if consent was given
   */
  requestConsent() {
    const placeholders = [
      ...this.preview.querySelectorAll(`.${PLACEHOLDER_CLASS}`),
    ];
    if (placeholders.length === 0) return false;

    const hosts = [
      ...new Set(placeholders.flatMap((p) => this._held.get(p)?.hosts ?? [])),
    ];
    if (!window.confirm(this._consentMessage(placeholders.length, hosts))) {
      return false;
    }

    this._granted = true;
    placeholders.forEach((placeholder) => {
      const entry = this._held.get(placeholder);
      if (!entry) return;
      this._restoreImage(entry.img);
      placeholder.replaceWith(entry.img);
    });
    return true;
  }

  /** Forget consent (Clear, or a different document was loaded). */
  revoke() {
    this._granted = false;
  }

  // ---- Internals ----

  /**
   * @param {Element} img
   * @param {string} name - "src" | "srcset"
   * @param {string} pendingName
   */
  _holdAttribute(img, name, pendingName) {
    const value = img.getAttribute(name);
    if (value === null) return;
    const urls = name === "srcset" ? srcsetUrls(value) : [value];
    if (urls.every(isLocalUrl)) return;
    img.setAttribute(pendingName, value);
    img.removeAttribute(name);
  }

  /** @param {HTMLImageElement} img */
  _restoreImage(img) {
    const srcset = img.getAttribute(PENDING_SRCSET);
    if (srcset !== null) {
      img.setAttribute("srcset", srcset);
      img.removeAttribute(PENDING_SRCSET);
    }
    const src = img.getAttribute(PENDING_SRC);
    if (src !== null) {
      img.setAttribute("src", src);
      img.removeAttribute(PENDING_SRC);
    }
  }

  /**
   * @param {HTMLImageElement} img
   * @returns {HTMLSpanElement}
   */
  _createPlaceholder(img) {
    const urls = [];
    const src = img.getAttribute(PENDING_SRC);
    if (src !== null) urls.push(src);
    const srcset = img.getAttribute(PENDING_SRCSET);
    if (srcset !== null) urls.push(...srcsetUrls(srcset));
    const hosts = [...new Set(urls.filter((u) => !isLocalUrl(u)).map(hostOf))];

    // A span, not a <button>: badges are often wrapped in <a>, and a button
    // inside a link is invalid HTML.
    const placeholder = document.createElement("span");
    placeholder.className = PLACEHOLDER_CLASS;
    placeholder.setAttribute("role", "button");
    placeholder.tabIndex = 0;
    const alt = img.getAttribute("alt")?.trim();
    placeholder.textContent = CONFIG.messages.externalImage.placeholder(
      alt,
      hosts.join(", "),
    );
    placeholder.title = CONFIG.messages.externalImage.placeholderTitle;

    this._held.set(placeholder, { img, hosts });
    return placeholder;
  }

  /**
   * @param {number} count
   * @param {string[]} hosts
   * @returns {string}
   */
  _consentMessage(count, hosts) {
    const max = CONFIG.externalImage.maxHostsInDialog;
    const shown = hosts.slice(0, max).map((h) => `  ${h}`);
    if (hosts.length > max) shown.push(`  ... and ${hosts.length - max} more`);
    return (
      `Security & Privacy Warning\n\n` +
      `This document has ${count} external image(s) from:\n` +
      `${shown.join("\n")}\n\n` +
      `Loading them sends your IP address to these servers and tells them ` +
      `that this document was opened.\n\n` +
      `[OK]: load external images (until [Clear] or a new file drop)\n\n` +
      `[Cancel]: keep the placeholders`
    );
  }

  /**
   * @param {EventTarget|null} target
   * @returns {HTMLElement|null}
   */
  _placeholderFrom(target) {
    if (!(target instanceof Element)) return null;
    const placeholder = target.closest(`.${PLACEHOLDER_CLASS}`);
    return placeholder && this.preview.contains(placeholder)
      ? placeholder
      : null;
  }
}
