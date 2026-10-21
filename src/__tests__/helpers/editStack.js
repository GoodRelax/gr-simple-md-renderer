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

// Test files that use this helper must mock utils.waitForDOMStability
// (jsdom has no ResizeObserver), as performance.inplaceEdit.test.js does.

/**
 * A fake BlockEditHost (the port UIController implements in unit f).
 * The palette and the popover are real elements outside the preview, found by reference.
 */
export function fakeHost() {
  const palette = document.createElement("div");
  palette.setAttribute("role", "toolbar");
  palette.innerHTML = '<button type="button">B</button><button type="button">I</button>';
  const popover = document.createElement("div");
  popover.innerHTML = '<button type="button">Flowchart</button>';
  document.body.append(palette, popover);
  const host = {
    palette,
    popover,
    shown: false,
    editorChanged: false,
    showPalette: vi.fn(() => {
      host.shown = true;
    }),
    hidePalette: vi.fn(() => {
      host.shown = false;
    }),
    isPaletteNode: vi.fn((node) => palette.contains(node) || popover.contains(node)),
    isEditorChangedSinceRender: vi.fn(() => host.editorChanged),
    renderFromEditor: vi.fn(),
    onEditorInput: vi.fn(),
    onEditStateChanged: vi.fn(),
  };
  return host;
}

/** Let the render queue (partial renders) finish. */
export async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Real renderer stack + real orchestrator + BlockEditController with a fake host.
 * @param {string} md - document to load
 * @param {{editMode?: boolean}} [opts] - editMode: the palette is shown (paletteShown dispatched)
 */
export async function setupEdit(md, { editMode = true } = {}) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const preview = document.createElement("div");
  preview.id = "preview";
  document.body.appendChild(preview);
  const marked = new Marked();
  marked.use(markedKatex({ throwOnError: false }));
  const mermaidLib = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
  const markdownRenderer = new MarkdownRenderer(preview, marked, hljs, DOMPurify);
  const scrollMemento = new ScrollMemento(preview);
  const orchestrator = new RendererOrchestrator(
    new ApplicationState(),
    markdownRenderer,
    new MermaidRenderer(preview, mermaidLib),
    new PlantUMLRenderer(preview, { encode: () => "ENC" }),
    scrollMemento,
    preview,
    { render: vi.fn(), reload: vi.fn(), destroy: vi.fn() },
  );
  const host = fakeHost();
  const bec = new BlockEditController(preview, orchestrator, markdownRenderer, scrollMemento, host);
  if (md !== null) await orchestrator.loadMarkdown(md, "light");
  if (editMode) {
    host.shown = true; // UIController shows the palette, then tells the controller
    bec.dispatch("paletteShown");
  }
  const s = { preview, orchestrator, markdownRenderer, scrollMemento, mermaidLib, host, bec };
  /** First block matching pred, with its wrapper on screen. */
  s.block = (pred) => {
    const block = orchestrator.getModel().getBlocks().find(pred);
    return { block, el: block ? markdownRenderer.getBlockElement(block.id) : null };
  };
  /** The open block editor (the controller's own textarea), or null. */
  s.editor = () => preview.querySelector(".md-block-editing > textarea.md-block-editor");
  s.teardown = () => {
    bec.dispatch("documentCleared");
    preview.remove();
    host.palette.remove();
    host.popover.remove();
  };
  return s;
}
