import { CONFIG } from "./config.js";

// ========================================
// Utility Functions
// ========================================

/**
 * Escape HTML special characters to prevent injection in innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format a timestamp (milliseconds since epoch) as 'YYYY-MM-DD HH:MM:SS'.
 * @param {number} ms
 * @returns {string}
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
 */
export function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Show a transient toast message at the top-center of the viewport.
 * @param {string} msg
 * @param {number} durationMs
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
 */
export function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply the OS/browser color-scheme preference.
 */
export function applySystemTheme() {
  applyTheme(systemTheme());
}

/**
 * Wait until the element's size stops changing before restoring scroll position.
 * @param {HTMLElement} element
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
export async function waitForDOMStability(
  element,
  timeout = CONFIG.rendering.stabilityTimeout,
) {
  return new Promise((resolve) => {
    let resizeTimer;
    let timeoutTimer;

    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        cleanup();
        resolve(true);
      }, CONFIG.rendering.stabilityDebounce);
    });

    const cleanup = () => {
      resizeObserver.disconnect();
      clearTimeout(resizeTimer);
      clearTimeout(timeoutTimer);
    };

    resizeObserver.observe(element);

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
 * Replace a code block element (and its pre parent if present) with newElement.
 * @param {HTMLElement} block
 * @param {HTMLElement} newElement
 */
export function replaceCodeBlock(block, newElement) {
  const pre = block.parentElement;
  if (pre && pre.tagName === "PRE") {
    pre.replaceWith(newElement);
  } else {
    block.replaceWith(newElement);
  }
}
