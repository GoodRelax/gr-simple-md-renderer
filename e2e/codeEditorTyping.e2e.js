import { inflateSync } from "node:zlib";
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { CONFIG } from "../src/js/config.js";

// Spec: PRT-AJ19, INV-86.
// Why: WebKit has no IME driver, so its compositions are synthetic events in Safari's order

const PAUSE_MS = 500; // Spec: PRT-AJ19.
// Why: the ink of the layer and of the textarea differ at the glyphs' soft edges only
const MAX_DIFFERING_SHARE = 0.35;
const SETTLE_MS = 300; // Why: over the 200 ms of CONFIG.codeEdit.highlightPauseMs, so the pause has come

const JS_TEXT = `/*
 * A sample file.
 * It has a block comment.
 */
function add(a, b) {
  const sum = a + b;
  return sum;
}

function sub(a, b) {
  return a - b;
}

const name = "text";
const count = 42;

export default function run() {
  return add(count, sub(1, 2));
}
`;

const JSON_TEXT = `${JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`key${i}`, i % 2 ? i * 10 : `value${i}`])), null, 2)}\n`;

const KANA = String.fromCharCode(0x3042, 0x3044); // Why: hiragana a, i, by char code, so the file stays ASCII
const FULL_BLOCK = String.fromCharCode(0x2588);

const ITEMS = 1130;
const TOKENS = ITEMS * 4;
const ONE_LINE = `[${Array.from({ length: ITEMS }, (_, i) => `{"id":${i},"name":"item${i}"}`).join(",")}]`;
const ONE_LINE_KANA = `[${Array.from({ length: 1300 }, (_, i) => `{"id":${i},"name":"${KANA}${KANA[0]}${i}"}`).join(",")}]`;
const ONE_LINE_MOSTLY_KANA = `[${Array.from({ length: 420 }, (_, i) => `{"name":"${KANA.repeat(30)}${i}"}`).join(",")}]`;
const ONE_LINE_TABS = ONE_LINE.replaceAll(',"name"', ',\t"name"');
const DARK_STRING = [165, 214, 255];
// Why: WebKit's text past 5,000 characters, a tenth of it kana, stands 8 px off (measured); a known limit (spec 5.19.12)
const WEBKIT_KANA_LIMIT_PX = 10;

// Section: files and the editor

async function drop(page, name, content) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { lastModified: Date.now() }));
      return dt;
    },
    { name, content },
  );
  await page.dispatchEvent("#preview", "dragover", { dataTransfer });
  await page.dispatchEvent("#preview", "drop", { dataTransfer });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
}

const editor = (page) => page.locator("#codeEditBody textarea.code-edit-input");

async function openEditor(page) {
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();
}

async function leaveEditor(page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("e");
  await expect(page.locator("#codeEditBody")).toHaveCount(0);
}

const caretAfter = (page, needle) =>
  editor(page).evaluate((ta, text) => {
    const at = ta.value.indexOf(text) + text.length;
    ta.setSelectionRange(at, at);
    return ta.value.slice(0, at).split("\n").length - 1;
  }, needle);

async function installProbes(page) {
  await page.evaluate(() => {
    const root = document.querySelector("#codeEditBody");
    const ta = root.querySelector("textarea");
    const layer = root.querySelector(".code-edit-layer");
    // Why: both float over the editor and change on their own (a fade, the saved mark), not the text
    for (const id of ["#keyHint", "#editPalette"]) document.querySelector(id).style.visibility = "hidden";
    ta.style.caretColor = "transparent"; // Why: it blinks, and WebKit's stands higher than the line's text
    const chunkTokens = () => [...layer.querySelectorAll(".code-edit-chunk")].reduce((sum, chunk) => sum + JSON.parse(chunk.getAttribute("data-tokens") ?? "[]").length, 0);
    const lines = () => [...layer.querySelectorAll(".code-edit-block")].flatMap((block) => block.innerHTML.split("\n").slice(0, -1));
    const look = () => ({
      shown: getComputedStyle(layer).visibility === "visible",
      transparent: getComputedStyle(ta).color === "rgba(0, 0, 0, 0)",
      holdsText: layer.textContent === ta.value + "\n",
    });
    const rangeOver = (start, end) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let started = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const next = seen + node.data.length;
        if (!started && next > start) {
          range.setStart(node, start - seen);
          started = true;
        }
        if (started && next >= end) {
          range.setEnd(node, end - seen);
          return range;
        }
        seen = next;
      }
      return null;
    };
    window.__probe = {
      line: (index) => lines()[index] ?? null,
      lineWith: (needle) => lines().find((html) => new DOMParser().parseFromString(html, "text/html").body.textContent.includes(needle)) ?? null,
      lineCount: () => lines().length,
      look,
      rectOf(needle) {
        const start = (layer.textContent ?? "").indexOf(needle);
        const rect = rangeOver(start, start + needle.length).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      centerOn(offset) {
        const preview = document.querySelector("#preview");
        preview.scrollLeft += rangeOver(offset, offset + 1).getBoundingClientRect().x - 640;
      },
      colorOf(selector, text) {
        const el = [...layer.querySelectorAll(selector)].find((node) => node.textContent.includes(text));
        return el ? getComputedStyle(el).color : null;
      },
      plainColor: () => getComputedStyle(root).color,
      tokenCount: chunkTokens,
      // Spec: INV-86 (e).
      coloredTexts: (group) => [...(CSS.highlights.get(`grsmd-code-${group}`) ?? [])].map((range) => range.startContainer.data.slice(range.startOffset, range.endOffset)),
      rangeCount: () => [...(CSS.highlights ?? new Map())].reduce((sum, [name, ranges]) => sum + (name.startsWith("grsmd-code-") ? ranges.size : 0), 0),
      spanCount: (selector) => layer.querySelectorAll(selector).length,
      // Why: a chunk on the screen with tokens and no range would show white for a frame
      uncoloredOnScreen() {
        const ranged = new Set([...(CSS.highlights ?? new Map())].flatMap(([name, ranges]) => (name.startsWith("grsmd-code-") ? [...ranges].map((range) => range.startContainer) : [])));
        return [...layer.querySelectorAll(".code-edit-chunk")].filter((chunk) => {
          const rect = chunk.getBoundingClientRect();
          const onScreen = rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
          return onScreen && chunk.getAttribute("data-tokens") !== "[]" && !ranged.has(chunk.firstChild);
        }).length;
      },
      spacing: () => getComputedStyle(ta).letterSpacing,
      background: () => getComputedStyle(root).backgroundColor,
      underlined: () => CSS.highlights?.get("grsmd-code-composing")?.values().next().value?.toString() ?? null,
      // Spec: PRT-AJ19.
      watch({ skipLine = -1, goingLine = -1, minTokens = 0 } = {}) {
        const others = lines().filter((_, index) => index !== skipLine && index !== goingLine);
        // Why: Enter makes two inputs (the line feed and the indent), so frames are counted per keydown
        const seen = { frames: 0, keys: 0, bad: [], typed: [], checkedAfterKey: [], skipped: 0 };
        const check = (where) => {
          const state = look();
          const now = new Set(lines());
          const lost = others.filter((html) => !now.has(html)).length;
          const tokens = chunkTokens();
          const uncolored = where === "frame" ? window.__probe.uncoloredOnScreen() : 0;
          if (!state.shown || !state.transparent || !state.holdsText || lost > 0 || tokens < minTokens || uncolored > 0) seen.bad.push({ where, ...state, lost, tokens, uncolored });
        };
        const onKeyDown = () => seen.checkedAfterKey.push(0);
        window.addEventListener("keydown", onKeyDown, { capture: true });
        const onInput = () => {
          seen.keys++;
          check("key");
          seen.typed.push(skipLine >= 0 ? lines()[skipLine] : null);
        };
        window.addEventListener("input", onInput);
        let running = true;
        // Why: read after the frame's callbacks, unless a scroll or a key came in between, to see what it painted
        const place = () => {
          const preview = document.querySelector("#preview");
          return `${preview.scrollLeft},${preview.scrollTop},${window.scrollX},${window.scrollY},${seen.keys}`;
        };
        let framePlace = "";
        const afterFrame = new MessageChannel();
        afterFrame.port1.onmessage = () => {
          if (!running) return;
          if (place() !== framePlace) {
            seen.skipped++;
            return;
          }
          check("frame");
          if (seen.checkedAfterKey.length > 0) seen.checkedAfterKey[seen.checkedAfterKey.length - 1]++;
        };
        const frame = () => {
          if (!running) return;
          seen.frames++;
          framePlace = place();
          afterFrame.port2.postMessage(0);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        window.__probe.stop = () => {
          running = false;
          window.removeEventListener("input", onInput);
          window.removeEventListener("keydown", onKeyDown, { capture: true });
          return seen;
        };
      },
    };
  });
}

