import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("SourceFileRenderer", () => {
  let SourceFileRenderer;
  let showToastMock;
  let hljsMock;

  beforeEach(async () => {
    vi.resetModules();

    showToastMock = vi.fn();

    // Injected hljs stub: only "python" is "bundled"
    hljsMock = {
      getLanguage: vi.fn((lang) => (lang === "python" ? {} : undefined)),
      highlight: vi.fn((text, opts) => ({
        value: `<span class="hljs-keyword">${text}</span>`,
      })),
      highlightAuto: vi.fn((text) => ({
        value: `<span class="hljs-auto">${text}</span>`,
      })),
    };

    // Mock utils.js
    vi.doMock("../js/utils.js", () => ({
      escapeHtml: (s) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"),
      formatDateTime: vi.fn(() => "2024-01-01 12:00:00"),
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
        reloadUnavailableMsg: "Reload works only in Chrome and Edge.",
        reloadNoFileMsg: "No file to reload. Drop a file first.",
      },
    };
    const previewEl = document.createElement("div");
    return {
      renderer: new SourceFileRenderer(config, previewEl, hljsMock, false),
      previewEl,
      config,
    };
  }

  describe("AT-SFR-02 FS-03, spec 5.5: constructor", () => {
    it("stores config reference", () => {
      const { renderer, config } = createRenderer();
      expect(renderer._cfg).toBe(config);
    });

    it("stores previewEl reference", () => {
      const { renderer, previewEl } = createRenderer();
      expect(renderer._previewEl).toBe(previewEl);
    });

    it("stores injected hljs reference", () => {
      const { renderer } = createRenderer();
      expect(renderer._hljs).toBe(hljsMock);
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
  });

  describe("AT-SFR-03 FS-07, INV-13: destroy()", () => {
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
  });

  describe("AT-SFR-04 FS-03, INV-05, spec 5.3: _buildCodeBody()", () => {
    it("highlights a bundled language", () => {
      const { renderer } = createRenderer();
      const result = renderer._buildCodeBody("x = 1", { name: "a.py" });
      expect(hljsMock.highlight).toHaveBeenCalledWith("x = 1", {
        language: "python",
      });
      expect(result.language).toBe("python");
      expect(result.html).toContain("hljs-keyword");
    });

    it("shows unknown extension as plaintext without highlightAuto", () => {
      const { renderer } = createRenderer();
      const result = renderer._buildCodeBody("<b>", { name: "a.unknownext" });
      expect(hljsMock.highlightAuto).not.toHaveBeenCalled();
      expect(hljsMock.highlight).not.toHaveBeenCalled();
      expect(result.language).toBe("plaintext");
      expect(result.html).toContain("&lt;b&gt;");
    });

    it("shows a registered language missing from the bundle as plaintext", () => {
      const { renderer } = createRenderer();
      // .ps1 maps to "powershell", which the stub does not provide
      const result = renderer._buildCodeBody("<b>", { name: "a.ps1" });
      expect(hljsMock.getLanguage).toHaveBeenCalled();
      expect(hljsMock.highlight).not.toHaveBeenCalled();
      expect(hljsMock.highlightAuto).not.toHaveBeenCalled();
      expect(result.language).toBe("plaintext");
      expect(result.html).toContain("&lt;b&gt;");
    });
  });

  describe("AT-SFR-05 INV-07: source guard", () => {
    it("has no external https:// import", () => {
      // Vitest root is the project root (vite.config.js test.root)
      const src = readFileSync(
        resolve(process.cwd(), "src/js/classes/SourceFileRenderer.js"),
        "utf-8",
      );
      expect(src).not.toMatch(/import[^;]*from\s*["']https:\/\//);
      expect(src).not.toContain("cdnjs");
    });
  });

  describe("AT-SFR-06 FS-03, spec 5.5: _splitHighlightedLines()", () => {
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
    it("AT-SFR-07 (a) FS-04, INV-15: shows toast when fileHandle is null", async () => {
      const { renderer, config } = createRenderer();
      renderer._fileHandle = null;

      await renderer.reload("light");

      expect(showToastMock).toHaveBeenCalledWith(
        config.codeView.reloadUnavailableMsg,
        config.codeView.toastDurationMs,
      );
    });

    it("AT-SFR-01 where drops give file handles, a file without one says there is no file (release test N5)", async () => {
      const { config, previewEl } = createRenderer();
      const renderer = new SourceFileRenderer(config, previewEl, hljsMock, true);
      await renderer.reload("light");
      expect(showToastMock).toHaveBeenCalledWith(config.codeView.reloadNoFileMsg, config.codeView.toastDurationMs);
      expect(showToastMock).not.toHaveBeenCalledWith(config.codeView.reloadUnavailableMsg, expect.anything());
    });

    it("AT-SFR-07 (b) FS-04, INV-15: does not modify previewEl when fileHandle is null", async () => {
      const { renderer, previewEl } = createRenderer();
      renderer._fileHandle = null;
      previewEl.innerHTML = "<p>original</p>";

      await renderer.reload("dark");

      expect(previewEl.innerHTML).toBe("<p>original</p>");
    });
  });
});
