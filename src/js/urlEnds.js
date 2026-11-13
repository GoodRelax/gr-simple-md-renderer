/**
 * Spec: INV-19, INV-110 (2). The URL without the characters that URL parsing strips from both ends: C0 controls
 * (U+0000 to U+001F) and SPACE. Other spaces, such as U+00A0 or U+3000, stay.
 * Why: The same characters as the browser keep a URL pointing where the browser sends it
 * @purity pure
 * @param {string} url
 * @returns {string}
 */
export function stripUrlEnds(url) {
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start++;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--;
  return url.slice(start, end);
}