const probe = (page, name, ...args) => page.evaluate(([name, args]) => window.__probe[name](...args), [name, args]);

/**
 * Why: a frame is skipped when a scroll or a key comes in between, so each key needs one frame read
 */
function expectCleanWatch(seen, inputs) {
  expect(seen.bad).toEqual([]);
  expect(seen.keys).toBe(inputs);
  expect(seen.checkedAfterKey.length).toBeGreaterThan(0);
  expect(seen.checkedAfterKey.every((count) => count >= 1), `frames read after each key: ${seen.checkedAfterKey}, skipped ${seen.skipped}`).toBe(true);
}

// Section: the pixels of the screen

function decodePng(png) {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "IHDR") {
      width = png.readUInt32BE(at + 8);
      height = png.readUInt32BE(at + 12);
      channels = png[at + 17] === 6 ? 4 : 3;
    }
    if (type === "IDAT") data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const row = new Uint8Array(stride);
  const prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const a = i >= channels ? row[i - channels] : 0;
      const b = prior[i];
      const c = i >= channels ? prior[i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (value + predicted) & 255;
    }
    prior.set(row);
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = row[x * channels];
      out[(y * width + x) * 4 + 1] = row[x * channels + 1];
      out[(y * width + x) * 4 + 2] = row[x * channels + 2];
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, pixels: out };
}

const rgb = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);

async function screen(page) {
  const box = await page.locator("#codeEditBody").boundingBox();
  const size = page.viewportSize();
  const clip = { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.ceil(box.y)) };
  clip.width = Math.min(size.width, Math.floor(box.x + box.width)) - clip.x;
  clip.height = Math.min(size.height, Math.floor(box.y + box.height)) - clip.y;
  // Why: hiding the caret adds a style element, which the page's CSP refuses
  const image = decodePng(await page.screenshot({ clip, caret: "initial", scale: "css" }));
  return { ...image, left: clip.x, top: clip.y };
}

function changedPixels(a, b, skip) {
  let changed = 0;
  const from = skip ? Math.floor(skip.y) - a.top - 3 : -1;
  const to = skip ? Math.ceil(skip.y + skip.height) - a.top + 3 : -1;
  for (let y = 0; y < Math.min(a.height, b.height); y++) {
    if (y >= from && y <= to) continue;
    for (let x = 0; x < Math.min(a.width, b.width); x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      if (a.pixels[i] !== b.pixels[j] || a.pixels[i + 1] !== b.pixels[j + 1] || a.pixels[i + 2] !== b.pixels[j + 2]) changed++;
    }
  }
  return changed;
}

function pixelsNear(image, rect, color, reach = 48) {
  let count = 0;
  const x0 = Math.max(0, Math.floor(rect.x) - image.left);
  const y0 = Math.max(0, Math.floor(rect.y) - image.top);
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width) - image.left);
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height) - image.top);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      if (Math.abs(image.pixels[i] - color[0]) <= reach && Math.abs(image.pixels[i + 1] - color[1]) <= reach && Math.abs(image.pixels[i + 2] - color[2]) <= reach) count++;
    }
  }
  return count;
}

async function expectWordColored(page, image, word, selector) {
  const rect = await probe(page, "rectOf", word);
  const color = await probe(page, "colorOf", selector, word);
  expect(color).not.toBeNull();
  const plain = await probe(page, "plainColor");
  expect(color).not.toBe(plain);
  expect(pixelsNear(image, rect, rgb(color))).toBeGreaterThan(3);
  expect(pixelsNear(image, rect, rgb(plain), 24)).toBe(0);
}

function hasUnderline(image, rect, background) {
  const x0 = Math.floor(rect.x) - image.left + 1;
  const x1 = Math.ceil(rect.x + rect.width) - image.left - 1;
  const bottom = Math.ceil(rect.y + rect.height) - image.top + 2;
  for (let y = Math.floor(rect.y + rect.height * 0.6) - image.top; y < Math.min(bottom, image.height); y++) {
    let ink = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      if (Math.abs(image.pixels[i] - background[0]) + Math.abs(image.pixels[i + 1] - background[1]) + Math.abs(image.pixels[i + 2] - background[2]) > 60) ink++;
    }
    if (ink >= (x1 - x0) * 0.9) return true;
  }
  return false;
}

function inkMask(image, background) {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i++) {
    const distance = Math.abs(image.pixels[i * 4] - background[0]) + Math.abs(image.pixels[i * 4 + 1] - background[1]) + Math.abs(image.pixels[i * 4 + 2] - background[2]);
    mask[i] = distance > 120 ? 1 : 0;
  }
  return mask;
}

/**
 * Why: the two match glyph for glyph only when they are laid out the same
 */
async function bestShift(page) {
  const background = rgb(await probe(page, "background"));
  const layered = await screen(page);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.add("code-edit-plain"));
  const plain = await screen(page);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.remove("code-edit-plain"));
  const a = inkMask(layered, background);
  const b = inkMask(plain, background);
  const [width, height] = [layered.width, layered.height];
  let best = { dx: 0, dy: 0, differing: Infinity };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let differing = 0;
      for (let y = 3; y < height - 3; y++) {
        for (let x = 3; x < width - 3; x++) if (a[y * width + x] !== b[(y + dy) * width + x + dx]) differing++;
      }
      if (differing < best.differing) best = { dx, dy, differing };
    }
  }
  const ink = a.reduce((sum, value) => sum + value, 0);
  expect(ink).toBeGreaterThan(100);
  return { dx: best.dx, dy: best.dy, differingShare: Number((best.differing / ink).toFixed(3)) };
}

