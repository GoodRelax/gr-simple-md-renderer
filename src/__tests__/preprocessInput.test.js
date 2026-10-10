import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeEditServices, withEditMethods } from "./helpers/uiMocks.js";

describe("UIController.preprocessInput", () => {
  let UIController;

  beforeEach(async () => {
    vi.resetModules();

    // Mock utils.js
    vi.doMock("../js/utils.js", async () => ({
      ...(await vi.importActual("../js/utils.js")),
      showToast: vi.fn(),
      applyTheme: vi.fn(),
      applySystemTheme: vi.fn(),
      systemTheme: vi.fn().mockReturnValue("light"),
    }));

    // Mock ModalController
    vi.doMock("../js/classes/ModalController.js", () => ({
      default: {
        setupModal: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      },
    }));

    const mod = await import("../js/classes/UIController.js");
    UIController = mod.default;
  });

  function createMockModal() {
    const modal = document.createElement("div");
    modal.innerHTML =
      '<button class="close-btn"></button><button class="prompt-close"></button>';
    return modal;
  }

  function createController() {
    const mockOrchestrator = {
      isCodeViewActive: vi.fn().mockReturnValue(false),
      isPreRenderState: vi.fn().mockReturnValue(true),
      reRender: vi.fn().mockResolvedValue(undefined),
      reloadCodeView: vi.fn().mockResolvedValue(undefined),
      readMarkdownFile: vi.fn().mockResolvedValue(null),
      renderAll: vi.fn().mockResolvedValue(undefined),
      loadMarkdown: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
      _showAffordance: vi.fn(),
    };

    const mockState = {
      currentTheme: "light",
      markdownText: "",
      setTheme: vi.fn(),
      setMarkdownText: vi.fn(),
    };

    const mockElements = {
      editor: document.createElement("textarea"),
      fileInfo: document.createElement("div"),
      keyHint: document.createElement("div"),
      preview: document.createElement("div"),
      renderLightBtn: document.createElement("button"),
      renderDarkBtn: document.createElement("button"),
      reloadBtn: document.createElement("button"),
      newTabBtn: document.createElement("button"),
      editBtn: document.createElement("button"),
      clearBtn: document.createElement("button"),
      helpBtn: document.createElement("button"),
      helpModal: createMockModal(),
      promptModal: createMockModal(),
      promptText: document.createElement("textarea"),
      copyPromptBtn: document.createElement("button"),
    };

    const mockScrollEngine = {
      startScroll: vi.fn(),
      stopScroll: vi.fn(),
      destroy: vi.fn(),
    };

    return new UIController(withEditMethods(mockOrchestrator), mockState, mockElements, mockScrollEngine, fakeEditServices());
  }

  it("strips triple-backtick markdown wrapper", () => {
    const ctrl = createController();
    const input = "```markdown\n# Hello\n```";
    expect(ctrl.preprocessInput(input)).toBe("# Hello");
  });

  it("strips wrapper with 4 backticks", () => {
    const ctrl = createController();
    const input = "````markdown\n# Hello\n````";
    expect(ctrl.preprocessInput(input)).toBe("# Hello");
  });

  it("strips wrapper with 5+ backticks", () => {
    const ctrl = createController();
    const input = "`````markdown\nsome content\n`````";
    expect(ctrl.preprocessInput(input)).toBe("some content");
  });

  it("preserves content without wrapper", () => {
    const ctrl = createController();
    const input = "# Hello World\n\nThis is plain markdown.";
    expect(ctrl.preprocessInput(input)).toBe(
      "# Hello World\n\nThis is plain markdown.",
    );
  });

  it("handles empty string", () => {
    const ctrl = createController();
    expect(ctrl.preprocessInput("")).toBe("");
  });

  it("is case-insensitive for MARKDOWN", () => {
    const ctrl = createController();
    const input = "```MARKDOWN\n# Title\n```";
    expect(ctrl.preprocessInput(input)).toBe("# Title");
  });

  it("is case-insensitive for mixed case (Markdown)", () => {
    const ctrl = createController();
    const input = "```Markdown\n# Title\n```";
    expect(ctrl.preprocessInput(input)).toBe("# Title");
  });

  it("does not strip opening fence for non-markdown languages", () => {
    const ctrl = createController();
    const input = "```python\nprint('hi')\n```";
    // Only a `markdown` opening fence counts as a wrapper, so ```python stays.
    // Without an opening wrapper the closing ``` is kept too (spec 5.13 rule 3).
    const result = ctrl.preprocessInput(input);
    expect(result).toContain("```python");
    expect(result).toContain("print('hi')");
  });

  it("handles leading blank lines before the fence", () => {
    const ctrl = createController();
    const input = "\n\n```markdown\n# Hello\n```";
    expect(ctrl.preprocessInput(input)).toBe("# Hello");
  });

  it("handles trailing whitespace after closing fence", () => {
    const ctrl = createController();
    const input = "```markdown\n# Hello\n```   ";
    expect(ctrl.preprocessInput(input)).toBe("# Hello");
  });

  it("preserves internal code blocks within the content", () => {
    const ctrl = createController();
    const input =
      "```markdown\n# Title\n\n```js\nconsole.log('hi')\n```\n\nEnd\n```";
    // The opening fence is stripped; the closing fence matches the last ```
    // Internal ```js block is preserved
    const result = ctrl.preprocessInput(input);
    expect(result).toContain("# Title");
    expect(result).toContain("```js");
  });

  it("handles multiline content correctly", () => {
    const ctrl = createController();
    const input = "```markdown\n# Title\n\n## Section\n\n- item 1\n- item 2\n```";
    const expected = "# Title\n\n## Section\n\n- item 1\n- item 2";
    expect(ctrl.preprocessInput(input)).toBe(expected);
  });

  it.each([
    ["wrapper", "```markdown\n# Hello\n```"],
    ["leading blank lines", "\n  \n````markdown\n# A\n````\n"],
    ["code block at the end, no wrapper", "# Doc\n\n```js\nx\n```\n"],
    ["example block first, paragraph last", "```markdown\n# ex\n```\n\ntext\n"],
    ["empty wrapper", "```markdown\n```"],
    ["count mismatch", "```markdown\n# A\n````"],
    ["plain text", "plain"],
    ["empty", ""],
  ])("AT-WRAP-18 delegates to splitMarkdownWrapper and returns its body (%s)", async (_name, input) => {
    const { splitMarkdownWrapper } = await import("../js/textTransforms.js");
    const ctrl = createController();
    expect(ctrl.preprocessInput(input)).toBe(splitMarkdownWrapper(input).body);
  });

  it("AT-WRAP-18 keeps the closing fence of a document that ends with a code block (change 00 (a))", () => {
    const ctrl = createController();
    const input = "# Doc\n\n```js\nx\n```";
    expect(ctrl.preprocessInput(input)).toBe(input);
  });
});
