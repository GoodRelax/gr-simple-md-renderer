import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/utils.js", async () => {
  const actual = await vi.importActual("../js/utils.js");
  return {
    ...actual,
    applyTheme: vi.fn(),
    applySystemTheme: vi.fn(),
    showToast: vi.fn(),
    waitForDOMStability: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../js/config.js", async () => ({
  ...(await vi.importActual("../js/config.js")),
  FILE_SYSTEM_HANDLE_SUPPORTED: true,
}));
vi.mock("../js/classes/ModalController.js", () => ({
  default: { setupModal: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));

import GitHubFileRef from "../js/classes/GitHubFileRef.js";
import GitHubLink from "../js/classes/GitHubLink.js";
import { setupApp, dropEvent, settle } from "./helpers/appStack.js";
import { tap, pointer, keydown } from "./helpers/editDom.js";
import { fakeFileAccess, fakeFileHandle } from "./helpers/fakeFs.js";

const IMAGE = "https://example.com/pic.png";
const DOC = `# Title\n\n![pic](${IMAGE})\n\nSee ![icon](https://example.com/icon.png?v=1) here.\n`;
const MARKED = /^https:\/\/example\.com\/pic\.png\?grsmd=(\d+)$/;

let app;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  app?.teardown();
  app = null;
  vi.restoreAllMocks();
});

/** Spec: INV-110 (1). Drop a .md file with a fake handle, so that Reload reads the handle. */
async function dropMd(text, name = "doc.md") {
  const handle = fakeFileHandle({ name, content: [text] });
  document.dispatchEvent(dropEvent(new File([text], name, { lastModified: 1000 }), handle));
  await settle();
  return handle;
}

/** Spec: INV-19. Click the first placeholder (confirm answers OK) and return the src of every image. */
function consentAndReadSources() {
  app.elements.preview.querySelector(".external-image-placeholder")?.click();
  return imageSources();
}

const imageSources = () => [...app.elements.preview.querySelectorAll("img")].map((img) => img.getAttribute("src"));

async function reload() {
  await app.ui.handleReload();
  await settle();
}

describe("AT-UI-111 Reload loads external images again (INV-110)", () => {
  // Spec: INV-110 (1)(2)(6).
  it("(a) Reload marks the image URLs; the document text, #editor and the saved body keep the URLs as written", async () => {
    app = await setupApp();
    await dropMd(DOC);
    expect(consentAndReadSources()).toEqual([IMAGE, "https://example.com/icon.png?v=1"]);

    await reload();
    const [pic, icon] = imageSources();
    const mark = MARKED.exec(pic)?.[1];
    expect(mark).toBeDefined();
    expect(icon).toBe(`https://example.com/icon.png?v=1&grsmd=${mark}`);
    expect(app.orchestrator.getBody()).toBe(DOC);
    expect(app.elements.editor.value).toBe(DOC);
    expect(app.ui.documents.session.getBodyText()).not.toContain("grsmd");
  });

  // Spec: INV-110 (1)(5).
  it("(b) a theme switch and a block commit keep the mark of the Reload; a second Reload makes a new one", async () => {
    app = await setupApp();
    await dropMd(DOC);
    consentAndReadSources();
    await reload();
    const first = imageSources()[0];

    keydown(document.body, "d");
    await settle();
    expect(imageSources()[0]).toBe(first);

    keydown(document.body, "e");
    const { el } = app.block((b) => b.type === "paragraph" && b.raw.startsWith("See"));
    tap(el.firstElementChild);
    const ta = app.blockEditor();
    expect(ta.value).toBe("See ![icon](https://example.com/icon.png?v=1) here.");
    ta.value = "See ![icon](https://example.com/icon.png?v=2) here.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    pointer(document.body, "pointerdown");
    pointer(document.body, "pointerup");
    await settle();
    const mark = MARKED.exec(first)[1];
    expect(imageSources()).toEqual([first, `https://example.com/icon.png?v=2&grsmd=${mark}`]);

    await reload();
    expect(imageSources()[0]).toMatch(MARKED);
    expect(imageSources()[0]).not.toBe(first);
  });

  // Spec: INV-110 (1).
  it("(c) after a Reload, an image whose consent is given later carries the mark", async () => {
    app = await setupApp();
    await dropMd(DOC);
    await reload();
    expect(imageSources()).toEqual([]);
    expect(consentAndReadSources()[0]).toMatch(MARKED);
  });

  // Spec: INV-110 (5).
  it("(d) opening another .md, Clear and a paste load images as written", async () => {
    app = await setupApp();
    await dropMd(DOC);
    consentAndReadSources();
    await reload();

    await dropMd(DOC, "other.md");
    expect(consentAndReadSources()[0]).toBe(IMAGE);

    await reload();
    app.elements.clearBtn.click();
    app.elements.editor.value = DOC;
    app.elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
    await app.ui.handleRender("light");
    await settle();
    expect(consentAndReadSources()[0]).toBe(IMAGE);
  });

  // Spec: INV-110 (1)(5).
  it("(e) the Reload of a GitHub document marks the image URLs; opening one does not", async () => {
    app = await setupApp({ fileAccess: fakeFileAccess({}) });
    app.ui.gitHub = { enabled: true, refresh: vi.fn(), handleKey: vi.fn(), reloadDialog: vi.fn(), askDropChoice: vi.fn() };
    const host = app.ui._gitHubHost();
    const ref = new GitHubFileRef("GoodRelax", "sample", "main", "docs/sample.md");
    const opened = () => ({ link: new GitHubLink({ ref, blobSha: "b1", fileText: DOC, isPrivate: false, lastCommit: null }), text: DOC, hasBom: false });

    await host.openDocument(opened());
    await settle();
    expect(consentAndReadSources()[0]).toBe(IMAGE);

    await host.reloadDocument(opened(), app.ui.documents.session.documentId);
    await settle();
    expect(imageSources()[0]).toMatch(MARKED);
  });

  // Spec: INV-110 (5)(6), INV-62.
  it("(f) a table cell image keeps the mark when another cell is committed; the cell, the table source and #editor keep the URL as written", async () => {
    const table = `# T

| A | B |
| --- | --- |
| ![i](${IMAGE}) | y |
`;
    app = await setupApp();
    await dropMd(table);
    consentAndReadSources();
    await reload();
    const marked = imageSources()[0];
    expect(marked).toMatch(MARKED);

    keydown(document.body, "e");
    const cells = () => app.elements.preview.querySelector("table").rows[1].cells;
    tap(cells()[0]);
    const imageCell = app.elements.preview.querySelector(".grsmd-cell-editing");
    expect(imageCell.textContent).toBe(`![i](${IMAGE})`);
    keydown(imageCell, "Tab");
    const other = app.elements.preview.querySelector(".grsmd-cell-editing");
    expect(other).toBe(cells()[1]);
    other.textContent = "z";
    other.dispatchEvent(new Event("input", { bubbles: true }));
    keydown(other, "Escape");
    await settle();

    const tableRaw = app.block((b) => b.type === "table").block.raw;
    expect(tableRaw).toContain(`| ![i](${IMAGE}) `);
    expect(tableRaw).toMatch(/\| z +\|$/m);
    expect(tableRaw).not.toContain("grsmd");
    expect(imageSources()).toEqual([marked]);
    expect(app.orchestrator.getBody()).not.toContain("grsmd");
    expect(app.elements.editor.value).not.toContain("grsmd");
  });
});