async function expectTextInPlace(page) {
  const shift = await bestShift(page);
  expect(shift).toMatchObject({ dx: 0, dy: 0 });
  expect(shift.differingShare).toBeLessThanOrEqual(MAX_DIFFERING_SHARE);
}

// Section: IME compositions

/** Why: Chromium's real input pipeline is reached through the DevTools protocol */
async function realComposition(page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    start: async () => {},
    update: (text) => cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length }),
    commit: (text) => cdp.send("Input.insertText", { text }),
  };
}

/** Why: WebKit has no IME driver, so synthetic events in Safari's order */
async function syntheticComposition(page) {
  const event = (kind, inputType, data) =>
    page.evaluate(
      ([kind, inputType, data]) => {
        const ta = document.querySelector("#codeEditBody textarea");
        const state = (window.__composition ??= { at: ta.selectionStart, length: 0 });
        const options = { bubbles: true, data };
        if (kind === "start") {
          ta.dispatchEvent(new CompositionEvent("compositionstart", { ...options, data: "" }));
          return;
        }
        if (kind === "end") {
          ta.dispatchEvent(new CompositionEvent("compositionend", options));
          delete window.__composition;
          return;
        }
        const input = { ...options, inputType, isComposing: true };
        ta.dispatchEvent(new InputEvent("beforeinput", input));
        ta.setRangeText(data, state.at, state.at + state.length, "end");
        state.length = data.length;
        if (kind === "update") ta.dispatchEvent(new CompositionEvent("compositionupdate", options));
        ta.dispatchEvent(new InputEvent("input", input));
      },
      [kind, inputType, data],
    );
  return {
    start: () => event("start", "", ""),
    update: (text) => event("update", "insertCompositionText", text),
    commit: async (text) => {
      await event("replace", "deleteCompositionText", "");
      await event("replace", "insertFromComposition", text);
      await event("end", "", text);
    },
  };
}

// Section: the PRT's steps

for (const round of [
  { theme: "dark", typed: "const z = 5;", digit: "5", comment: "abc" },
  { theme: "light", typed: "const w = 7;", digit: "7", comment: "def" },
]) {
  async function typeWithPauses(page, keys, skip, base) {
    for (const key of keys) {
      const began = Date.now();
      await page.keyboard.press(key);
      const now = await screen(page);
      expect(changedPixels(base, now, await skip())).toBe(0);
      await page.waitForTimeout(Math.max(0, PAUSE_MS - (Date.now() - began)));
    }
  }
  const spelled = (text) => [...text].map((c) => (c === " " ? "Space" : c));

  async function typingSteps(page, { typed, digit, comment }) {
    await installProbes(page);
    const line = await caretAfter(page, "const sum = a + b;");
    const rowOf = (needle) => () => probe(page, "rectOf", needle);
    const base = await screen(page);

    // Spec: PRT-AJ19 step 1.
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
    await typeWithPauses(page, spelled(typed), rowOf("const sum"), base);
    const keyed = await probe(page, "stop");
    expectCleanWatch(keyed, typed.length);
    const word = '<span class="hljs-keyword">const</span>';
    expect(keyed.typed[4].split(word)).toHaveLength(3);
    expect(keyed.typed[typed.length - 2]).toContain(`<span class="hljs-number">${digit}</span>`);
    await page.waitForTimeout(SETTLE_MS);
    const number = await probe(page, "rectOf", `${typed}`);
    const numberRect = { ...number, x: number.x + (number.width * (typed.length - 2)) / typed.length, width: number.width / typed.length };
    const numberColor = rgb(await probe(page, "colorOf", ".hljs-number", digit));
    await expect.poll(async () => pixelsNear(await screen(page), numberRect, numberColor)).toBeGreaterThan(3);
    const shown = await screen(page);
    await expectWordColored(page, shown, "function", ".hljs-keyword");
    expect(pixelsNear(shown, numberRect, rgb(await probe(page, "plainColor")), 24)).toBe(0);

    // Spec: PRT-AJ19 step 2.
    const value = await editor(page).inputValue();
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(PAUSE_MS);
    await expect(editor(page)).toHaveValue(value.replace(`${typed}\n`, `${typed}\n  \n`)); // Spec: INV-87.
    await expect.poll(() => probe(page, "lineCount")).toBe(value.split("\n").length + 1);
    expectCleanWatch(await probe(page, "stop"), 2);
    await expectTextInPlace(page);
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine, goingLine: skipLine + 1 }), line);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(PAUSE_MS);
    }
    await expect(editor(page)).toHaveValue(value);
    expectCleanWatch(await probe(page, "stop"), 3);
    await expectTextInPlace(page);

    // Spec: PRT-AJ19 step 3.
    const commentLine = await caretAfter(page, "A sample file.");
    const before = await screen(page);
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), commentLine);
    await typeWithPauses(page, [...comment], rowOf("A sample file."), before);
    const inComment = await probe(page, "stop");
    expectCleanWatch(inComment, 3);
    for (const html of inComment.typed) expect(html).toContain('class="hljs-comment"');
    await page.waitForTimeout(SETTLE_MS);
    const commentRect = await probe(page, "rectOf", `file.${comment}`);
    const commentColor = rgb(await probe(page, "colorOf", ".hljs-comment", `file.${comment}`));
    await expect.poll(async () => pixelsNear(await screen(page), commentRect, commentColor)).toBeGreaterThan(3);
    expect(pixelsNear(await screen(page), commentRect, rgb(await probe(page, "plainColor")), 24)).toBe(0);
  }

  test(`INV-86, PRT-AJ19 steps 1 to 3 (${round.theme}): a .js, one key each half second: the text colored at once, the other lines the same on every frame and on the screen, Enter and Backspace keep the characters in place, the block comment's color`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await drop(page, "sample.js", JS_TEXT);
    if (round.theme === "light") {
      await page.locator("#renderLight").click();
      await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
    }
    await openEditor(page);
    await typingSteps(page, round);
  });
}

test("INV-86, PRT-AJ19 step 4: after the dark round, leave edit mode, [Light], [Edit]: the same typing keeps the text colored and the other lines unchanged", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await drop(page, "sample.js", JS_TEXT);
  await openEditor(page);
  await page.keyboard.type("x");
  await page.waitForTimeout(SETTLE_MS);
  await leaveEditor(page);
  await page.locator("#renderLight").click();
  await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await page.locator("#editBtn").click();
  await expect(editor(page)).toBeFocused();
  await installProbes(page);
  const line = await caretAfter(page, "return sum;");
  const base = await screen(page);
  await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
  await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    const at = ta.value.indexOf("return sum;");
    ta.setSelectionRange(at, at);
  });
  for (const key of ["l", "e", "t", "Space"]) {
    await page.keyboard.press(key);
    expect(changedPixels(base, await screen(page), await probe(page, "rectOf", "return sum;"))).toBe(0);
    await page.waitForTimeout(PAUSE_MS);
  }
  const typed = await probe(page, "stop");
  expectCleanWatch(typed, 4);
  expect(typed.typed[3]).toContain('<span class="hljs-keyword">let</span>');
  const shown = await screen(page);
  await expectWordColored(page, shown, "function", ".hljs-keyword");
  await expect.poll(() => probe(page, "lineWith", "let return sum;")).toContain('<span class="hljs-keyword">let</span>');
  await expectTextInPlace(page);
});

