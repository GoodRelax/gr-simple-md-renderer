import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../js/classes/MarkdownRenderer.js";
import { CONFIG } from "../js/config.js";

const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function createMarked() {
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  return marked;
}

describe("AT-EIG External images (CON-12, INV-19, INV-01)", () => {
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

  const placeholders = () =>
    preview.querySelectorAll(".external-image-placeholder");
  const liveImages = () => preview.querySelectorAll("img");

  describe("AT-EIG-01 before consent", () => {
    it.each([
      ["Markdown https", "![logo](https://example.com/a.png)"],
      ["Markdown http", "![logo](http://example.com/a.png)"],
      ["raw <img> https", '<img src="https://example.com/a.png" alt="logo">'],
      ["protocol-relative", '<img src="//example.com/a.png" alt="logo">'],
      ["relative path", "![logo](images/a.png)"],
    ])("%s: no <img> with a live src, placeholder shown", async (_, md) => {
      await renderer.render(md);
      expect(liveImages().length).toBe(0);
      expect(preview.querySelector("[src]")).toBeNull();
      expect(placeholders().length).toBe(1);
      expect(placeholders()[0].textContent).toContain("logo");
    });

    it("names the image host in the placeholder", async () => {
      await renderer.render("![logo](https://img.example.org/a.png)");
      expect(placeholders()[0].textContent).toContain("img.example.org");
    });

    it("gates srcset with any external candidate", async () => {
      await renderer.render(
        '<img srcset="https://example.com/a.png 1x, https://example.com/a@2x.png 2x" alt="s">',
      );
      expect(preview.querySelector("[srcset]")).toBeNull();
      expect(placeholders().length).toBe(1);
    });

    it("keeps data: images as they are", async () => {
      await renderer.render(`![dot](${PNG_DATA})\n\n<img src="${PNG_DATA}" alt="raw">`);
      const imgs = liveImages();
      expect(imgs.length).toBe(2);
      imgs.forEach((img) => expect(img.getAttribute("src")).toBe(PNG_DATA));
      expect(placeholders().length).toBe(0);
    });

    it("does not gate blob: or data: (DOMPurify itself drops them where unsafe)", async () => {
      // DOMPurify's URI rules remove blob: src and data: in srcset; the gate
      // must neither resurrect them nor show a placeholder for them.
      await renderer.render(
        `<img src="blob:https://example.com/0000" alt="b"><img srcset="${PNG_DATA} 2x" alt="s">`,
      );
      expect(placeholders().length).toBe(0);
      expect(liveImages().length).toBe(2);
      expect(preview.querySelector("[data-external-src], [data-external-srcset]")).toBeNull();
    });

    it("strips remote <source>, <video poster/src>, <audio>, <input type=image>, background", async () => {
      await renderer.render(
        '<picture><source srcset="https://example.com/a.webp"><img src="https://example.com/a.png"></picture>\n\n' +
          '<video src="https://example.com/v.mp4" poster="https://example.com/p.png"></video>\n\n' +
          '<audio><source src="https://example.com/a.mp3"><track src="https://example.com/t.vtt"></audio>\n\n' +
          '<input type="image" src="https://example.com/i.png">\n\n' +
          '<table background="https://example.com/bg.png"><tr><td>x</td></tr></table>',
      );
      ["src", "srcset", "poster", "background"].forEach((attr) => {
        expect(preview.querySelector(`[${attr}]`)).toBeNull();
      });
    });

    it("strips remote url() in style and SVG presentation attributes, keeps #fragments", async () => {
      await renderer.render(
        '<div style="background:url(https://example.com/bg.png)">a</div>\n\n' +
          '<div style="background:u\\72l(https://example.com/bg.png)">b</div>\n\n' +
          '<div style="background-image:image-set(\'https://example.com/a.png\' 1x)">c</div>\n\n' +
          '<div style="color:red">d</div>\n\n' +
          '<svg><rect fill="url(https://example.com/x.svg#p)"></rect><rect fill="url(#local)"></rect></svg>',
      );
      const divs = preview.querySelectorAll("div");
      expect(divs[0].hasAttribute("style")).toBe(false);
      expect(divs[1].hasAttribute("style")).toBe(false);
      expect(divs[2].hasAttribute("style")).toBe(false);
      expect(divs[3].getAttribute("style")).toBe("color:red");
      const rects = preview.querySelectorAll("rect");
      expect(rects[0].hasAttribute("fill")).toBe(false);
      expect(rects[1].getAttribute("fill")).toBe("url(#local)");
    });

    it("strips remote href from SVG <image>", async () => {
      await renderer.render(
        '<svg><image href="https://example.com/a.png"></image><image xlink:href="https://example.com/b.png"></image></svg>',
      );
      preview.querySelectorAll("image").forEach((el) => {
        expect(el.getAttribute("href")).toBeNull();
        expect(el.getAttribute("xlink:href")).toBeNull();
      });
    });

    it("removes <style> elements", async () => {
      await renderer.render(
        "<style>@import url(https://example.com/x.css); body{background:url(https://example.com/b.png)}</style>\n\ntext",
      );
      expect(preview.querySelector("style")).toBeNull();
      expect(preview.innerHTML).not.toContain("example.com");
    });

    it("ignores data-external-src written by the document itself", async () => {
      await renderer.render(
        '<div data-external-src="https://example.com/a.png">x</div><img alt="n" data-external-src="https://example.com/b.png">',
      );
      expect(preview.querySelector("[data-external-src]")).toBeNull();
      expect(placeholders().length).toBe(0);
    });

    it("still strips event handlers and javascript: URLs", async () => {
      await renderer.render(
        '<img src="https://example.com/a.png" onerror="alert(1)" alt="x">\n\n' +
          '<a href="javascript:alert(1)">j</a>\n\n[m](javascript:alert(2))',
      );
      expect(preview.innerHTML).not.toMatch(/onerror|javascript:/i);
    });

    it("does not add its hook to the shared DOMPurify instance (mermaid uses it)", () => {
      const out = DOMPurify.sanitize('<img src="https://example.com/a.png">');
      expect(out).toContain('src="https://example.com/a.png"');
    });
  });

  describe("AT-EIG-02 consent", () => {
    it("asks once with the fixed sentence (no host list, R14) and loads all pending images on OK", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      await renderer.render(
        "![a](https://one.example/a.png) ![b](https://two.example/b.png)",
      );
      expect(confirm).not.toHaveBeenCalled(); // never asked on render
      // the placeholders still name their hosts
      expect(placeholders()[0].textContent).toContain("one.example");
      expect(placeholders()[1].textContent).toContain("two.example");

      placeholders()[0].click();

      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledWith("Is it OK to get images from other sites?");
      expect(confirm.mock.calls[0][0]).toBe(CONFIG.messages.externalImage.consent);
      expect(placeholders().length).toBe(0);
      const srcs = [...liveImages()].map((img) => img.getAttribute("src"));
      expect(srcs).toEqual(["https://one.example/a.png", "https://two.example/b.png"]);
      expect(preview.querySelector("[data-external-src]")).toBeNull();
    });

    it("restores srcset too", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await renderer.render('<img src="https://example.com/a.png" srcset="https://example.com/a@2x.png 2x">');
      placeholders()[0].click();
      const img = liveImages()[0];
      expect(img.getAttribute("srcset")).toBe("https://example.com/a@2x.png 2x");
    });

    it("keeps placeholders on Cancel", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      await renderer.render("![a](https://example.com/a.png)");
      placeholders()[0].click();
      expect(liveImages().length).toBe(0);
      expect(placeholders().length).toBe(1);
      expect(renderer.imageGate.isGranted()).toBe(false);
    });

    it("does not follow a surrounding link when the placeholder is clicked", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      await renderer.render("[![badge](https://example.com/b.svg)](https://example.com/)");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      placeholders()[0].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("loads images directly on later renders while consent is active", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      await renderer.render("![a](https://example.com/a.png)");
      placeholders()[0].click();

      await renderer.render("![a](https://example.com/a.png)\n\n![c](https://example.com/c.png)");
      expect(confirm).toHaveBeenCalledOnce();
      expect(placeholders().length).toBe(0);
      expect(liveImages().length).toBe(2);
    });

    it("asks again after resetExternalImageConsent()", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await renderer.render("![a](https://example.com/a.png)");
      placeholders()[0].click();

      renderer.resetExternalImageConsent();
      await renderer.render("![a](https://example.com/a.png)");
      expect(liveImages().length).toBe(0);
      expect(placeholders().length).toBe(1);
    });

    it("is not stored in localStorage, sessionStorage or cookies (INV-04)", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      localStorage.clear();
      sessionStorage.clear();
      await renderer.render("![a](https://example.com/a.png)");
      placeholders()[0].click();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(document.cookie).toBe("");
    });

    it("can be triggered from the keyboard (Enter)", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      await renderer.render("![a](https://example.com/a.png)");
      placeholders()[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(confirm).toHaveBeenCalledOnce();
      expect(liveImages().length).toBe(1);
    });
  });
});
