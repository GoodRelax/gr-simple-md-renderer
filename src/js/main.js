// ========================================
// Vendored libraries (bundled at build time; no runtime CDN fetch)
// ========================================
// The core (INV-81): marked, DOMPurify and the math tokenizer. mermaid,
// highlight.js, KaTeX and the PlantUML encoder are in the file after the
// core, and run on demand (LibraryLoader; src/js/lazy/).
import { marked } from "marked";
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
import { lazyMath } from "./lazyMath.js";
import LibraryLoader from "./classes/LibraryLoader.js";
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
import GitHubContentsClient from "./classes/GitHubContentsClient.js";
import GitHubController from "./classes/GitHubController.js";
import { resolveRelativeUrl } from "./gitHubUrl.js";

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

// window.__grsmdBoot comes from src/js/boot.js, which runs before the core.
// mermaid sanitizes its labels with the core's DOMPurify (one copy in the file).
const boot = window.__grsmdBoot;
boot.shared.dompurify = DOMPurify;
const libraries = new LibraryLoader(boot);

const math = lazyMath(markedKatex, { throwOnError: false });
marked.use(math.extension);

const state = new ApplicationState();
const scrollManager = new ScrollMemento(elements.preview);
const markdownRenderer = new MarkdownRenderer(
  elements.preview,
  marked,
  null,
  DOMPurify,
  undefined,
  math,
);
const mermaidRenderer = new MermaidRenderer(elements.preview, null);
const plantumlRenderer = new PlantUMLRenderer(
  elements.preview,
  null,
  () => libraries.get("plantuml"),
);

// SourceFileRenderer is owned by RendererOrchestrator
const sourceFileRenderer = new SourceFileRenderer(
  CONFIG,
  elements.preview,
  null,
  undefined,
  () => libraries.get("hljs"),
);

const orchestrator = new RendererOrchestrator(
  state,
  markdownRenderer,
  mermaidRenderer,
  plantumlRenderer,
  scrollManager,
  elements.preview,
  sourceFileRenderer,
  libraries,
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
// GitHub (SC-27): a mouse or trackpad device only (D15, D17), and not
// inside a frame (a <meta> CSP cannot forbid framing).
const gitHubEnabled = window.matchMedia("(pointer: fine)").matches && window.top === window.self;
const gitHubFetch = (url, init) => window.fetch(url, init);
const gitHubClient = new GitHubContentsClient(gitHubFetch, CONFIG.github);
// The browser keeps the token (owner ruling D25): after a request succeeds,
// Credential Management asks it to save the token (Chrome and Edge). The
// saved token comes back through the browser's autofill on the token field
// (D34); elsewhere the token is pasted.
const gitHubPasswordStore =
  typeof window.PasswordCredential === "function" && navigator.credentials
    ? { store: (id, password) => navigator.credentials.store(new window.PasswordCredential({ id, password })) }
    : null;
// relative images and links of a GitHub document resolve as GitHub shows them
/** @purity semi-pure-b */
markdownRenderer.setRelativeUrlResolver((value, kind) => {
  const link = documents.gitHub;
  return link ? resolveRelativeUrl(link.ref, value, kind, CONFIG.github) : null;
});
const byId = (id) => document.getElementById(id);
const ui = new UIController(orchestrator, state, elements, scrollEngine, {
  documents,
  createGitHub: (host) =>
    new GitHubController(
      {
        button: byId("gitHubBtn"),
        openDialog: byId("gitHubOpenDialog"),
        pushDialog: byId("gitHubPushDialog"),
        reloadDialog: byId("gitHubReloadDialog"),
        dropDialog: byId("gitHubDropDialog"),
        open: {
          form: byId("gitHubOpenForm"),
          url: byId("gitHubOpenUrl"),
          fields: byId("gitHubOpenFields"),
          repo: byId("gitHubOpenRepo"),
          branch: byId("gitHubOpenBranch"),
          path: byId("gitHubOpenPath"),
          token: byId("gitHubOpenToken"),
          error: byId("gitHubOpenError"),
          submit: byId("gitHubOpenSubmit"),
        },
        push: {
          form: byId("gitHubPushForm"),
          visibility: byId("gitHubPushVisibility"),
          repo: byId("gitHubPushRepo"),
          branch: byId("gitHubPushBranch"),
          path: byId("gitHubPushPath"),
          message: byId("gitHubPushMessage"),
          token: byId("gitHubPushToken"),
          error: byId("gitHubPushError"),
          submit: byId("gitHubPushSubmit"),
        },
        reload: {
          form: byId("gitHubReloadForm"),
          repo: byId("gitHubReloadRepo"),
          target: byId("gitHubReloadTarget"),
          token: byId("gitHubReloadToken"),
          error: byId("gitHubReloadError"),
          submit: byId("gitHubReloadSubmit"),
        },
        drop: {
          editing: byId("gitHubDropEditing"),
          lastCommit: byId("gitHubDropLastCommit"),
          dropped: byId("gitHubDropDropped"),
          notes: byId("gitHubDropNotes"),
          keep: byId("gitHubDropKeep"),
          stop: byId("gitHubDropStop"),
          cancel: byId("gitHubDropCancel"),
        },
      },
      gitHubClient,
      host,
      { ...CONFIG.github, enabled: gitHubEnabled, passwordStore: gitHubPasswordStore },
    ),
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

// The core runs (INV-81): a drop or paste made before it is taken now, and
// the libraries run one by one when the page is idle (owner ruling 2026-10-25).
const early = boot.takeEarlyInput();
if (early) ui.receiveEarlyInput(early);
libraries.preloadWhenIdle((name, library) => orchestrator.libraryLoaded(name, library));
performance.mark("grsmd-core-ready");