for (const driver of ["DevTools protocol", "synthetic events"]) {
  test(`INV-86 (c), PRT-AJ19 step 5 (${driver}): a composition in a .json's string value: underlined on the screen, the other lines the same; committed: no underline, the text in the string's color, in place`, async ({ page, browserName }) => {
    test.skip(driver === "DevTools protocol" && browserName !== "chromium", "the protocol's IME input is Chromium's");
    await page.goto("/");
    await drop(page, "data.json", JSON_TEXT);
    await openEditor(page);
    await installProbes(page);
    const line = await caretAfter(page, '"value2');
    const compose = driver === "synthetic events" ? await syntheticComposition(page) : await realComposition(page);
    const base = await screen(page);
    const background = rgb(await probe(page, "background"));
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);

    await compose.start();
    await compose.update(KANA[0]);
    await compose.update(KANA);
    await expect.poll(() => probe(page, "underlined")).toBe(KANA);
    await page.waitForTimeout(PAUSE_MS);
    expect(await probe(page, "underlined")).toBe(KANA);
    const composing = await screen(page);
    const rect = await probe(page, "rectOf", KANA);
    expect(hasUnderline(composing, rect, background)).toBe(true);
    expect(changedPixels(base, composing, rect)).toBe(0);
    expect(await probe(page, "lineWith", KANA)).toContain('class="hljs-string"');

    await compose.commit(KANA);
    await expect(editor(page)).toHaveValue(JSON_TEXT.replace('"value2', `"value2${KANA}`));
    await expect.poll(() => probe(page, "underlined")).toBeNull();
    await page.waitForTimeout(PAUSE_MS);
    const seen = await probe(page, "stop");
    expect(seen.bad).toEqual([]);
    const kanaRect = await probe(page, "rectOf", KANA);
    const color = await probe(page, "colorOf", ".hljs-string", KANA);
    expect(color).not.toBe(await probe(page, "plainColor"));
    await expect.poll(async () => pixelsNear(await screen(page), kanaRect, rgb(color))).toBeGreaterThan(3);
    expect(hasUnderline(await screen(page), kanaRect, background)).toBe(false);
    await expectTextInPlace(page);
  });
}

const noCssHighlights = () => {
  delete window.Highlight;
  Object.defineProperty(CSS, "highlights", { value: undefined, configurable: true });
};

test("INV-86 (c), PRT-AJ19 step 10 (below Safari 17.2, no CSS highlights): a composition shows no underline and no error, the layer follows the text", async ({ page }) => {
  await page.addInitScript(noCssHighlights);
  await page.goto("/");
  await drop(page, "data.json", JSON_TEXT);
  await openEditor(page);
  await installProbes(page);
  const line = await caretAfter(page, '"value2');
  const compose = await syntheticComposition(page);
  await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
  await compose.start();
  await compose.update(KANA);
  await page.waitForTimeout(SETTLE_MS);
  expect(await probe(page, "underlined")).toBeNull();
  await compose.commit(KANA);
  await expect(editor(page)).toHaveValue(JSON_TEXT.replace('"value2', `"value2${KANA}`));
  await page.waitForTimeout(SETTLE_MS);
  expect((await probe(page, "stop")).bad).toEqual([]);
});

test("INV-86 (e), below Safari 17.2: a long line keeps its spans, so its colors, and typing writes into them", async ({ page }) => {
  await page.addInitScript(noCssHighlights);
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  expect(await probe(page, "spanCount", ".code-edit-chunk")).toBe(0);
  expect(await probe(page, "spanCount", ".hljs-string")).toBeGreaterThanOrEqual(ITEMS);
  const line = await caretAfter(page, '"name":"item565');
  await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
  await page.keyboard.press("a");
  await page.waitForTimeout(PAUSE_MS);
  expectCleanWatch(await probe(page, "stop"), 1);
  await expect.poll(() => probe(page, "spanCount", ".hljs-string")).toBeGreaterThanOrEqual(ITEMS);
});

