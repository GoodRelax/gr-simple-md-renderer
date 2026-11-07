import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { CONFIG } from "../js/config.js";
import { loadSampleLf, loadFixtureLf } from "./helpers/samples.js";

const MAX = 250000;

// Heavy tests (about 1 s alone, 2 s or more when the machine is busy) get an
// explicit timeout so CPU load cannot fail them; the global 5 s default stays.
const HEAVY_TEST_TIMEOUT_MS = 30000;

function createMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return marked;
}

describe("MarkdownRenderer.renderBlocks / replaceBlocks (real marked, DOMPurify, hljs, gate)", () => {
  let preview;
  let renderer;
  let marked;
  let lexer;

  beforeEach(() => {
    preview = document.createElement("div");
    preview.id = "preview";
    document.body.appendChild(preview);
    marked = createMarked();
    lexer = (src) => marked.lexer(src);
    renderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  });

  afterEach(() => {
    preview.remove();
    vi.restoreAllMocks();
  });

  const model = (body, first = 1) => MarkdownBlockModel.fromBody(body, lexer, first);
  const wrappers = () => [...preview.children].filter((el) => el.classList.contains("md-block"));

  // Children of the wrappers (or of a whole-document render), joined, with
  // whitespace-only text nodes between top-level elements removed.
  function flatHtml(root, unwrap) {
    const box = document.createElement("div");
    for (const child of [...root.childNodes]) {
      const nodes = unwrap && child.classList?.contains("md-block") ? [...child.childNodes] : [child];
      // the table tabs are the renderer's own (INV-29 (b)), not document HTML
      for (const n of nodes) if (!renderer.isTableTab(n)) box.appendChild(n.cloneNode(true));
    }
    for (const n of [...box.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() === "") n.remove();
    }
    return box.innerHTML;
  }

  it("AT-MR-01 one div.md-block per block, data-block-id = model id, in model order", () => {
    const m = model("# H\n\nPara\n\n- a\n- b\n", 5);
    renderer.renderBlocks(m);
    expect(wrappers().map((w) => w.dataset.blockId)).toEqual(["5", "6", "7"]);
    expect(preview.children).toHaveLength(3);
  });

  it.each([
    "sample-data.md",
    "sample-data.txt",
    "sample-data-2.md",
    "sample-data-2.txt",
  ])("AT-MR-02 the joined blocks show the same DOM as a whole-document render (%s)", async (name) => {
    const body = loadSampleLf(name);
    renderer.renderBlocks(model(body));
    const other = document.createElement("div");
    document.body.appendChild(other);
    await new MarkdownRenderer(other, createMarked(), hljs, DOMPurify).render(body);
    expect(flatHtml(preview, true)).toBe(flatHtml(other, false));
    other.remove();
  }, HEAVY_TEST_TIMEOUT_MS);

  it.each(["html-details.md", "html-div-center.md", "html-hidden.md", "ref-links.md"])(
    "AT-MR-02 same DOM as a whole-document render for fixture %s",
    async (name) => {
      const body = loadFixtureLf(name);
      renderer.renderBlocks(model(body));
      const other = document.createElement("div");
      document.body.appendChild(other);
      await new MarkdownRenderer(other, createMarked(), hljs, DOMPurify).render(body);
      expect(flatHtml(preview, true)).toBe(flatHtml(other, false));
      other.remove();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it("AT-MR-03 def, comment-only and sanitized-away html blocks are hidden bands with their kind", () => {
    renderer.renderBlocks(model("Text\n\n<!-- note -->\n\n<script>alert(1)</script>\n\n[d]: https://example.com/x\n"));
    const w = wrappers();
    expect(w.map((x) => x.classList.contains("md-block-hidden"))).toEqual([false, true, true, true]);
    expect(w[1].title).toBe(CONFIG.messages.edit.hiddenHtml);
    expect(w[2].title).toBe(CONFIG.messages.edit.hiddenHtml);
    expect(w[3].title).toBe(CONFIG.messages.edit.hiddenLinkDefinition);
    expect(w[0].title).toBe("");
  });

  it("AT-MR-04 replacing one block keeps the other wrapper elements (same reference) and their state", () => {
    const m1 = model(loadFixtureLf("diagrams.md"));
    renderer.renderBlocks(m1);
    const before = wrappers();
    const diagramWrapper = before[1];
    diagramWrapper.style.transform = "scale(2)";
    diagramWrapper.dataset.zoom = "2";
    const target = m1.getBlocks()[2]; // "Between the diagrams."
    const m2 = m1.replaceBlock(target.id, "Between the two diagrams.", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    const after = wrappers();
    expect(after).toHaveLength(before.length);
    after.forEach((w, i) => {
      if (i === 2) expect(w).not.toBe(before[i]);
      else expect(w).toBe(before[i]);
    });
    expect(after[1].style.transform).toBe("scale(2)");
    expect(after[1].dataset.zoom).toBe("2");
  });

  it("AT-MR-05 returns only replaced elements; removed blocks leave the DOM; new blocks go in model order", () => {
    const m1 = model("A\n\nB\n\nC\n");
    renderer.renderBlocks(m1);
    const [a, b, c] = wrappers();
    const m2 = m1.withBody("A\n\nX\n\nY\n\nC\n", lexer, MAX).model;
    const replaced = renderer.replaceBlocks(m1, m2);
    expect(replaced.map((w) => w.textContent.trim())).toEqual(["X", "Y"]);
    expect(b.isConnected).toBe(false);
    expect(wrappers()).toEqual([a, replaced[0], replaced[1], c]);
    expect(wrappers().map((w) => w.dataset.blockId)).toEqual(m2.getBlocks().map((x) => String(x.id)));
  });

  it("AT-MR-06 one changed block of sample-data-2 costs exactly one sanitize call", () => {
    const m1 = model(loadSampleLf("sample-data-2.md"));
    renderer.renderBlocks(m1);
    const para = m1.getBlocks().find((b) => b.type === "paragraph" && b.raw.length > 20);
    const spy = vi.spyOn(renderer.purify, "sanitize");
    const m2 = m1.replaceBlock(para.id, para.raw + " edited", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    expect(spy).toHaveBeenCalledTimes(1);
  }, HEAVY_TEST_TIMEOUT_MS);

  it("AT-MR-07 changing a definition re-renders the paragraphs that use it, not the others", () => {
    const m1 = model(loadFixtureLf("ref-links.md"));
    renderer.renderBlocks(m1);
    const [a, b, c] = wrappers();
    const def = m1.getBlocks().find((x) => x.type === "def");
    const m2 = m1.replaceBlock(def.id, "[d]: https://example.com/y", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    const [a2, b2, c2] = wrappers();
    expect(a2).not.toBe(a);
    expect(b2).not.toBe(b);
    expect(c2).toBe(c);
    expect(a2.querySelector("a").getAttribute("href")).toBe("https://example.com/y");
  });

  it("AT-MR-24 the same definitions keep the cache: an edit elsewhere, and an Undo, keep the links object, and only the changed block is made", () => {
    const m1 = model("[a]: https://example.com/a\n\nsee [a]\n\nB\n\nC\n");
    renderer.renderBlocks(m1);
    const made = vi.spyOn(renderer, "blockHtml");
    const m2 = m1.withBody("[a]: https://example.com/a\n\nsee [a]\n\nB edited\n\nC\n", lexer, MAX).model;
    expect(m2.links).toBe(m1.links); // sameLinks: the same object for the same definitions
    renderer.replaceBlocks(m1, m2);
    expect(made.mock.calls.map(([raw]) => raw)).toEqual(["B edited"]);
    made.mockClear();
    const undone = m1.withNextBlockId(m2.getNextBlockId()); // an Undo (RendererOrchestrator._restoreModel)
    expect(undone.links).toBe(m1.links);
    renderer.replaceBlocks(m2, undone);
    expect(made.mock.calls.map(([raw]) => raw)).toEqual(["B"]);
  });

  it("AT-MR-25 a definition's content changed (href, title; the same length too): the cache misses, every block is made again and no old HTML is shown; going back shows the first link again", () => {
    const body = (href, title) => `[a]: ${href} "${title}"\n\nsee [a]\n`;
    const href = () => preview.querySelector("a").getAttribute("href");
    const m1 = model(body("https://example.com/1", "one"));
    renderer.renderBlocks(m1);
    const made = vi.spyOn(renderer, "blockHtml");
    const m2 = m1.withBody(body("https://example.com/2", "one"), lexer, MAX).model;
    expect(m2.links).not.toBe(m1.links);
    renderer.replaceBlocks(m1, m2);
    expect(made).toHaveBeenCalledTimes(2); // the definition's block changed too, and the paragraph
    expect(href()).toBe("https://example.com/2");
    const m3 = m2.withBody(body("https://example.com/2", "two"), lexer, MAX).model;
    renderer.replaceBlocks(m2, m3);
    expect(preview.querySelector("a").getAttribute("title")).toBe("two");
    const m4 = m3.withBody(body("https://example.com/1", "one"), lexer, MAX).model;
    renderer.replaceBlocks(m3, m4);
    expect([href(), preview.querySelector("a").getAttribute("title")]).toEqual(["https://example.com/1", "one"]);
  });

  it("AT-MR-26 a block's cache key does not grow with the definitions: its length is the same for a definition of 10 and of 450,000 characters", () => {
    const longestKey = (definition) => {
      const m = model(`[fig]: data:image/gif;base64,${definition}\n\nFirst ![x][fig]\n\nSecond\n`);
      renderer.renderBlocks(m);
      const keys = [...renderer._htmlCache.keys()];
      expect(keys).toHaveLength(3);
      return Math.max(...keys.filter((key) => !key.startsWith("[fig]:")).map((key) => key.length));
    };
    const short = longestKey("A".repeat(10));
    const long = longestKey("A".repeat(450000));
    expect(Math.abs(long - short)).toBeLessThanOrEqual(3); // the number's digits at most
    expect(long).toBeLessThan("First ![x][fig]\n".length + 32);
  });

  it("AT-MR-27 a definition removed: the model gets another links object, the cache misses, and the block that used it loses its link", () => {
    const m1 = model("[a]: https://example.com/a\n\n[b]: https://example.com/b\n\nsee [a] and [b]\n");
    renderer.renderBlocks(m1);
    expect(preview.querySelectorAll("a")).toHaveLength(2);
    const made = vi.spyOn(renderer, "blockHtml");
    const m2 = m1.withBody("[b]: https://example.com/b\n\nsee [a] and [b]\n", lexer, MAX).model;
    expect(m2.links).not.toBe(m1.links);
    expect(Object.keys(m2.links)).toEqual(["b"]);
    renderer.replaceBlocks(m1, m2);
    expect(made.mock.calls.map(([raw]) => raw)).toContain("see [a] and [b]\n");
    expect([...preview.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://example.com/b"]);
    expect(preview.textContent).toContain("[a]");
  });

  it("AT-MR-28 a block written in place stays for the same definitions, and is made again for other definitions over the same text", () => {
    const body = (href, tail = "After") => `[a]: ${href}\n\n| [x][a] |\n| --- |\n| 1 |\n\n${tail}\n`;
    const m1 = model(body("https://example.com/1"));
    renderer.renderBlocks(m1);
    const table = m1.getBlocks().find((b) => b.type === "table");
    const wrapper = renderer.getBlockElement(table.id);
    const made = vi.spyOn(renderer, "blockHtml");
    renderer.markWrittenInPlace(table, m1.links);
    const same = m1.withBody(body("https://example.com/1", "Later"), lexer, MAX).model;
    expect(same.links).toBe(m1.links);
    renderer.replaceBlocks(m1, same);
    expect(made.mock.calls.map(([raw]) => raw)).not.toContain(table.raw);
    expect(renderer.getBlockElement(table.id)).toBe(wrapper);
    const other = same.withBody(body("https://example.com/2", "Later"), lexer, MAX).model;
    const kept = other.getBlocks().find((b) => b.type === "table");
    expect([kept.id, kept.raw]).toEqual([table.id, table.raw]);
    renderer.replaceBlocks(same, other);
    expect(made.mock.calls.map(([raw]) => raw)).toContain(table.raw);
    expect(preview.querySelector("a").getAttribute("href")).toBe("https://example.com/2");
  });

  it("AT-MR-29 no links count as no definitions: the block is drawn once and the cache holds it", () => {
    const block = { id: 1, raw: "see [a]\n" };
    expect(renderer.cachedBlockHtml(block, undefined)).toContain("see [a]");
    const made = vi.spyOn(renderer, "blockHtml");
    expect(renderer.cachedBlockHtml(block, undefined)).toContain("see [a]");
    expect(made).not.toHaveBeenCalled();
  });

  it("AT-MR-30 a table's two paths keep the links object, so a table change makes only the table", () => {
    const check = (body) => {
      const m1 = model(body("1"));
      renderer.renderBlocks(m1);
      const table = m1.getBlocks().find((b) => b.type === "table");
      const made = vi.spyOn(renderer, "blockHtml");
      const plan = m1.planTableReplace(table.id, "| x |\n| --- |\n| 2 |", lexer, MAX);
      expect(plan.keptId).toBe(true);
      expect(plan.model.links).toBe(m1.links);
      renderer.replaceBlocks(m1, plan.model);
      expect(made).toHaveBeenCalledTimes(1);
      made.mockRestore();
    };
    check((cell) => `[a]: https://example.com/a\n\nIntro [a]\n\n| x |\n| --- |\n| ${cell} |\n\nAfter\n`); // _localTableModel
    check((cell) => `[a]: https://example.com/a\n\nIntro [a]\n| x |\n| --- |\n| ${cell} |\n\nAfter\n`); // no blank line before it: the whole body
  });

  it("AT-MR-08 the cache keeps only keys of the current model; renderBlocks rebuilds it from empty", () => {
    const m1 = model("A\n\nB\n\nC\n");
    renderer.renderBlocks(m1);
    expect(renderer._htmlCache.size).toBe(3);
    const m2 = m1.withBody("A\n\nZ\n", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    expect(renderer._htmlCache.size).toBe(2);
    renderer.renderBlocks(model("Only\n"));
    expect(renderer._htmlCache.size).toBe(1);
  });

  it("AT-MR-10 external images in a replaced block are gated before consent, direct after; replacing never revokes", () => {
    const revoke = vi.spyOn(renderer.imageGate, "revoke");
    const m1 = model("Intro\n\nNo image yet\n");
    renderer.renderBlocks(m1);
    const m2 = m1.withBody("Intro\n\n![r](https://example.com/a.png)\n", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    expect(preview.querySelectorAll(".external-image-placeholder")).toHaveLength(1);
    expect(preview.querySelector("img[src]")).toBeNull();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    preview.querySelector(".external-image-placeholder").click();
    expect(renderer.imageGate.isGranted()).toBe(true);

    const m3 = m2.withBody("Intro\n\n![s](https://example.com/b.png)\n", lexer, MAX).model;
    renderer.replaceBlocks(m2, m3);
    expect(preview.querySelector("img").getAttribute("src")).toBe("https://example.com/b.png");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("AT-MR-12 only the replaced block's code is highlighted; mermaid and plantuml are not", () => {
    const m1 = model("```js\na\n```\n\n```py\nb\n```\n");
    renderer.renderBlocks(m1);
    const spy = vi.spyOn(hljs, "highlightElement");
    const m2 = m1.withBody("```js\na\n```\n\n```py\nc\n```\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n```plantuml\n@startuml\n@enduml\n```\n", lexer, MAX).model;
    renderer.replaceBlocks(m1, m2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].textContent.trim()).toBe("c");
  });

  it("AT-MR-13 an empty model shows one empty block (shown only in edit mode by CSS)", () => {
    renderer.renderBlocks(model(""));
    expect(preview.children).toHaveLength(1);
    expect(preview.firstElementChild.classList.contains("md-block-empty")).toBe(true);
    const m = model("");
    const filled = m.withBody("Now text\n", lexer, MAX).model;
    renderer.replaceBlocks(m, filled);
    expect(preview.querySelector(".md-block-empty")).toBeNull();
    expect(wrappers()).toHaveLength(1);
    renderer.replaceBlocks(filled, filled.withBody("", lexer, MAX).model);
    expect(preview.children).toHaveLength(1);
    expect(preview.firstElementChild.classList.contains("md-block-empty")).toBe(true);
  });

  it("AT-MR-13 getEmptyBlockElement returns the renderer's own empty block only (by reference)", () => {
    expect(renderer.getEmptyBlockElement()).toBeNull();
    renderer.renderBlocks(model(""));
    expect(renderer.getEmptyBlockElement()).toBe(preview.firstElementChild);
    const m = model("");
    const filled = m.withBody("Now text\n", lexer, MAX).model;
    renderer.replaceBlocks(m, filled);
    expect(renderer.getEmptyBlockElement()).toBeNull();
    renderer.replaceBlocks(filled, filled.withBody("", lexer, MAX).model);
    expect(renderer.getEmptyBlockElement()).toBe(preview.firstElementChild);
    renderer.renderBlocks(model('<div class="md-block md-block-empty">user</div>\n'));
    expect(renderer.getEmptyBlockElement()).toBeNull();
  });

  it("AT-MR-14 block identity comes only from the renderer's own wrappers (Q1)", () => {
    const m = model(loadFixtureLf("spoof-block-id.md"));
    const paraA = m.getBlocks()[0];
    expect(paraA.id).toBe(1); // the fixture's fake data-block-id="1" points at paragraph A
    renderer.renderBlocks(m);

    const direct = [...preview.children].filter((el) => el.classList.contains("md-block"));
    expect(direct).toHaveLength(m.getBlocks().length);
    const fakeDiv = [...preview.querySelectorAll('[data-block-id="1"]')].find((el) => !direct.includes(el));
    expect(fakeDiv).toBeTruthy();
    expect(direct).not.toContain(fakeDiv);

    const owner = direct.find((w) => w.contains(fakeDiv));
    expect(renderer.findBlockIdAt(fakeDiv)).toBe(Number(owner.dataset.blockId));
    expect(renderer.findBlockIdAt(fakeDiv)).not.toBe(1);
    // A renderer wrapper is found by reference, not by its attribute.
    owner.dataset.blockId = "999";
    expect(renderer.findBlockIdAt(fakeDiv)).not.toBe(999);
    expect(renderer.getBlockElement(paraA.id)).toBe(direct[0]);
    expect(renderer.findBlockIdAt(document.body)).toBe(null);
  });

  it("AT-MR-14 the wrapper markup is code, not part of the sanitized string", () => {
    const spy = vi.spyOn(renderer.purify, "sanitize");
    renderer.renderBlocks(model("Para\n"));
    expect(spy.mock.results[0].value).not.toMatch(/md-block|data-block-id/);
  });

  it("a block that fails to parse shows an escaped error inside its own wrapper", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = model("A\n\nB\n");
    const broken = {
      ...marked,
      Lexer: class {
        constructor() {
          this.tokens = [];
          this.tokens.links = {};
        }
        lex() {
          throw new Error("<img src=x onerror=alert(1)>");
        }
      },
      defaults: marked.defaults,
      parser: () => "",
    };
    const r = new MarkdownRenderer(preview, broken, hljs, DOMPurify);
    r.renderBlocks(m);
    expect(preview.querySelector("img")).toBeNull();
    expect(preview.querySelectorAll(".md-block pre")).toHaveLength(2);
    expect(preview.querySelector(".md-block pre").textContent).toBe("Couldn't read this Markdown: <img src=x onerror=alert(1)>");
  });
});
