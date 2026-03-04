import { describe, it, expect, vi, beforeEach } from "vitest";

describe("SourceFileRenderer", () => {
  let SourceFileRenderer;
  let showToastMock;

  beforeEach(async () => {
    vi.resetModules();

    showToastMock = vi.fn();

    // Mock hljs CDN import
    vi.doMock(
      "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/highlight.min.js",
      () => ({
        default: {
          highlight: vi.fn((text, opts) => ({
            value: `<span class="hljs-keyword">${text}</span>`,
          })),
          highlightAuto: vi.fn((text) => ({
            value: `<span class="hljs-auto">${text}</span>`,
          })),
        },
      }),
    );

    // Mock utils.js
    vi.doMock("../js/utils.js", () => ({
      escapeHtml: (s) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"),
      formatDateTime: vi.fn(() => "2024-01-01 12:00:00"),
      formatTime: vi.fn(() => "12:00:00"),
      applyTheme: vi.fn(),
      showToast: showToastMock,
    }));

    const mod = await import("../js/classes/SourceFileRenderer.js");
    SourceFileRenderer = mod.default;
  });

  function createRenderer() {
    const config = {
      codeView: {
        defaultTheme: "dark",
        keyHintDurationMs: 3000,
        toastDurationMs: 3000,
        reloadUnavailableMsg:
          "Reload not available (Chrome/Edge 86+ required)",
      },
    };
    const previewEl = document.createElement("div");
    return { renderer: new SourceFileRenderer(config, previewEl), previewEl, config };
  }

  describe("constructor", () => {
    it("stores config reference", () => {
      const { renderer, config } = createRenderer();
      expect(renderer._cfg).toBe(config);
    });

    it("stores previewEl reference", () => {
      const { renderer, previewEl } = createRenderer();
      expect(renderer._previewEl).toBe(previewEl);
    });

    it("initializes _fileHandle to null", () => {
      const { renderer } = createRenderer();
      expect(renderer._fileHandle).toBeNull();
    });

    it("initializes _fileName to empty string", () => {
      const { renderer } = createRenderer();
      expect(renderer._fileName).toBe("");
    });

    it("initializes _lastScrollTop to 0", () => {
      const { renderer } = createRenderer();
      expect(renderer._lastScrollTop).toBe(0);
    });

    it("initializes _keyHintTimer to null", () => {
      const { renderer } = createRenderer();
      expect(renderer._keyHintTimer).toBeNull();
    });
  });

  describe("destroy()", () => {
    it("clears previewEl innerHTML", () => {
      const { renderer, previewEl } = createRenderer();
      previewEl.innerHTML = "<p>content</p>";
      renderer.destroy();
      expect(previewEl.innerHTML).toBe("");
    });

    it("resets _fileHandle to null", () => {
      const { renderer } = createRenderer();
      renderer._fileHandle = { getFile: vi.fn() };
      renderer.destroy();
      expect(renderer._fileHandle).toBeNull();
    });

    it("resets _fileName to empty string", () => {
      const { renderer } = createRenderer();
      renderer._fileName = "test.py";
      renderer.destroy();
      expect(renderer._fileName).toBe("");
    });

    it("resets _lastScrollTop to 0", () => {
      const { renderer } = createRenderer();
      renderer._lastScrollTop = 500;
      renderer.destroy();
      expect(renderer._lastScrollTop).toBe(0);
    });

    it("clears _keyHintTimer", () => {
      const { renderer } = createRenderer();
      renderer._keyHintTimer = setTimeout(() => {}, 9999);
      renderer.destroy();
      expect(renderer._keyHintTimer).toBeNull();
    });
  });

  describe("_splitHighlightedLines()", () => {
    it("splits plain text by newlines", () => {
      const { renderer } = createRenderer();
      const result = renderer._splitHighlightedLines("line1\nline2\nline3");
      expect(result).toHaveLength(3);
      expect(result[0]).toBe("line1");
      expect(result[1]).toBe("line2");
      expect(result[2]).toBe("line3");
    });

    it("handles single line without newlines", () => {
      const { renderer } = createRenderer();
      const result = renderer._splitHighlightedLines("single line");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("single line");
    });

    it("handles empty string", () => {
      const { renderer } = createRenderer();
      const result = renderer._splitHighlightedLines("");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("");
    });

    it("properly closes and reopens spans across line boundaries", () => {
      const { renderer } = createRenderer();
      // Simulate hljs output where a span crosses a newline
      const html = '<span class="hljs-keyword">if\ntrue</span>';
      const result = renderer._splitHighlightedLines(html);
      expect(result).toHaveLength(2);
      // First line: span opened and closed at end
      expect(result[0]).toBe('<span class="hljs-keyword">if</span>');
      // Second line: span reopened at start and closed at end
      expect(result[1]).toBe('<span class="hljs-keyword">true</span>');
    });

    it("handles nested spans across line boundaries", () => {
      const { renderer } = createRenderer();
      const html =
        '<span class="hljs-meta"><span class="hljs-keyword">import\nos</span></span>';
      const result = renderer._splitHighlightedLines(html);
      expect(result).toHaveLength(2);
      // First line: both spans opened and closed
      expect(result[0]).toBe(
        '<span class="hljs-meta"><span class="hljs-keyword">import</span></span>',
      );
      // Second line: both spans reopened and closed
      expect(result[1]).toBe(
        '<span class="hljs-meta"><span class="hljs-keyword">os</span></span>',
      );
    });

    it("handles lines with no spans", () => {
      const { renderer } = createRenderer();
      const html = "plain\ntext\nonly";
      const result = renderer._splitHighlightedLines(html);
      expect(result).toEqual(["plain", "text", "only"]);
    });
  });

  describe("reload()", () => {
    it("shows toast when fileHandle is null", async () => {
      const { renderer, config } = createRenderer();
      renderer._fileHandle = null;

      await renderer.reload("light");

      expect(showToastMock).toHaveBeenCalledWith(
        config.codeView.reloadUnavailableMsg,
        config.codeView.toastDurationMs,
      );
    });

    it("does not modify previewEl when fileHandle is null", async () => {
      const { renderer, previewEl } = createRenderer();
      renderer._fileHandle = null;
      previewEl.innerHTML = "<p>original</p>";

      await renderer.reload("dark");

      expect(previewEl.innerHTML).toBe("<p>original</p>");
    });
  });
});
