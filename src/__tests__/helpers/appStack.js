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
import DocumentIndex from "../../js/classes/DocumentIndex.js";
import DocumentSearch from "../../js/classes/DocumentSearch.js";
import { CONFIG } from "../../js/config.js";
import { createUiElements, trackGlobalListeners, createDocuments } from "./uiMocks.js";

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
 * @param {{fileAccess?: object, isApple?: boolean, clipboard?: object|null, withIndex?: boolean, withSearch?: boolean}} [opts] - fileAccess: a fake
 *   MarkdownFileAccess (save tests); isApple: Cmd is the primary modifier (INV-14);
 *   clipboard: a fake navigator.clipboard (INV-69; null: none); withIndex: the
 *   Index (INV-77) as main.js composes it (app.index, app.indexBtn, app.indexPanel);
 *   withSearch: Search (INV-80) as main.js composes it, with the panel of
 *   index.html (app.search, app.searchEl)
 */
export async function setupApp({ fileAccess: fakeAccess, isApple = false, clipboard, withIndex = false, withSearch = false } = {}) {
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
  const documents = createDocuments(fileAccess);
  const make = (tag, id) => Object.assign(document.createElement(tag), { id });
  const column = make("div", "sidePanels");
  document.body.append(column);
  let documentIndex;
  if (withIndex) {
    const button = make("button", "indexBtn");
    const panel = make("nav", "indexPanel");
    panel.hidden = true;
    column.append(panel);
    elements._bar.prepend(button);
    documentIndex = new DocumentIndex({ button, panel, column, preview, topbar: elements._bar }, { emptyText: "none" });
  }
  let searchEl = null;
  if (withSearch) {
    const button = make("button", "searchBtn");
    const panel = make("div", "searchPanel");
    panel.hidden = true;
    panel.innerHTML =
      '<input id="searchInput" type="text" /><button id="searchCase" aria-pressed="false">Aa</button>' +
      '<button id="searchRegex" aria-pressed="false">.*</button><span id="searchCount"></span>' +
      '<button id="searchPrev"></button><button id="searchNext"></button><button id="searchClose"></button>' +
      '<div id="replaceRow"><input id="replaceInput" type="text" disabled /><button id="replaceOneBtn" disabled>Replace</button>' +
      '<button id="replaceAllBtn" disabled>All</button></div>';
    column.prepend(panel);
    elements._bar.prepend(button);
    const find = (id) => panel.querySelector(`#${id}`);
    searchEl = {
      button,
      column,
      panel,
      preview,
      topbar: elements._bar,
      input: find("searchInput"),
      matchCase: find("searchCase"),
      regex: find("searchRegex"),
      count: find("searchCount"),
      prev: find("searchPrev"),
      next: find("searchNext"),
      close: find("searchClose"),
      replaceRow: find("replaceRow"),
      replaceInput: find("replaceInput"),
      replaceOne: find("replaceOneBtn"),
      replaceAll: find("replaceAllBtn"),
    };
  }
  const { result: ui, dispose } = trackGlobalListeners(
    () =>
      new UIController(orchestrator, state, elements, scrollEngine, {
        documents,
        isApple,
        ...(clipboard === undefined ? {} : { clipboard }),
        ...(documentIndex ? { documentIndex } : {}),
        ...(searchEl
          ? {
              createSearch: (host) =>
                new DocumentSearch(
                  searchEl,
                  {
                    getModel: () => orchestrator.getModel(),
                    blockElement: (id) => markdownRenderer.getBlockElement(id),
                    replaceBody: (body, offset) => orchestrator.replaceBody(body, offset),
                  },
                  host,
                  CONFIG.messages.search,
                ),
            }
          : {}),
        createPalette: (host) => new EditPalette(host, { isApple }),
        createBlockEdit: (host) => new BlockEditController(preview, orchestrator, markdownRenderer, scrollMemento, host),
      }),
  );
  const app = { ui, orchestrator, markdownRenderer, state, elements, preview, sourceFileRenderer, scrollEngine, fileAccess, documents, mermaidLib };
  if (documentIndex) Object.assign(app, { index: documentIndex, indexBtn: documentIndex.button, indexPanel: documentIndex.panel });
  if (searchEl) Object.assign(app, { search: ui.documentSearch, searchEl });
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
    documentIndex?.hide();
    ui.documentSearch?.hide();
    column.remove();
    elements._bar.remove();
    preview.remove();
    document.title = BASE_TITLE;
  };
  return app;
}
