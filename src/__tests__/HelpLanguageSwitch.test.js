import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import HelpLanguageSwitch from "../js/classes/HelpLanguageSwitch.js";

// AT-HLP-01..06: the help's English | Japanese switch (SC-16, FS-10, R1) and
// the help markup in src/index.html (R1, R2, R3).

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(here, "../index.html"), "utf8");
const DOWNLOAD_URL =
  "https://github.com/GoodRelax/gr-simple-md-renderer/releases/latest/download/GRSMD.html";

/** The real #helpModal of src/index.html, attached to the document. */
function helpModal() {
  const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  const modal = document.importNode(doc.getElementById("helpModal"), true);
  document.body.appendChild(modal);
  return modal;
}

const body = (modal, lang) => modal.querySelector(`.help-body[lang="${lang}"]`);
const button = (modal, lang) => modal.querySelector(`[data-help-lang="${lang}"]`);

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("HelpLanguageSwitch (AT-HLP-01..04)", () => {
  it.each([
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["JA-jp", "ja"],
    ["en-US", "en"],
    ["en", "en"],
    ["fr-FR", "en"],
    ["jv", "en"],
    ["jaa", "en"],
    ["", "en"],
    [undefined, "en"],
  ])("AT-HLP-01 the first language for the browser language %j is %s", (tag, lang) => {
    expect(HelpLanguageSwitch.initialLanguage(tag)).toBe(lang);
  });

  it.each([
    ["en-US", "en", "ja"],
    ["ja-JP", "ja", "en"],
  ])("AT-HLP-02 with %s, only the %s body shows, and its button is pressed", (tag, shown, other) => {
    const modal = helpModal();
    const sw = new HelpLanguageSwitch(modal, tag);
    expect(sw.language).toBe(shown);
    expect(body(modal, shown).hidden).toBe(false);
    expect(body(modal, other).hidden).toBe(true);
    expect(button(modal, shown).getAttribute("aria-pressed")).toBe("true");
    expect(button(modal, other).getAttribute("aria-pressed")).toBe("false");
  });

  it("AT-HLP-02 a press shows the other body only; pressing the shown one again changes nothing", () => {
    const modal = helpModal();
    const sw = new HelpLanguageSwitch(modal, "en-US");
    button(modal, "ja").click();
    expect(sw.language).toBe("ja");
    expect(body(modal, "ja").hidden).toBe(false);
    expect(body(modal, "en").hidden).toBe(true);
    expect(button(modal, "ja").getAttribute("aria-pressed")).toBe("true");
    expect(button(modal, "en").getAttribute("aria-pressed")).toBe("false");
    button(modal, "ja").click();
    expect(sw.language).toBe("ja");
    expect(body(modal, "en").hidden).toBe(true);
    button(modal, "en").click();
    expect(sw.language).toBe("en");
    expect(body(modal, "ja").hidden).toBe(true);
  });

  it("AT-HLP-02 an unknown language is ignored", () => {
    const modal = helpModal();
    const sw = new HelpLanguageSwitch(modal, "ja");
    sw.setLanguage("fr");
    expect(sw.language).toBe("ja");
    expect(body(modal, "ja").hidden).toBe(false);
  });

  it("AT-HLP-03 the choice is kept in memory only: no storage, no cookie (CON-03)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    const modal = helpModal();
    new HelpLanguageSwitch(modal, "en");
    button(modal, "ja").click();
    button(modal, "en").click();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it("AT-HLP-04 the constructor refuses markup without one body and one button per language", () => {
    const modal = helpModal();
    body(modal, "ja").remove();
    expect(() => new HelpLanguageSwitch(modal, "en")).toThrow(/"ja"/);
    const other = helpModal();
    button(other, "en").remove();
    expect(() => new HelpLanguageSwitch(other, "en")).toThrow(/"en"/);
  });
});

describe("help markup in src/index.html (AT-HLP-05, AT-HLP-06)", () => {
  it("AT-HLP-05 two bodies (en, ja) with the same sections in the same order; English is the default before the script runs", () => {
    const modal = helpModal();
    const bodies = [...modal.querySelectorAll(".help-body")];
    expect(bodies.map((b) => b.getAttribute("lang"))).toEqual(["en", "ja"]);
    const sections = (b) => [...b.querySelectorAll(":scope > [data-help-section]")].map((s) => s.dataset.helpSection);
    expect(sections(bodies[0])).toEqual(["download", "about", "usage", "details", "privacy", "samples", "licenses"]);
    expect(sections(bodies[1])).toEqual(sections(bodies[0]));
    expect(bodies[0].hidden).toBe(false);
    expect(bodies[1].hidden).toBe(true);
    // the same number of items and sub-headings in each section
    for (const name of sections(bodies[0])) {
      const count = (b, sel) => b.querySelectorAll(`[data-help-section="${name}"] ${sel}`).length;
      for (const sel of ["li", "h4", "a"]) {
        expect(count(bodies[1], sel), `${name} ${sel}`).toBe(count(bodies[0], sel));
      }
    }
    // no "(Japanese)" in the headings any more
    expect(modal.textContent).not.toContain("(Japanese)");
  });

  it("AT-HLP-05 the title row: the new name, the English | Japanese switch, and a close button", () => {
    const modal = helpModal();
    const head = modal.querySelector(".help-head");
    expect(head.querySelector("h2").textContent.trim()).toBe("GR Simple Markdown");
    const group = head.querySelector(".help-lang");
    expect(group.getAttribute("role")).toBe("group");
    expect([...group.querySelectorAll("button")].map((b) => [b.type, b.dataset.helpLang, b.textContent])).toEqual([
      ["button", "en", "English"],
      ["button", "ja", "Japanese"],
    ]);
    const close = head.querySelector(".close-btn");
    expect(close.tagName).toBe("BUTTON");
    expect(close.type).toBe("button");
    expect(close.getAttribute("aria-label")).toBe("Close");
  });

  it("AT-HLP-05 the prompt modal's close control is a button too", () => {
    const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
    const close = doc.querySelector("#promptModal .prompt-close");
    expect(close.tagName).toBe("BUTTON");
    expect(close.getAttribute("type")).toBe("button");
    expect(close.getAttribute("aria-label")).toBe("Close");
  });

  it("AT-HLP-05 each body starts with the download box: the latest release's GRSMD.html, a new tab, no opener or referrer, one version slot", () => {
    const modal = helpModal();
    for (const lang of ["en", "ja"]) {
      const box = body(modal, lang).firstElementChild;
      expect(box.dataset.helpSection).toBe("download");
      const links = box.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toBe(DOWNLOAD_URL);
      expect(links[0].getAttribute("target")).toBe("_blank");
      expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
      expect(links[0].hasAttribute("download")).toBe(false);
      const slots = box.querySelectorAll("[data-build-version]");
      expect(slots).toHaveLength(1);
      expect(slots[0].querySelectorAll('[data-build-kind="release"]')).toHaveLength(1);
      expect(slots[0].querySelectorAll('[data-build-kind="dev"]')).toHaveLength(1);
      expect(slots[0].querySelector("time").textContent).toBe(""); // filled by the build (buildVersion)
    }
    expect(modal.querySelectorAll("[data-build-version]")).toHaveLength(2);
  });

  it("AT-HLP-06 every link in the help opens a new tab without opener or referrer", () => {
    const modal = helpModal();
    const links = [...modal.querySelectorAll("a")];
    expect(links.length).toBe(6); // download x2, samples x2 x2
    for (const a of links) {
      expect(a.getAttribute("target"), a.href).toBe("_blank");
      expect(a.getAttribute("rel"), a.href).toBe("noopener noreferrer");
    }
  });

  it("AT-HLP-06 the header logo and the page title carry the new name (R5, R6)", () => {
    const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
    expect(doc.querySelector("#title").textContent.trim()).toBe("GR Simple Markdown");
    expect(doc.title).toContain("GR Simple Markdown");
    const ld = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    expect(ld.name).toBe("GR Simple Markdown");
    expect(ld.alternateName).toEqual(["GR Simple MD Renderer & Viewer", "GRSMD"]);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[property="twitter:description"]']) {
      const content = doc.querySelector(sel).getAttribute("content");
      expect(content, sel).toContain("formerly GR Simple MD Renderer & Viewer");
      // R6: the intent of the rename (coordinator ruling M2 (c): the titles stay short)
      expect(content, sel).toContain("Renamed because it now edits documents, not just renders them.");
    }
    // no viewport meta (phones lay the page out 980 px wide, N6)
    expect(doc.querySelector('meta[name="viewport"]')).toBeNull();
  });
});
