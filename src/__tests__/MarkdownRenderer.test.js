import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";

// Same marked setup as src/js/main.js, but on an isolated instance.
function createMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return marked;
}

describe("MarkdownRenderer", () => {
  let preview;
  let renderer;

  beforeEach(() => {
    preview = document.createElement("div");
    document.body.appendChild(preview);
    renderer = new MarkdownRenderer(preview, createMarked(), hljs, DOMPurify);
  });

  afterEach(() => {
    preview.remove();
    vi.restoreAllMocks();
  });

  describe("sanitization", () => {
    it("strips inline event handlers from raw HTML", async () => {
      await renderer.render("before\n\n<img src=x onerror=alert(1)>\n\nafter");
      expect(preview.querySelector("[onerror]")).toBeNull();
      expect(preview.innerHTML).not.toMatch(/onerror/i);
    });

    it("removes <script> elements", async () => {
      await renderer.render("<script>alert(1)</script>\n\ntext");
      expect(preview.querySelector("script")).toBeNull();
      expect(preview.innerHTML).not.toMatch(/<script/i);
    });

    it("removes javascript: URLs from raw HTML anchors", async () => {
      await renderer.render('<a href="javascript:alert(1)">raw</a>');
      preview.querySelectorAll("a").forEach((a) => {
        expect(a.getAttribute("href") || "").not.toMatch(/^\s*javascript:/i);
      });
    });

    it("removes javascript: URLs from Markdown links", async () => {
      await renderer.render("[md](javascript:alert(1))");
      preview.querySelectorAll("a").forEach((a) => {
        expect(a.getAttribute("href") || "").not.toMatch(/^\s*javascript:/i);
      });
    });

    it("removes nested event handlers on other elements", async () => {
      await renderer.render('<div onclick="alert(1)"><svg onload="alert(1)"></svg></div>');
      expect(preview.querySelector("[onclick]")).toBeNull();
      expect(preview.querySelector("[onload]")).toBeNull();
    });

    it("does not let MathML annotation smuggle active HTML", async () => {
      await renderer.render(
        '<math><semantics><mi>x</mi><annotation encoding="text/html"><img src=x onerror=alert(1)></annotation></semantics></math>\n\n' +
          '<math><semantics><mi>y</mi><annotation-xml encoding="text/html"><img src=x onerror=alert(2)></annotation-xml></semantics></math>',
      );
      expect(preview.querySelector("[onerror]")).toBeNull();
      // <img> breaks out of foreign content and is sanitized as a plain
      // inert image (same as with the default config); nothing stays inside.
      expect(preview.querySelector("math img")).toBeNull();
      expect(preview.querySelector("annotation-xml")).toBeNull();
    });
  });

  describe("legitimate content survives sanitization", () => {
    it("keeps class language-mermaid on mermaid fenced blocks", async () => {
      await renderer.render("```mermaid\ngraph TD\n  A-->B\n```");
      const code = preview.querySelector("pre code.language-mermaid");
      expect(code).not.toBeNull();
      expect(code.textContent).toContain("A-->B");
    });

    it("keeps class language-plantuml and language-puml", async () => {
      await renderer.render(
        "```plantuml\n@startuml\nA -> B\n@enduml\n```\n\n```puml\n@startuml\nC -> D\n@enduml\n```",
      );
      expect(preview.querySelector("pre code.language-plantuml")).not.toBeNull();
      expect(preview.querySelector("pre code.language-puml")).not.toBeNull();
    });

    it("renders KaTeX (HTML spans with style and MathML)", async () => {
      await renderer.render("Inline $x^2 + y^2 = z^2$ math.\n\n$$\n\\frac{a}{b}\n$$");
      expect(preview.querySelector(".katex")).not.toBeNull();
      expect(preview.querySelector(".katex-display")).not.toBeNull();
      expect(preview.querySelector(".katex math")).not.toBeNull();
      expect(preview.querySelector(".katex-html [style]")).not.toBeNull();
    });

    it("keeps KaTeX MathML semantics/annotation without stray TeX text", async () => {
      await renderer.render("$x^2$");
      const math = preview.querySelector(".katex math");
      const annotation = math.querySelector("semantics > annotation");
      expect(annotation).not.toBeNull();
      expect(annotation.getAttribute("encoding")).toBe("application/x-tex");
      expect(annotation.textContent).toBe("x^2");
      // No bare text nodes directly under <math> (the leak seen with defaults)
      const strayText = [...math.childNodes].filter(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "",
      );
      expect(strayText).toEqual([]);
    });

    it("keeps task-list checkboxes", async () => {
      await renderer.render("- [x] done\n- [ ] todo");
      const boxes = preview.querySelectorAll('input[type="checkbox"]');
      expect(boxes.length).toBe(2);
      expect(boxes[0].checked).toBe(true);
      expect(boxes[1].checked).toBe(false);
    });

    it("keeps tables", async () => {
      await renderer.render("| a | b |\n|---|---|\n| 1 | 2 |");
      expect(preview.querySelector("table thead th")).not.toBeNull();
      expect(preview.querySelectorAll("table tbody td").length).toBe(2);
    });

    it("highlights ordinary code blocks", async () => {
      await renderer.render("```js\nconst x = 1;\n```");
      const code = preview.querySelector("pre code.language-js");
      expect(code).not.toBeNull();
      expect(code.classList.contains("hljs")).toBe(true);
    });
  });

  describe("parse error path", () => {
    it("escapes the error message instead of injecting it as HTML", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const throwingMarked = {
        parse: () => {
          throw new Error("<img src=x onerror=alert(1)>");
        },
      };
      renderer = new MarkdownRenderer(preview, throwingMarked, hljs, DOMPurify);
      await renderer.render("anything");

      expect(preview.querySelector("img")).toBeNull();
      const pre = preview.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre.textContent).toBe(
        "Markdown Parse Error: <img src=x onerror=alert(1)>",
      );
    });
  });
});
