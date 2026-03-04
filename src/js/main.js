// ========================================
// CDN Imports (ES Modules)
// ========================================
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs";
import hljs from "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/highlight.min.js";
import plantumlEncoder from "https://cdn.jsdelivr.net/npm/plantuml-encoder@1.4.0/+esm";
import markedKatex from "https://cdn.jsdelivr.net/npm/marked-katex-extension@5.1.6/+esm";

// ========================================
// Local Imports
// ========================================
import { CONFIG } from "./config.js";
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
import UIController from "./classes/UIController.js";

// ========================================
// Initialization
// ========================================

const elements = {
  editor: document.getElementById("editor"),
  fileInfo: document.getElementById("fileInfo"),
  keyHint: document.getElementById("keyHint"),
  preview: document.getElementById("preview"),
  renderLightBtn: document.getElementById("renderLight"),
  renderDarkBtn: document.getElementById("renderDark"),
  reloadBtn: document.getElementById("reloadBtn"),
  newTabBtn: document.getElementById("newTabBtn"),
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

// UIController wires all events and initializes view
new UIController(orchestrator, state, elements, scrollEngine);

// Diagram controllers: fine-pointer (mouse/trackpad) devices only
const isTouchCapable = window.matchMedia("(any-pointer: coarse)").matches;
if (window.matchMedia("(pointer: fine)").matches) {
  new DiagramZoomController(elements.preview);
  new DiagramCopyController(elements.preview);
  if (!isTouchCapable) {
    new DiagramPanController(elements.preview);
  }
}