test("INV-86 (e), PRT-AJ19 steps 7 and 8: a one-line JSON of 30 KB: keys in a value in the middle, Enter and Backspace, each after a half second: the line in chunks, colored on every frame and on the screen; each key's character takes the color of its word; the pause gives the typed text its color", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  expect(ONE_LINE.length).toBeGreaterThan(30 * 1000);
  expect(ONE_LINE.length).toBeLessThan(33 * 1000);
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  await caretAfter(page, '"name":"item565');
  await page.evaluate(() => {
    const ta = document.querySelector("#codeEditBody textarea");
    ta.setSelectionRange(ta.selectionStart - 3, ta.selectionStart - 3);
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain('"item565"');
  expect(await probe(page, "spanCount", ".hljs-string")).toBe(0);
  await page.evaluate((minTokens) => window.__probe.watch({ skipLine: 0, minTokens }), TOKENS);
  const coloredNow = async () => {
    const image = await screen(page);
    return pixelsNear(image, { x: image.left, y: image.top, width: image.width, height: image.height }, DARK_STRING);
  };
  for (const [key, word] of [
    ["a", '"itema565"'],
    ["b", '"itemab565"'],
    ["c", '"itemabc565"'],
  ]) {
    await page.keyboard.press(key);
    expect(await probe(page, "coloredTexts", "string")).toContain(word);
    expect(await coloredNow()).toBeGreaterThan(50);
    await page.waitForTimeout(PAUSE_MS);
  }
  await page.keyboard.press("Enter");
  await expect.poll(() => probe(page, "lineCount")).toBe(2);
  expect(await coloredNow()).toBeGreaterThan(50);
  await page.waitForTimeout(PAUSE_MS);
  await page.keyboard.press("Backspace");
  await expect.poll(() => probe(page, "lineCount")).toBe(1);
  expect(await coloredNow()).toBeGreaterThan(50);
  await page.waitForTimeout(PAUSE_MS);
  const seen = await probe(page, "stop");
  expectCleanWatch(seen, 5);
  await expect(editor(page)).toHaveValue(/"itemabc565"/);
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain('"itemabc565"');
});

test("INV-86 (e): only the chunks near the screen have ranges; a scroll to the end of the line finds it colored", async ({ page }) => {
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  await expect.poll(() => probe(page, "rangeCount")).toBeGreaterThan(0);
  expect(await probe(page, "rangeCount")).toBeLessThan(TOKENS / 4);
  await page.evaluate(() => {
    const preview = document.querySelector("#preview");
    preview.scrollLeft = preview.scrollWidth;
  });
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain(`"item${ITEMS - 1}"`);
  expect(await probe(page, "coloredTexts", "string")).not.toContain('"item0"');
  expect(await probe(page, "rangeCount")).toBeLessThan(TOKENS / 4);
  const image = await screen(page);
  expect(pixelsNear(image, { x: image.left, y: image.top, width: image.width, height: image.height }, DARK_STRING)).toBeGreaterThan(50);
});

test("INV-86 (e): the start and jumps show no frame with a chunk uncolored: colored in the start's task, and in the scroll's", async ({ page }) => {
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await page.evaluate(() => {
    window.__startFrames = [];
    const preview = document.querySelector("#preview");
    const uncolored = () => {
      const ranged = new Set([...CSS.highlights].flatMap(([name, ranges]) => (name.startsWith("grsmd-code-") ? [...ranges].map((range) => range.startContainer) : [])));
      return [...document.querySelectorAll("#codeEditBody .code-edit-chunk")].filter((chunk) => {
        const rect = chunk.getBoundingClientRect();
        return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && !ranged.has(chunk.firstChild);
      }).length;
    };
    const frame = () => {
      if (preview.querySelector("#codeEditBody")) window.__startFrames.push(uncolored());
      if (window.__startFrames.length < 10) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await openEditor(page);
  await expect.poll(() => page.evaluate(() => window.__startFrames.length)).toBe(10);
  expect(await page.evaluate(() => window.__startFrames)).toEqual(Array(10).fill(0));
  await installProbes(page);
  await page.evaluate(() => window.__probe.watch());
  for (const place of [1, 0, 0.5, 0.25, 1]) {
    await page.evaluate((place) => {
      const preview = document.querySelector("#preview");
      preview.scrollLeft = (preview.scrollWidth - preview.clientWidth) * place;
    }, place);
    await page.waitForTimeout(150);
  }
  expect((await probe(page, "stop")).bad).toEqual([]);
});

test("INV-86 (e): Enter in a long line and keys before the pause: the layer holds the text on every key and frame, no tag among it; the pause writes it colored", async ({ page }) => {
  // Why: a loaded machine takes over 200 ms between two keys; the held timer keeps every key before the pause, and the frames stay real
  await page.addInitScript((delay) => {
    const realSet = window.setTimeout;
    const realClear = window.clearTimeout;
    const held = new Map();
    let next = -1;
    window.__holdPause = false;
    window.setTimeout = (callback, ms, ...args) => {
      if (!window.__holdPause || ms !== delay) return realSet(callback, ms, ...args);
      held.set(next, callback);
      return next--;
    };
    window.clearTimeout = (id) => (held.delete(id) ? undefined : realClear(id));
    window.__releasePause = () => {
      window.__holdPause = false;
      const callbacks = [...held.values()];
      held.clear();
      for (const callback of callbacks) callback();
    };
  }, CONFIG.codeEdit.highlightPauseMs);
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  const at = ONE_LINE.length - 1500;
  await editor(page).evaluate((ta, at) => {
    ta.blur();
    ta.setSelectionRange(at, at);
    ta.focus();
  }, at);
  await page.waitForTimeout(SETTLE_MS);
  // Why: no other line to keep, so every bad key and frame counts
  await page.evaluate(() => {
    window.__holdPause = true;
    window.__probe.watch({ skipLine: 0 });
    // Why: a key writes no gutter, so each key before the pause sees one line
    const gutter = document.querySelector("#codeEditBody .code-edit-gutter");
    window.__gutterAtKey = [];
    window.addEventListener("input", () => window.__gutterAtKey.push(gutter.textContent.split("\n").filter(Boolean).length));
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zy");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  expect(await page.evaluate(() => document.querySelector("#codeEditBody .code-edit-layer").textContent)).not.toContain("code-edit-chunk");
  expect(await page.evaluate(() => window.__gutterAtKey), "every key came before the pause").toEqual([1, 1, 1, 1, 1]);
  await page.evaluate(() => window.__releasePause());
  await page.waitForTimeout(PAUSE_MS);
  const seen = await probe(page, "stop");
  expect(seen.keys).toBe(5);
  expect(seen.bad).toEqual([]);
  await expect(editor(page)).toHaveValue(`${ONE_LINE.slice(0, at)}\nZy\nx${ONE_LINE.slice(at)}`);
  await expect.poll(() => probe(page, "lineCount")).toBe(3);
});

test("INV-86 (e): keys that take a line over CONFIG.codeEdit.longLineChars, within the pause: the new chunk colored from its key, on every frame and on the screen", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  const head = `{\n  "a": 1,\n  "b": "${"w".repeat(240)}`;
  await drop(page, "near.json", `${head}",\n  "c": 2\n}\n`);
  await openEditor(page);
  await installProbes(page);
  // Why: at the string's start the caret stays on the screen, so no scroll colors the line
  const line = await caretAfter(page, '"b": "');
  expect(await probe(page, "spanCount", ".code-edit-chunk")).toBe(0);
  await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
  for (const key of [..."abcdefghijklmnop"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(PAUSE_MS / 5); // Why: keys within the pause, so no pause colors the line
  }
  const seen = await probe(page, "stop");
  expectCleanWatch(seen, 16);
  expect(await probe(page, "spanCount", ".code-edit-chunk")).toBe(1);
  const image = await screen(page);
  expect(pixelsNear(image, { x: image.left, y: image.top, width: image.width, height: image.height }, DARK_STRING)).toBeGreaterThan(50);
});

test("INV-86 (e): lines removed above a long line far below the screen bring it up with no scroll: colored on every frame", async ({ page }) => {
  await page.goto("/");
  const short = '  "x": 1,\n';
  await drop(page, "far.json", `{\n${short.repeat(60)}  "y": "${"w".repeat(600)}"\n}\n`);
  await openEditor(page);
  await installProbes(page);
  expect(await probe(page, "rangeCount")).toBe(0);
  await editor(page).evaluate((ta, end) => {
    ta.blur();
    ta.setSelectionRange(2, end);
    ta.focus();
  }, 2 + short.length * 50);
  await page.evaluate(() => window.__probe.watch());
  await page.keyboard.press("Delete");
  await page.waitForTimeout(PAUSE_MS);
  const seen = await probe(page, "stop");
  expect(seen.bad).toEqual([]);
  expect(seen.checkedAfterKey[0]).toBeGreaterThanOrEqual(1);
  expect(await probe(page, "rangeCount")).toBeGreaterThan(0);
});

// Spec: INV-86 (b-1)
test("INV-86 (b-1): 46,000 empty lines pasted into a long line, then an edit over two blocks before the pause: the layer follows, no error", async ({ page }) => {
  test.slow(); // Why: the browser lays out 46,000 lines of the layer, seconds each time
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await drop(page, "paste.json", `{\n"a": 1,\n"b": "${"w".repeat(3000)}"\n}\n`);
  await openEditor(page);
  const seen = await editor(page).evaluate((ta) => {
    const layer = document.querySelector("#codeEditBody .code-edit-layer");
    const edit = (text, from, to) => {
      ta.setRangeText(text, from, to, "end");
      ta.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
      return layer.textContent === `${ta.value}\n`;
    };
    const longLine = ta.value.indexOf('"b"');
    const pasted = edit("\n".repeat(46000), longLine + 2500, longLine + 2500);
    const overBlocks = edit("", longLine - 1, longLine);
    return { pasted, overBlocks };
  });
  expect(seen).toEqual({ pasted: true, overBlocks: true });
  // Why: the cut leaves an empty part for each empty line; the pause writes those lines with no part
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("#codeEditBody .code-edit-chunk")].filter((chunk) => chunk.textContent === "").length), { timeout: 30000 }).toBe(0);
  expect(await page.evaluate(() => document.querySelector("#codeEditBody .code-edit-layer").textContent === `${document.querySelector("#codeEditBody textarea").value}\n`)).toBe(true);
  expect(errors).toEqual([]);
});

test("INV-86 (e): the mouse wheel scrolls along a long line: colored on every frame", async ({ page }) => {
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  const box = await page.locator("#codeEditBody").boundingBox();
  await page.mouse.move(box.x + 300, box.y + 40);
  await page.evaluate(() => window.__probe.watch());
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(2500, 0);
    await page.waitForTimeout(100);
  }
  const seen = await probe(page, "stop");
  expect(seen.bad).toEqual([]);
  expect(await page.evaluate(() => document.querySelector("#preview").scrollLeft)).toBeGreaterThan(10000);
  const image = await screen(page);
  expect(pixelsNear(image, { x: image.left, y: image.top, width: image.width, height: image.height }, DARK_STRING)).toBeGreaterThan(50);
});

test("INV-86 (e): a key in a short line beside a long line (the long line has a block of its own), and Search in the long line: the chunks stay colored", async ({ page }) => {
  await page.goto("/");
  await drop(page, "mixed.json", `{\n"a": 1,\n"b": ${ONE_LINE.slice(0, 2000).replace(/,[^,]*$/, "")}}]\n}\n`);
  await openEditor(page);
  await installProbes(page);
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain('"item1"');
  const line = await caretAfter(page, '"a": 1');
  await page.evaluate((skipLine) => {
    window.__probe.watch({ skipLine });
    // Why: read before any frame, so only the handler's work counts
    window.addEventListener("input", () => (window.__coloredAtKey = window.__probe.coloredTexts("string")), { once: true });
  }, line);
  await page.keyboard.press("7");
  expect(await page.evaluate(() => window.__coloredAtKey)).toContain('"item1"');
  await page.waitForTimeout(PAUSE_MS);
  expect((await probe(page, "stop")).bad).toEqual([]);
  await page.keyboard.press("Control+f");
  await page.keyboard.type("item12");
  await expect(page.locator("#searchCount")).toHaveText(/1 \/ \d+/);
  await expect.poll(() => page.evaluate(() => CSS.highlights.get("grsmd-search-current")?.size ?? 0)).toBe(1);
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain('"item1"');
});

test("INV-86 (c)(e): a composition in a long line: underlined there, and committed its text takes the string's color", async ({ page }) => {
  await page.goto("/");
  await drop(page, "min.json", ONE_LINE);
  await openEditor(page);
  await installProbes(page);
  await caretAfter(page, '"name":"item3');
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain('"item3"');
  const compose = await syntheticComposition(page);
  await compose.start();
  await compose.update(KANA);
  await expect.poll(() => probe(page, "underlined")).toBe(KANA);
  expect(await probe(page, "coloredTexts", "string")).toContain(`"item3${KANA}"`);
  await compose.commit(KANA);
  await expect.poll(() => probe(page, "underlined")).toBeNull();
  await expect.poll(() => probe(page, "coloredTexts", "string")).toContain(`"item3${KANA}"`);
});

/**
 * Spec: INV-86 (performance).
 */
async function clockKeys(page) {
  await page.evaluate(() => {
    window.__keys = [];
    let key = null;
    let inExec = 0;
    let inside = 0;
    const exec = document.execCommand.bind(document);
    document.execCommand = (...args) => {
      const began = performance.now();
      inExec++;
      inside = 0;
      const result = exec(...args);
      inExec--;
      if (key) key.browser += performance.now() - began - inside;
      return result;
    };
    const span = (type) => {
      let began = 0;
      window.addEventListener(type, () => (began = performance.now()), { capture: true });
      window.addEventListener(type, () => {
        const took = performance.now() - began;
        if (!key) return;
        if (type !== "keydown" && inExec) inside += took;
        else key.handlers += took;
      });
    };
    for (const type of ["beforeinput", "input", "keydown"]) span(type);
    window.addEventListener(
      "keydown",
      () => {
        const mine = { at: performance.now(), handlers: 0, browser: 0 };
        key = mine;
        window.__keys.push(mine);
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => (mine.frame = performance.now() - mine.at);
          channel.port2.postMessage(0);
        });
      },
      { capture: true },
    );
  });
}

