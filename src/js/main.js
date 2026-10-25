// ========================================
// Vendored libraries (bundled at build time; no runtime CDN fetch)
// ========================================
import { marked } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js/lib/common";
import plantumlEncoder from "plantuml-encoder";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";

// Vendor CSS (inlined into the single file; katex fonts embedded as data URIs).
// No highlight.js theme: style.css colors the code (spec 5.8.1).
import "katex/dist/katex.min.css";

// ========================================
// Local Imports
// ========================================
import { CONFIG } from "./config.js";
import { isApplePlatform } from "./utils.js";
import ApplicationState from "./classes/ApplicationState.js";
import ScrollMemento from "./classes/ScrollMemento.js";
import MarkdownRenderer from "./classes/MarkdownRenderer.js";
import MermaidRenderer from "./classes/MermaidRenderer.js";
import PlantUMLRenderer from "./classes/PlantUMLRenderer.js";
import SmoothScrollEngine from "./classes/SmoothScrollEngine.js";
import SourceFileRenderer from "./classes/SourceFileRenderer.js";
import RendererOrchestrator from "./classes/RendererOrchestrator.js";
import DiagramZoomController from "./classes/DiagramZoomController.js";
import DiagramPanController from "./classes/DiagramPanController.js";
import DiagramCopyController from "./classes/DiagramCopyController.js";
import MarkdownFileAccess from "./classes/MarkdownFileAccess.js";
import SaveDocument from "./classes/SaveDocument.js";
import SaveDocumentAs from "./classes/SaveDocumentAs.js";
import DocumentLifecycle from "./classes/DocumentLifecycle.js";
import EditPalette from "./classes/EditPalette.js";
import BlockEditController from "./classes/BlockEditController.js";
import UIController from "./classes/UIController.js";
import HelpLanguageSwitch from "./classes/HelpLanguageSwitch.js";
import DocumentIndex from "./classes/DocumentIndex.js";
import DocumentSearch from "./classes/DocumentSearch.js";

// ========================================
// Initialization
// ========================================

const elements = {
  editor: document.getElementById("editor"),
  fileInfo: document.getElementById("fileInfo"),
  keyHint: document.getElementById("keyHint"),
  preview: document.getElementById("preview"),
  indexBtn: document.getElementById("indexBtn"),
  indexPanel: document.getElementById("indexPanel"),
  sidePanels: document.getElementById("sidePanels"),
  searchBtn: document.getElementById("searchBtn"),
  renderLightBtn: document.getElementById("renderLight"),
  renderDarkBtn: document.getElementById("renderDark"),
  reloadBtn: document.getElementById("reloadBtn"),
  newTabBtn: document.getElementById("newTabBtn"),
  editBtn: document.getElementById("editBtn"),
  clearBtn: document.getElementById("clearBtn"),
  helpBtn: document.getElementById("helpBtn"),
  helpModal: document.getElementById("helpModal"),
  promptModal: document.getElementById("promptModal"),
  promptText: document.getElementById("promptText"),
  copyPromptBtn: document.getElementById("copyPromptBtn"),
};

marked.use(markedKatex({ throwOnError: false }));

const state = new ApplicationState();
const scrollManager = new ScrollMemento(elements.preview);
const markdownRenderer = new MarkdownRenderer(
  elements.preview,
  marked,
  hljs,
  DOMPurify,
);
const mermaidRenderer = new MermaidRenderer(elements.preview, mermaid);
const plantumlRenderer = new PlantUMLRenderer(
  elements.preview,
  plantumlEncoder,
);

// SourceFileRenderer is owned by RendererOrchestrator
const sourceFileRenderer = new SourceFileRenderer(
  CONFIG,
  elements.preview,
  hljs,
);

const orchestrator = new RendererOrchestrator(
  state,
  markdownRenderer,
  mermaidRenderer,
  plantumlRenderer,
  scrollManager,
  elements.preview,
  sourceFileRenderer,
);

// SmoothScrollEngine: used by UIController keyboard handler
const scrollEngine = new SmoothScrollEngine(CONFIG.scroll, elements.preview);

// DocumentLifecycle: the session, the save target and the save state
// (INV-55, 11-e); the save use cases write through the file access.
const fileAccess = new MarkdownFileAccess(window);
const documents = new DocumentLifecycle(fileAccess, {
  saveDocument: new SaveDocument(fileAccess, CONFIG.messages.edit, CONFIG.edit.defaultFileName),
  saveDocumentAs: new SaveDocumentAs(fileAccess, CONFIG.messages.edit, CONFIG.edit.defaultFileName),
  messages: CONFIG.messages.edit,
  defaultFileName: CONFIG.edit.defaultFileName,
});

// UIController wires all events and initializes view. It owns the in-place
// editing parts and is their host (BlockEditHost, EditPaletteHost).
// INV-14: Cmd is the primary shortcut modifier on Apple platforms.
const isApple = isApplePlatform(navigator);
const documentIndex = new DocumentIndex(
  { button: elements.indexBtn, panel: elements.indexPanel, column: elements.sidePanels, preview: elements.preview },
  scrollManager,
  { emptyText: CONFIG.messages.index.empty },
);
new UIController(orchestrator, state, elements, scrollEngine, {
  documents,
  isApple,
  documentIndex,
  createSearch: (host) =>
    new DocumentSearch(
      {
        button: elements.searchBtn,
        column: elements.sidePanels,
        panel: document.getElementById("searchPanel"),
        preview: elements.preview,
        input: document.getElementById("searchInput"),
        matchCase: document.getElementById("searchCase"),
        regex: document.getElementById("searchRegex"),
        count: document.getElementById("searchCount"),
        prev: document.getElementById("searchPrev"),
        next: document.getElementById("searchNext"),
        close: document.getElementById("searchClose"),
        replaceRow: document.getElementById("replaceRow"),
        replaceInput: document.getElementById("replaceInput"),
        replaceOne: document.getElementById("replaceOneBtn"),
        replaceAll: document.getElementById("replaceAllBtn"),
      },
      scrollManager,
      {
        getModel: () => orchestrator.getModel(),
        blockElement: (id) => markdownRenderer.getBlockElement(id),
        replaceBody: (body, offset) => orchestrator.replaceBody(body, offset),
      },
      host,
      CONFIG.messages.search,
    ),
  createPalette: (host) => new EditPalette(host, { isApple }),
  createBlockEdit: (host) =>
    new BlockEditController(elements.preview, orchestrator, markdownRenderer, scrollManager, host),
});

// Help: English | Japanese. The first language follows the browser's; the
// choice is kept in memory only (SC-16).
new HelpLanguageSwitch(elements.helpModal, navigator.language);

// Diagram controllers: fine-pointer (mouse/trackpad) devices only
const isTouchCapable = window.matchMedia("(any-pointer: coarse)").matches;
if (window.matchMedia("(pointer: fine)").matches) {
  new DiagramZoomController(elements.preview);
  new DiagramCopyController(elements.preview);
  if (!isTouchCapable) {
    new DiagramPanController(elements.preview);
  }
}
