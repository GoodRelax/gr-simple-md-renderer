import { CONFIG } from "./config.js";

// ========================================
// Utility Functions
// ========================================

/**
 * Escape HTML special characters to prevent injection in innerHTML.
 * @param {string} str
 * @returns {string}
 * @purity pure
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format a timestamp (milliseconds since epoch) as 'YYYY-MM-DD HH:MM:SS'.
 * @param {number} ms
 * @returns {string}
 * @purity semi-pure-a
 */
export function formatDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Format a Date object as 'HH:MM:SS'.
 * @param {Date} date
 * @returns {string}
 * @purity semi-pure-a
 */
export function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Show a transient toast message at the top-center of the viewport.
 * @param {string} msg
 * @param {number} durationMs
 * @purity non-pure
 */
export function showToast(msg, durationMs) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

/**
 * Apply or remove the 'dark' class on document.body.
 * @param {'light'|'dark'} theme
 * @purity non-pure
 */
export function applyTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
}

/**
 * Read OS/browser color-scheme preference and apply it.
 * @returns {'light'|'dark'}
 * @purity semi-pure-b
 */
export function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply the OS/browser color-scheme preference.
 * @purity non-pure
 */
export function applySystemTheme() {
  applyTheme(systemTheme());
}

/**
 * Wait until the element's size stops changing before restoring scroll position.
 * @param {HTMLElement} element
 * @param {number} timeout
 * @returns {Promise<boolean>}
 * @purity non-pure
 */
export async function waitForDOMStability(
  element,
  timeout = CONFIG.rendering.stabilityTimeout,
) {
  /** @purity non-pure */
  return new Promise((resolve) => {
    let resizeTimer;
    let timeoutTimer;

    /** @purity non-pure */
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      /** @purity non-pure */
      resizeTimer = setTimeout(() => {
        cleanup();
        resolve(true);
      }, CONFIG.rendering.stabilityDebounce);
    });

    /** @purity non-pure */
    const cleanup = () => {
      resizeObserver.disconnect();
      clearTimeout(resizeTimer);
      clearTimeout(timeoutTimer);
    };

    resizeObserver.observe(element);

    /** @purity non-pure */
    timeoutTimer = setTimeout(() => {
      cleanup();
      console.warn(
        "DOM stability timeout after",
        timeout,
        "ms (continuing anyway)",
      );
      resolve(false);
    }, timeout);
  });
}

/**
 * All elements matching selector under one root or a list of roots.
 * @param {ParentNode|ParentNode[]} roots
 * @param {string} selector
 * @returns {Element[]}
 * @purity semi-pure-b
 */
export function queryAllIn(roots, selector) {
  const list = Array.isArray(roots) ? roots : [roots];
  return list.flatMap((root) => [...root.querySelectorAll(selector)]);
}

/**
 * Replace a code block element (and its pre parent if present) with newElement.
 * @param {HTMLElement} block
 * @param {HTMLElement} newElement
 * @purity non-pure
 */
export function replaceCodeBlock(block, newElement) {
  const pre = block.parentElement;
  if (pre && pre.tagName === "PRE") {
    pre.replaceWith(newElement);
  } else {
    block.replaceWith(newElement);
  }
}

/**
 * The platform whose primary shortcut modifier is Cmd (INV-14): macOS, iOS
 * and iPadOS.
 * @purity pure
 * @param {{userAgentData?: {platform?: string}, platform?: string}} nav - navigator
 * @returns {boolean}
 */
export function isApplePlatform(nav) {
  const platform = nav?.userAgentData?.platform;
  if (platform) return platform === "macOS";
  return /Mac|iPhone|iPad/.test(nav?.platform ?? "");
}

/**
 * INV-14 (2): the letter of a primary-modifier shortcut (INV-58 to INV-60),
 * or null. The primary modifier is Cmd alone on Apple platforms and Ctrl
 * alone elsewhere; Alt (also AltGr, which arrives as Ctrl+Alt) and IME
 * composition are never shortcuts. The letter is event.key in lower case;
 * only when that is not a Latin letter (Russian and other layouts) is
 * event.code (KeyS ...) used. A repeat still has its letter: the caller
 * stops its default and runs nothing (owner ruling, 2026-10-21).
 * @purity pure
 * @param {{key: string, code?: string, ctrlKey: boolean, metaKey: boolean,
 *   altKey: boolean, isComposing?: boolean, keyCode?: number}} e
 * @param {boolean} isApple
 * @returns {string|null} "a" to "z"
 */
export function shortcutLetter(e, isApple) {
  const primary = isApple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!primary || e.altKey || e.isComposing || e.keyCode === 229) return null;
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if (/^[a-z]$/.test(key)) return key;
  const m = /^Key([A-Z])$/.exec(e.code ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * Run cb in the next animation frame (a short timer where there is none,
 * e.g. jsdom). Returns the id for cancelFrame.
 * @purity non-pure
 * @param {() => void} cb
 * @returns {number}
 */
export function nextFrame(cb) {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16);
}

/**
 * INV-14: a key typed into an input, a textarea (the block editor included),
 * a contenteditable element or a role="toolbar" (the edit palette) is not a
 * document shortcut. The role is checked as written (ruling T2). The same
 * focus keeps a block range (INV-74 (1)) from being made.
 * @purity semi-pure-b
 * @param {Element|null} el - the focused element
 * @returns {boolean}
 */
export function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === "function" && el.closest('[role="toolbar"]') !== null;
}

/**
 * @purity non-pure
 * @param {number} id - from nextFrame
 */
export function cancelFrame(id) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}