const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];
const percentile95 = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.95)];
// Why: about 3.5 times (Chromium) and 2 times (WebKit) the highest 95th percentile measured alone (spec 5.19.12)
const KEY_TO_FRAME_MS = { chromium: 50, webkit: 250 };

const CODE_LINE = "const value = 1234567890; // a line of a big file\n";
const LONG_URL_LINE = `const u = "https://example.com/${"a/b/".repeat(100)}";\n`;
const JSON_LINE = (i) => `{"id":${i},"name":"item${i}","tags":["a","b","c","d"],"size":{"w":${i},"h":${i}},"text":"${"word ".repeat(30)}","on":true,"off":false,"none":null},\n`;

for (const [label, name, text, needle] of [
  ["a one-line JSON of 30 KB", "min.json", ONE_LINE, '"name":"item565'],
  ["40 KB of lines, typed far from one long line", "url.js", `${CODE_LINE.repeat(400)}${LONG_URL_LINE}${CODE_LINE.repeat(400)}`, "const value = 12"],
  ["40 KB of lines, typed right above one long line", "near.js", `${CODE_LINE.repeat(400)}const near = 1;\n${LONG_URL_LINE}${CODE_LINE.repeat(400)}`, "const near = 1"],
  ["45 KB, 150 lines of 300 characters", "lines.json", Array.from({ length: 150 }, (_, i) => JSON_LINE(i)).join(""), '"id":0,'],
  ["40 KB of lines, typed right above a line of 3 KB of tokens", "nearjson.json", `${'"value": 12345,\n'.repeat(1200)}"near": 1,\n${ONE_LINE.slice(0, 3000)}\n${'"value": 12345,\n'.repeat(1200)}`, '"near": 1'],
]) {
  test(`INV-86 (performance), PRT-AJ19 step 8: ${label}: alone on the machine (npm run test:e2e:perf), the app's work of a key stays at 4 ms (median) and its way to the frame within the limit; every key has its frame`, async ({ page, browserName }) => {
    // Why: a loaded machine says nothing of these times, and the test holds a worker for seconds; tools/e2ePerf.mjs sets GRSMD_PERF=1
    test.skip(process.env.GRSMD_PERF !== "1", "the time of keys runs alone: npm run test:e2e:perf");
    test.setTimeout(60000);
    await page.goto("/");
    await drop(page, name, text);
    await openEditor(page);
    await page.waitForTimeout(SETTLE_MS);
    await editor(page).evaluate((ta, needle) => {
      const at = ta.value.indexOf(needle) + needle.length;
      ta.setSelectionRange(at, at);
      ta.blur();
      ta.focus();
    }, needle);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(SETTLE_MS);
    await clockKeys(page);
    const ranges = await page.evaluate(() => [...CSS.highlights].reduce((sum, [name, set]) => sum + (name.startsWith("grsmd-code-") ? set.size : 0), 0));
    const keys = ["a", "Enter", "Backspace", "b", "Enter", "Backspace"];
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(keys[i % keys.length]);
      await page.waitForTimeout(SETTLE_MS + 50);
    }
    const seen = await page.evaluate(() => window.__keys.map((key) => ({ app: key.handlers - key.browser, frame: key.frame })));
    expect(seen).toHaveLength(18);
    const app = seen.map((key) => key.app);
    const frames = seen.map((key) => key.frame);
    expect(frames.every(Number.isFinite), `a frame after each key: ${frames}`).toBe(true);
    console.log(`PRT-AJ19 ${browserName} ${label}, ${ranges} ranges, ms: the app ${median(app).toFixed(1)} (p95 ${percentile95(app).toFixed(1)}), to the frame ${median(frames).toFixed(1)} (p95 ${percentile95(frames).toFixed(1)})`);
    expect(median(app)).toBeLessThanOrEqual(4);
    expect(median(frames)).toBeLessThanOrEqual(KEY_TO_FRAME_MS[browserName]);
  });
}

