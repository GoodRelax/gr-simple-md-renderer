import { vi } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import MarkdownRenderer from "../../js/classes/MarkdownRenderer.js";
import MermaidRenderer from "../../js/classes/MermaidRenderer.js";
import PlantUMLRenderer from "../../js/classes/PlantUMLRenderer.js";
import ScrollMemento from "../../js/classes/ScrollMemento.js";
import RendererOrchestrator from "../../js/classes/RendererOrchestrator.js";
import ApplicationState from "../../js/classes/ApplicationState.js";
import BlockEditController from "../../js/classes/BlockEditController.js";
import EditPalette from "../../js/classes/EditPalette.js";
import MarkdownFileAccess from "../../js/classes/MarkdownFileAccess.js";
import UIController from "../../js/classes/UIController.js";
import { createUiElements, trackGlobalListeners } from "./uiMocks.js";

export { createUiElements, trackGlobalListeners };

// The whole app as main.js composes it, with a fake SourceFileRenderer and
// fake scroll engine. Test files that use it must mock utils.js partially
// (waitForDOMStability, showToast, applyTheme, applySystemTheme) and mock
// ModalController.

export const BASE_TITLE = "GRSMD";

/** A drop event like the browser's: items (handle) and files. */
export function dropEvent(file, handle = null) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  const calls = [];
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [file],
      items: [
        {
          getAsFileSystemHandle: () => {
            calls.push("getAsFileSystemHandle");
            return Promise.resolve(handle);
          },
        },
      ],
    },
  });
  event.calls = calls;
  return event;
}

/** Let queued renders and awaited reads finish. */
export async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * The composed app on a real renderer stack.
 * @returns {Promise<object>}
 */
/**
 * @param {{fileAccess?: object}} [opts] - fileAccess: a fake MarkdownFileAccess (save tests)
 */
export async function setupApp({ fileAccess: fakeAccess } = {}) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  document.title = BASE_TITLE;
  const elements = createUiElements({ attach: true });
  const preview = elements.preview;
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  const mermaidLib = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
  const markdownRenderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  const scrollMemento = new ScrollMemento(preview);
  const meta = { fileName: "a.py", fileSize: 10, lineCount: 1, language: "python", lastModified: 0, updatedAtStr: "x" };
  const sourceFileRenderer = {
    render: vi.fn().mockResolvedValue(meta),
    reload: vi.fn().mockResolvedValue(meta),
    destroy: vi.fn(),
  };
  const state = new ApplicationState();
  const orchestrator = new RendererOrchestrator(
    state,
    markdownRenderer,
    new MermaidRenderer(preview, mermaidLib),
    new PlantUMLRenderer(preview, { encode: () => "ENC" }),
    scrollMemento,
    preview,
    sourceFileRenderer,
  );
  const scrollEngine = { startScroll: vi.fn(), stopScroll: vi.fn(), destroy: vi.fn() };
  const fileAccess = fakeAccess ?? new MarkdownFileAccess(window);
  const { result: ui, dispose } = trackGlobalListeners(
    () =>
      new UIController(orchestrator, state, elements, scrollEngine, {
        fileAccess,
        createPalette: (host) => new EditPalette(host),
        createBlockEdit: (host) => new BlockEditController(preview, orchestrator, markdownRenderer, scrollMemento, host),
      }),
  );
  const app = { ui, orchestrator, markdownRenderer, state, elements, preview, sourceFileRenderer, scrollEngine, fileAccess, mermaidLib };
  app.paletteRoot = () => document.body.querySelector(":scope > div.edit-palette");
  app.blockEditor = () => preview.querySelector(".md-block-editing > textarea.md-block-editor");
  app.block = (pred) => {
    const block = orchestrator.getModel().getBlocks().find(pred);
    return { block, el: block ? markdownRenderer.getBlockElement(block.id) : null };
  };
  app.teardown = () => {
    dispose();
    ui.blockEdit.dispatch("documentCleared");
    ui.palette.hide();
    app.paletteRoot()?.remove();
    for (const el of document.body.querySelectorAll(":scope > div.edit-palette-popover")) el.remove();
    elements._bar.remove();
    preview.remove();
    document.title = BASE_TITLE;
  };
  return app;
}
