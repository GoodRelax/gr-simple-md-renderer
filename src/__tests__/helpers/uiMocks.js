import { vi } from "vitest";
import { CONFIG } from "../../js/config.js";
import SaveDocument from "../../js/classes/SaveDocument.js";
import SaveDocumentAs from "../../js/classes/SaveDocumentAs.js";
import DocumentLifecycle from "../../js/classes/DocumentLifecycle.js";

// Shared parts for UIController tests (test design section 8): the element
// set, inert in-place editing services, the methods the orchestrator mock
// needs for editing, and removal of document / window listeners.
// This file does not import UIController, so tests may still use
// vi.resetModules + vi.doMock before importing it. DocumentLifecycle reads
// no config (its messages are injected), so a mocked config does not reach it.

/**
 * A DocumentLifecycle composed as main.js composes it.
 * @param {object} fileAccess - MarkdownFileAccess or a fake
 */
export function createDocuments(fileAccess) {
  const messages = CONFIG.messages.edit;
  const name = CONFIG.edit.defaultFileName;
  return new DocumentLifecycle(fileAccess, {
    saveDocument: new SaveDocument(fileAccess, messages, name),
    saveDocumentAs: new SaveDocumentAs(fileAccess, messages, name),
    messages,
    defaultFileName: name,
  });
}

function modal() {
  const m = document.createElement("div");
  m.innerHTML = '<button class="close-btn"></button><button class="prompt-close"></button>';
  return m;
}

/**
 * Every element UIController wires (spec 5.1), including editBtn.
 * @param {{attach?: boolean}} [opts] - attach: put them in the document (focus tests)
 */
export function createUiElements({ attach = false } = {}) {
  const make = (tag, id) => Object.assign(document.createElement(tag), id ? { id } : {});
  const elements = {
    editor: make("textarea", "editor"),
    fileInfo: make("div", "fileInfo"),
    keyHint: make("div", "keyHint"),
    preview: make("div", "preview"),
    renderLightBtn: make("button", "renderLight"),
    renderDarkBtn: make("button", "renderDark"),
    reloadBtn: make("button", "reloadBtn"),
    newTabBtn: make("button", "newTabBtn"),
    editBtn: make("button", "editBtn"),
    saveBtn: make("button", "saveBtn"),
    clearBtn: make("button", "clearBtn"),
    helpBtn: make("button", "helpBtn"),
    helpModal: modal(),
    githubHelpModal: modal(),
    guideModal: modal(),
    promptModal: modal(),
    promptText: make("textarea", "promptText"),
    copyPromptBtn: make("button", "copyPromptBtn"),
  };
  if (attach) {
    const bar = make("div", "testTopBar");
    bar.append(elements.editor, elements.renderLightBtn, elements.renderDarkBtn, elements.reloadBtn, elements.editBtn, elements.saveBtn, elements.clearBtn);
    document.body.append(bar, elements.preview);
    elements._bar = bar;
  }
  return elements;
}

/**
 * Inert in-place editing services for tests that do not exercise editing.
 * The palette and the block editor are plain spies.
 */
export function fakeEditServices() {
  const palette = {
    show: vi.fn(),
    hide: vi.fn(),
    toggle: vi.fn(),
    isShown: vi.fn(() => false),
    contains: vi.fn(() => false),
    setStatusText: vi.fn(),
    setUnsaved: vi.fn(),
    setButtonStates: vi.fn(),
  };
  const blockEdit = {
    dispatch: vi.fn(),
    isEditing: vi.fn(() => false),
    isInTransition: vi.fn(() => false),
    isHugeBlock: vi.fn(() => false),
    hasUncommittedChange: vi.fn(() => false),
    getSelectionRange: vi.fn(() => null),
    applyTextEdit: vi.fn(),
    isEditingTable: vi.fn(() => false),
    isEditingCell: vi.fn(() => false),
    cellState: vi.fn(() => null),
    getLastOpenedBlockId: vi.fn(() => null),
    isInsertPending: vi.fn(() => false),
  };
  const fileAccess = { readFile: vi.fn(), noteFile: vi.fn() };
  return {
    fileAccess,
    documents: createDocuments(fileAccess),
    createPalette: () => palette,
    createBlockEdit: () => blockEdit,
    palette,
    blockEdit,
  };
}

/**
 * Add the methods UIController calls for editing to an orchestrator mock
 * (same object, so the test's spies stay valid).
 */
export function withEditMethods(orchestrator) {
  const defaults = {
    setModelChangedListener: vi.fn(),
    getBody: vi.fn(() => ""),
    getModel: vi.fn(() => null),
    canUndo: vi.fn(() => false),
    resetExternalImageConsent: vi.fn(),
  };
  for (const [key, value] of Object.entries(defaults)) if (!(key in orchestrator)) orchestrator[key] = value;
  return orchestrator;
}

/**
 * Run fn() and remember every listener added to document or window meanwhile,
 * so dispose() can remove them (jsdom keeps them between tests).
 */
export function trackGlobalListeners(fn) {
  const added = [];
  const original = EventTarget.prototype.addEventListener;
  const spy = vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (...args) {
    if (this === document) added.push([this, ...args]);
    return original.apply(this, args);
  });
  // jsdom gives window its own addEventListener, so the prototype spy misses it.
  const windowOriginal = window.addEventListener;
  const windowSpy = vi.spyOn(window, "addEventListener").mockImplementation(function (...args) {
    added.push([window, ...args]);
    return windowOriginal.apply(window, args);
  });
  let result;
  try {
    result = fn();
  } finally {
    spy.mockRestore();
    windowSpy.mockRestore();
  }
  const dispose = () => {
    for (const [target, type, listener, options] of added) target.removeEventListener(type, listener, options);
  };
  return { result, dispose };
}