function blockMiddle(image, background, minHeight = 12) {
  const mask = inkMask(image, background);
  const tall = new Uint8Array(image.width);
  for (let x = 0; x < image.width; x++) {
    let run = 0;
    for (let y = 0; y < image.height; y++) {
      run = mask[y * image.width + x] ? run + 1 : 0;
      if (run >= minHeight) tall[x] = 1;
    }
  }
  for (let x = 0; x + 5 < image.width; x++) {
    if (!tall.subarray(x, x + 5).every(Boolean)) continue;
    let end = x;
    while (end + 1 < image.width && tall[end + 1]) end++;
    return (x + end) / 2;
  }
  return null;
}

async function driftAt(page, at, background, minHeight) {
  await editor(page).evaluate((ta, at) => {
    ta.blur();
    ta.setSelectionRange(at + 1, at + 1);
    ta.focus();
  }, at);
  await page.waitForTimeout(SETTLE_MS);
  await probe(page, "centerOn", at);
  await probe(page, "centerOn", at); // Why: the first move may stop short at a zoom
  const layered = blockMiddle(await screen(page), background, minHeight);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.add("code-edit-plain"));
  const plain = blockMiddle(await screen(page), background, minHeight);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.remove("code-edit-plain"));
  expect(layered, `the mark at ${at} on the layer`).toEqual(expect.any(Number));
  expect(plain, `the mark at ${at} in the textarea`).toEqual(expect.any(Number));
  return layered - plain;
}

const PLACES = [200, 500, 1000, 2000, 5000, 15000, 29000];
const marked = (text, places = PLACES) => places.reduce((line, at) => `${line.slice(0, at)}${FULL_BLOCK}${line.slice(at + 1)}`, text);

async function driftsOf(page, text, minHeight, places = PLACES) {
  await drop(page, "min.json", marked(text, places));
  await openEditor(page);
  await installProbes(page);
  const background = rgb(await probe(page, "background"));
  const drifts = {};
  for (const at of places) drifts[at] = await driftAt(page, at, background, minHeight);
  return { drifts, background };
}

for (const [label, text] of [
  ["ASCII", ONE_LINE],
  ["tabs", ONE_LINE_TABS],
]) {
  test(`INV-86 (e), PRT-AJ19 step 9: a one-line JSON of 30 KB (${label}): the colored layer stays over the textarea's text all along the line, and after typing, Enter and Backspace`, async ({ page, browserName }) => {
    test.setTimeout(60000);
    await page.goto("/");
    const { drifts, background } = await driftsOf(page, text);
    console.log(`PRT-AJ19 ${browserName} ${label}, layer minus textarea, px, at a place in the line: ${JSON.stringify(drifts)}`);
    for (const at of PLACES) expect(Math.abs(drifts[at]), `at ${at}`).toBeLessThanOrEqual(1);
    await editor(page).evaluate((ta) => {
      ta.blur();
      ta.setSelectionRange(14995, 14995);
      ta.focus();
    });
    await page.keyboard.press("a");
    await page.keyboard.press("b");
    expect(Math.abs(await driftAt(page, 15002, background)), "after two keys").toBeLessThanOrEqual(1);
    await editor(page).evaluate((ta) => {
      ta.blur();
      ta.setSelectionRange(14997, 14997);
      ta.focus();
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(SETTLE_MS);
    await editor(page).evaluate((ta) => {
      ta.blur();
      ta.setSelectionRange(14998, 14998);
      ta.focus();
    });
    await page.keyboard.press("Backspace");
    expect(Math.abs(await driftAt(page, 15002, background)), "after Enter and Backspace").toBeLessThanOrEqual(1);
  });
}

const ONE_LINE_48K = (() => {
  let items = ITEMS;
  const of = (count) => `[${Array.from({ length: count }, (_, i) => `{"id":${i},"name":"item${i}"}`).join(",")}]`;
  while (of(items + 1).length <= 48 * 1024) items++;
  return of(items);
})();
const PLACES_48K = [...PLACES, 40000, 48000];

test("INV-86 (e), PRT-AJ19 step 9: a one-line JSON of 48 KB, the longest colored text: the layer stays over the textarea's text all along the line", async ({ page, browserName }) => {
  test.setTimeout(60000);
  await page.goto("/");
  expect(ONE_LINE_48K.length).toBeGreaterThan(48000);
  const { drifts } = await driftsOf(page, ONE_LINE_48K, undefined, PLACES_48K);
  console.log(`PRT-AJ19 ${browserName} 48 KB, layer minus textarea, px, at a place in the line: ${JSON.stringify(drifts)}`);
  for (const at of PLACES_48K) expect(Math.abs(drifts[at]), `at ${at}`).toBeLessThanOrEqual(1);
});

test("INV-86 (e), PRT-AJ19 step 9: a one-line JSON of 35 KB with kana: the layer stays over the textarea's text; WebKit's known limit past 5,000 characters (spec 5.19.12)", async ({ page, browserName }) => {
  test.setTimeout(60000);
  await page.goto("/");
  const { drifts } = await driftsOf(page, ONE_LINE_KANA);
  console.log(`PRT-AJ19 ${browserName} kana, layer minus textarea, px, at a place in the line: ${JSON.stringify(drifts)}`);
  for (const at of PLACES) expect(Math.abs(drifts[at]), `at ${at}`).toBeLessThanOrEqual(browserName === "webkit" && at > 5000 ? WEBKIT_KANA_LIMIT_PX : 1);
});

test("INV-86 (e), PRT-AJ19 step 9: while keys go on, before the pause, the layer stays over the textarea's text", async ({ page }) => {
  test.setTimeout(60000);
  // Why: Playwright's clock, paused before the keys: two screenshots can take over 200 ms in WebKit, and the pause's timer must not come
  await page.clock.install();
  await page.goto("/");
  await drop(page, "min.json", marked(ONE_LINE));
  await openEditor(page);
  await installProbes(page);
  const background = rgb(await probe(page, "background"));
  await page.waitForTimeout(SETTLE_MS);
  await editor(page).evaluate((ta) => {
    ta.blur();
    ta.setSelectionRange(14990, 14990);
    ta.focus();
  });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  // Why: the block the pause would write again; it must still be in the layer after the screens
  await page.evaluate(() => (window.__chunkBefore = document.querySelector("#codeEditBody .code-edit-block")));
  await page.keyboard.press("a");
  await page.keyboard.press("b");
  await probe(page, "centerOn", 15002);
  const layered = blockMiddle(await screen(page), background);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.add("code-edit-plain"));
  const plain = blockMiddle(await screen(page), background);
  await page.evaluate(() => document.querySelector("#codeEditBody").classList.remove("code-edit-plain"));
  expect(await page.evaluate(() => window.__chunkBefore.isConnected), "read before the pause").toBe(true);
  expect(layered).toEqual(expect.any(Number));
  expect(plain).toEqual(expect.any(Number));
  expect(Math.abs(layered - plain)).toBeLessThanOrEqual(1);
  await page.clock.runFor(SETTLE_MS);
  await expect.poll(() => page.evaluate(() => window.__chunkBefore.isConnected), "the pause comes after it").toBe(false);
});

test("INV-86 (e), PRT-AJ19 step 9: keys that take a line over CONFIG.codeEdit.snapLineChars: no spacing before, and after the pause the end of the line stays over the textarea's text", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  const length = 2995;
  const at = length - 2;
  await drop(page, "min.json", `${ONE_LINE.slice(0, at)}${FULL_BLOCK}${ONE_LINE.slice(at + 1, length)}`);
  await openEditor(page);
  await installProbes(page);
  const background = rgb(await probe(page, "background"));
  expect(await probe(page, "spacing")).toBe("normal");
  await editor(page).evaluate((ta) => {
    ta.blur();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.focus();
  });
  await page.keyboard.type("0123456789");
  await page.waitForTimeout(SETTLE_MS);
  expect(Math.abs(await driftAt(page, at, background))).toBeLessThanOrEqual(1);
});

