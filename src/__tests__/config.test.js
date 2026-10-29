import { describe, it, expect } from "vitest";
import * as configModule from "../js/config.js";
import { CONFIG, EXT_TO_HLJS, FILE_TYPES, FILE_SYSTEM_HANDLE_SUPPORTED } from "../js/config.js";

describe("AT-CFG-11 INV-11, INV-18, CON-08: CONFIG file drop settings", () => {
  it("CONFIG.fileDrop.messages has no unused unsupportedType key", () => {
    expect(CONFIG.fileDrop.messages).not.toHaveProperty("unsupportedType");
  });

  it("CONFIG.fileDrop.messages.tooLarge exists", () => {
    expect(typeof CONFIG.fileDrop.messages.tooLarge).toBe("string");
    expect(CONFIG.fileDrop.messages.tooLarge.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.messages.readError exists", () => {
    expect(typeof CONFIG.fileDrop.messages.readError).toBe("string");
    expect(CONFIG.fileDrop.messages.readError.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.messages.binaryFile exists", () => {
    expect(typeof CONFIG.fileDrop.messages.binaryFile).toBe("string");
    expect(CONFIG.fileDrop.messages.binaryFile.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.maxBytes is 5 MB", () => {
    expect(CONFIG.fileDrop.maxBytes).toBe(5 * 1024 * 1024);
  });
});

// The plain English review of the UI texts (owner rulings R1-R15). Every
// text the user sees from JS is in CONFIG (R15); the static check AT-STA-15
// keeps it there.
describe("CONFIG UI texts in plain English", () => {
  const M = CONFIG.messages;
  const E = M.edit;

  it("AT-CFG-09 toasts (T02-T20)", () => {
    expect(E.downloadStarted("a.md")).toBe("Downloading: a.md. It's still not saved.");
    expect(E.savingInProgress).toBe("Still saving. Try again in a moment.");
    expect(E.reloadFailed).toBe("Couldn't reload the file.");
    expect(E.reloadCanceled).toBe("Reload stopped: the document changed.");
    expect(E.saveFailed).toBe("Couldn't save. Your changes are kept.");
    expect(E.saveDenied).toBe("Save not allowed. Your changes are kept.");
    expect(E.saveNotFound).toBe("Couldn't find the file. Use Save as.");
    expect(E.saveActivationLost).toBe("Save couldn't start. Press Save again.");
    expect(E.editorRenderedFirst).toBe("Updated from the top box. Try again.");
    expect(E.blockSplitFailed).toBe("You'll edit this document as one block.");
    expect(E.tableNotCellEditable).toBe("Can't edit by cell. Opened as Markdown.");
    expect(E.tableEditEnded).toBe("No longer a table. Table editing ended.");
    expect(E.noUrlInClipboard).toBe("Couldn't find a copied link.");
    expect(E.linkTargetChanged).toBe("The text changed, so no link was added.");
    expect(E.linkNotPastable).toBe("You can't paste a link here.");
    expect(E.formatNotApplicable).toBe("You can't use this format here.");
    expect(E.linkNotRemovable).toBe("There's no link to remove here.");
    expect(E.insertNotPossible).toBe("Can't insert here. Try outside this block.");
    expect(CONFIG.codeView.reloadUnavailableMsg).toBe("Reload works only in Chrome and Edge.");
    expect(CONFIG.codeView.reloadNoFileMsg).toBe("No file to reload. Drop a file first.");
  });

  it("AT-CFG-09 a toast is short: 40 characters or less without the file name (R11)", () => {
    const toasts = [
      E.saved(""), E.downloadStarted(""), E.savingInProgress, E.reloadFailed, E.reloadCanceled,
      E.saveFailed, E.saveDenied, E.saveNotFound, E.saveActivationLost, E.editorRenderedFirst,
      E.blockSplitFailed, E.tableNotCellEditable, E.tableEditEnded, E.noUrlInClipboard,
      E.linkTargetChanged, E.linkNotPastable, E.formatNotApplicable, E.linkNotRemovable,
      CONFIG.codeView.reloadUnavailableMsg, CONFIG.codeView.reloadNoFileMsg,
    ];
    for (const t of toasts) expect(t.length, t).toBeLessThanOrEqual(40);
  });

  it("AT-CFG-09 confirms and alerts (A01-A10)", () => {
    expect(CONFIG.fileDrop.messages.tooLarge).toBe("This file is too big. The limit is 5 MB.");
    expect(CONFIG.fileDrop.messages.readError).toBe("Couldn't read this file.");
    expect(CONFIG.fileDrop.messages.binaryFile).toBe("GRSMD can only open text files.");
    expect(CONFIG.fileDrop.messages.notAllowed).toBe("GRSMD can't open this type of file. It opens only known text file types."); // AT-FT-04 INV-18
    expect(M.copy.failed).toBe("Couldn't copy. Select the text and press Ctrl+C (Mac: Cmd+C).");
    expect(M.copy.blocked).toBe("Your browser blocked copying. Select the text and press Ctrl+C (Mac: Cmd+C).");
    expect(E.externalChangeConfirm).toBe("Something outside GRSMD changed this file. Replace it with your version?");
    expect(E.overwriteUnknownConfirm).toBe("GRSMD can't tell if this file changed since your last save. Replace it with your version?");
    expect(E.emptyEditorConfirm).toBe("The top box is empty.\nOK: make the document empty.\nCancel: put the document back in the top box.");
    expect(E.unsavedConfirm).toBe("You have unsaved changes. Discard them?"); // R9: unchanged
    expect(M.plantuml.consent).toBe("Is it OK to send your PlantUML diagram data to the official PlantUML server (www.plantuml.com)?");
    expect(M.externalImage.consent).toBe("Is it OK to get images from other sites?");
  });

  it("AT-CFG-09 the image dialog lists no hosts, so there is no maxHostsInDialog (R14)", () => {
    expect(CONFIG).not.toHaveProperty("externalImage");
  });

  it("AT-CFG-09 texts in diagrams and the preview (L01-L10)", () => {
    expect(M.plantuml.canceled).toBe("PlantUML diagram (not sent)");
    expect(M.plantuml.encodingFailed).toBe("Couldn't prepare this PlantUML diagram.");
    expect(M.plantuml.timeout(5)).toBe("The PlantUML server didn't answer in 5 seconds.");
    expect(M.plantuml.serverError).toBe("Couldn't get the diagram from the PlantUML server.");
    expect(M.externalImage.placeholder("Logo", "a.example")).toBe("Image from another site: Logo (a.example) - click to show");
    expect(M.externalImage.placeholder("", "a.example")).toBe("Image from another site (a.example) - click to show");
    expect(M.externalImage.placeholderTitle).toBe("Click to show images from other sites (asks you first)");
    expect(E.hiddenLinkDefinition).toBe("Hidden link address");
    expect(E.hiddenHtml).toBe("Hidden HTML");
    expect(M.markdown.parseError("boom")).toBe("Couldn't read this Markdown: boom");
    expect(M.diagram.tooltip).toBe("Ctrl+wheel: zoom | Double-click: reset | Drag: move");
  });

  it("AT-CFG-10 the start screen: four steps of one length; the 4th says how to start editing (FS-16, INV-57, AQ4)", () => {
    const lines = M.startScreen.split("\n");
    expect(lines.slice(0, 2)).toEqual(["Get started:", ""]);
    const steps = lines.slice(2);
    expect(steps).toHaveLength(4);
    steps.forEach((line, i) => expect(line.startsWith(`  ${i + 1}. `), line).toBe(true));
    for (const line of steps) expect(line.length, line).toBe(71);
    expect(steps[3].trimEnd()).toBe("  4. Double-click a block     ->  Edit  (touch or pen: [Edit], tap)"); // AQ13
    // INV-18: only the file types of the table open (no "any text file")
    expect(steps[2]).toBe("  3. Drop a text/code file    ->  Code View  (known types: .py .js ...)");
  });

  it("AT-CFG-09 palette names (P01-P03, R5, R6)", () => {
    expect(M.palette.linkPaste).toBe("Paste copied link");
    expect(M.palette.tableOptions).toBe("Align column");
    expect(M.palette.alignNone).toBe("Remove alignment");
  });

  it("AT-CFG-09 every UI text is ASCII (contractions use the ASCII apostrophe)", () => {
    const texts = [];
    const collect = (v) => {
      if (typeof v === "string") texts.push(v);
      else if (typeof v === "function") texts.push(String(v("X", "Y")));
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(CONFIG.messages);
    collect(CONFIG.fileDrop.messages);
    expect(texts.length).toBeGreaterThan(50);
    for (const t of texts) expect(/^[\x00-\x7f]*$/.test(t), t).toBe(true);
  });
});

describe("AT-CFG-12 INV-18, spec 5.3: EXT_TO_HLJS", () => {
  it("contains .py mapping to python", () => {
    expect(EXT_TO_HLJS[".py"]).toBe("python");
  });

  it("contains .js mapping to javascript", () => {
    expect(EXT_TO_HLJS[".js"]).toBe("javascript");
  });

  it("contains .md mapping to markdown", () => {
    expect(EXT_TO_HLJS[".md"]).toBe("markdown");
  });

  it("contains Dockerfile mapping to dockerfile", () => {
    expect(EXT_TO_HLJS["Dockerfile"]).toBe("dockerfile");
  });

  it("contains Makefile mapping to makefile", () => {
    expect(EXT_TO_HLJS["Makefile"]).toBe("makefile");
  });

  it("contains .txt mapping to plaintext", () => {
    expect(EXT_TO_HLJS[".txt"]).toBe("plaintext");
  });

  it("does not contain unknown extensions", () => {
    expect(EXT_TO_HLJS[".xyz"]).toBeUndefined();
    expect(EXT_TO_HLJS[".banana"]).toBeUndefined();
  });
});

describe("AT-CFG-13 INV-18, INV-102 (D29, owner rulings AQ1, AQ9): the file types come from FILE_TYPES; no black list", () => {
  it("AT-FT-04 INV-102 BINARY_EXTENSIONS is gone (D29)", () => {
    expect(configModule).not.toHaveProperty("BINARY_EXTENSIONS");
  });

  it("AT-FT-04 INV-102 markdownExtensions and EXT_TO_HLJS are made from FILE_TYPES", () => {
    expect(CONFIG.fileDrop.markdownExtensions).toEqual([".md", ".markdown"]);
    const colored = FILE_TYPES.filter((t) => t.hljs !== null);
    expect(Object.keys(EXT_TO_HLJS)).toEqual(colored.map((t) => t.match));
    for (const t of colored) expect(EXT_TO_HLJS[t.match], t.match).toBe(t.hljs);
  });

  it("AT-FT-04 INV-102 the AQ9 additions: .vue .svelte as XML, .env .properties as INI, the others with no colors", () => {
    expect([EXT_TO_HLJS[".vue"], EXT_TO_HLJS[".svelte"], EXT_TO_HLJS[".env"], EXT_TO_HLJS[".properties"]]).toEqual(["xml", "xml", "ini", "ini"]);
    const byMatch = new Map(FILE_TYPES.map((t) => [t.match, t]));
    for (const m of [".mmd", ".puml", ".plantuml", ".bat", ".cmd", ".rst", ".adoc", ".jsonl", ".gitignore", ".gitattributes", ".editorconfig", "LICENSE"]) {
      expect(byMatch.get(m), m).toMatchObject({ open: "code", hljs: null });
      expect(EXT_TO_HLJS, m).not.toHaveProperty(m);
    }
  });
});

describe("AT-CFG-14 INV-15: FILE_SYSTEM_HANDLE_SUPPORTED", () => {
  it("is a boolean", () => {
    expect(typeof FILE_SYSTEM_HANDLE_SUPPORTED).toBe("boolean");
  });
});

describe("AT-CFG-09 the palette's modifier key names come from CONFIG (strict review L2)", () => {
  it("Ctrl / Cmd", () => {
    expect(CONFIG.messages.palette.modifier).toEqual({ apple: "Cmd", other: "Ctrl" });
  });
});