test("INV-86 (e): a one-line JSON mostly of kana: its difference goes to the log (a known limit of WebKit, spec 5.19.12)", async ({ page, browserName }) => {
  test.setTimeout(60000);
  await page.goto("/");
  const { drifts } = await driftsOf(page, ONE_LINE_MOSTLY_KANA);
  console.log(`PRT-AJ19 ${browserName} mostly kana, layer minus textarea, px, at a place in the line: ${JSON.stringify(drifts)}`);
  if (browserName === "chromium") for (const at of PLACES) expect(Math.abs(drifts[at]), `at ${at}`).toBeLessThanOrEqual(1);
});

for (const length of [2999, 3001]) {
  test(`INV-86 (e), PRT-AJ19 step 9: a line of ${length} characters, by CONFIG.codeEdit.snapLineChars: the end of the line stays over the textarea's text`, async ({ page }) => {
    await page.goto("/");
    const at = length - 2;
    await drop(page, "min.json", `${ONE_LINE.slice(0, at)}${FULL_BLOCK}${ONE_LINE.slice(at + 1, length)}`);
    await openEditor(page);
    await installProbes(page);
    const background = rgb(await probe(page, "background"));
    expect(Math.abs(await driftAt(page, at, background))).toBeLessThanOrEqual(1);
  });
}

for (const zoom of [0.67, 1.1, 1.125, 1.25, 1.5, 2]) {
  test(`INV-86 (e), PRT-AJ19 step 9: CSS zoom ${zoom}, which lays the page out in Chromium as its zoom does: the layer stays over the textarea's text in a one-line JSON of 30 KB`, async ({ page, browserName }) => {
    test.fixme(browserName === "webkit", "a known limit of WebKit at a zoom (spec 5.19.12)");
    test.setTimeout(60000);
    await page.goto("/");
    await page.evaluate((zoom) => (document.documentElement.style.zoom = String(zoom)), zoom);
    const { drifts } = await driftsOf(page, ONE_LINE, Math.floor(12 * Math.min(1, zoom)));
    console.log(`PRT-AJ19 ${browserName} zoom ${zoom}, layer minus textarea, px, at a place in the line: ${JSON.stringify(drifts)}`);
    for (const at of PLACES) expect(Math.abs(drifts[at]), `at ${at}`).toBeLessThanOrEqual(1);
  });
}

test.describe("INV-86 (e), a touch screen (any-pointer: coarse): the body scrolls, not #preview", () => {
  test.use({ hasTouch: true, viewport: { width: 1194, height: 834 } });

  test("the end of a long line has its colors when the page is scrolled there", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
    await drop(page, "min.json", ONE_LINE);
    await openEditor(page);
    await installProbes(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#preview")).overflowX)).toBe("visible");
    await page.evaluate(() => window.__probe.watch());
    await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0));
    await expect.poll(() => probe(page, "coloredTexts", "string")).toContain(`"item${ITEMS - 1}"`);
    await page.waitForTimeout(200);
    expect((await probe(page, "stop")).bad).toEqual([]);
    expect(await probe(page, "coloredTexts", "string")).not.toContain('"item0"');
    const image = await screen(page);
    expect(pixelsNear(image, { x: image.left, y: image.top, width: image.width, height: image.height }, DARK_STRING)).toBeGreaterThan(50);
  });
});

test.describe("INV-86, PRT-AJ19 step 9, the iPad's screen and touch (WebKit, emulated)", () => {
  // Why: portrait lays the page out wider than the screen and shrinks it, and a tap misses
  const { defaultBrowserType: _ignored, ...iPad } = devices["iPad Pro 11 landscape"];
  test.use(iPad);

  test("[Edit] by a tap, a key after a half second: the layer stays shown and in place, the other lines the same", async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "the emulation stands for Safari on an iPad");
    await page.goto("/");
    await drop(page, "sample.js", JS_TEXT);
    await page.locator("#editBtn").tap();
    await expect(editor(page)).toBeFocused();
    await installProbes(page);
    const line = await caretAfter(page, "const sum = a + b;");
    const base = await screen(page);
    await page.evaluate((skipLine) => window.__probe.watch({ skipLine }), line);
    for (const key of ["l", "e", "t"]) {
      await page.keyboard.press(key);
      expect(changedPixels(base, await screen(page), await probe(page, "rectOf", "const sum"))).toBe(0);
      await page.waitForTimeout(PAUSE_MS);
    }
    expectCleanWatch(await probe(page, "stop"), 3);
    await expectTextInPlace(page);
  });
});
