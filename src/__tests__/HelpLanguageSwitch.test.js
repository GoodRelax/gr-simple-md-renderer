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

/** The real #guideModal (More details, HT-3) of src/index.html, attached. */
function guideModal() {
  const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  const modal = document.importNode(doc.getElementById("guideModal"), true);
  document.body.appendChild(modal);
  return modal;
}
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

describe("help markup in src/index.html (AT-HLP-05, AT-HLP-06, AT-HLP-14)", () => {
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

  it("AT-HLP-14 INV-85, NE-32, HT-3: the code view item of More details says, in both languages, that a file of 200 KB or more takes time to show and edit", () => {
    const modal = guideModal();
    const codeItem = (lang) => [...body(modal, lang).querySelectorAll("li")].find((li) => li.textContent.includes("Cmd+Option+["));
    const en = codeItem("en").textContent.replace(/\s+/g, " ");
    expect(en).toContain("A file of 200 KB or more may take time to show and edit (a toast says so when you start editing).");
    // "200 KB <ijou>" (200 KB or more) and "<jikan ga kakarimasu>" (takes time), as in the owner's words (NE-32)
    const ja = codeItem("ja").textContent.replace(/\s+/g, " ");
    expect(ja).toContain("200 KB \u4ee5\u4e0a");
    expect(ja).toContain("\u6642\u9593\u304c\u304b\u304b\u308a\u307e\u3059");
  });

  it("AT-HLP-20 INV-105, PL-19, PL-23, HT-3: More details has the [Save] line after the start of editing, with Ctrl+V and no word of the launcher (PL-15)", () => {
    const modal = guideModal();
    for (const lang of ["en", "ja"]) {
      const items = [...body(modal, lang).querySelectorAll('[data-guide-section="details"] li')];
      const at = items.findIndex((li) => li.textContent.trim().startsWith("[Save]"));
      expect(at, lang).toBeGreaterThan(0);
      expect(items[at - 1].textContent, lang).toContain("[Edit]"); // the start of editing stays right after [Edit] (the help scenario of SC-16)
      const text = items[at].textContent.replace(/\s+/g, " ");
      expect(text, lang).toContain("Ctrl+S");
      expect(text, lang).toContain("Ctrl+V");
      expect(text, lang).toContain("GRSMD");
      // "<kidouyaku>" (the launcher) in Japanese
      for (const word of ["launcher", "PowerShell", "Open-Grsmd", "\u8d77\u52d5\u5f79"]) expect(text.includes(word), `${lang} ${word}`).toBe(false);
    }
    expect(body(modal, "en").textContent.replace(/\s+/g, " ")).toContain(
      "[Save] : Same as Ctrl+S. When GRSMD knows where the file is, it puts that path on the clipboard: paste it with Ctrl+V as the file name",
    );
  });
});

describe("the short help and More details in src/index.html (AT-HLP-21, AT-HLP-22)", () => {
  const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
  // "kuwashii tsukaikata" (More details; HT-3)
  const JA_ENTRY = "\u8a73\u3057\u3044\u4f7f\u3044\u65b9";

  it("AT-HLP-21 HT-1, HT-4, D40: the short help has 4 ways to start, 11 lines of buttons and keys with the entry to More details last, and 5 privacy lines", () => {
    const modal = helpModal();
    for (const lang of ["en", "ja"]) {
      const section = (name) => body(modal, lang).querySelector(`[data-help-section="${name}"]`);
      expect(section("usage").querySelectorAll("ol > li"), lang).toHaveLength(4);
      const keys = [...section("details").querySelectorAll("ul > li")].map((li) => text(li).split(" : ")[0]);
      expect(keys, lang).toEqual([
        "[Index] / I",
        "[Find] / F",
        "[Render Light] / L, [Render Dark] / D".replace(", ", lang === "ja" ? "\u3001" : ", "),
        "[Reload] / R",
        "[New Tab] / N",
        "[Edit] / E",
        "[Save] / Ctrl+S",
        "[Clear] / C",
        "[?]",
        "Esc",
        "Ctrl+Z / Ctrl+Y",
      ]);
      const entry = section("details").lastElementChild;
      expect(entry.matches("button[type='button'][data-open-guide]"), lang).toBe(true);
      expect(text(entry), lang).toBe(lang === "en" ? "More Details" : JA_ENTRY);
      expect(section("privacy").querySelectorAll("ul > li"), lang).toHaveLength(5);
      // the privacy lines name each place GRSMD may send to or open
      for (const word of ["PlantUML", "github.com", "DOMPurify", "CSP"]) {
        expect(text(section("privacy")), `${lang} ${word}`).toContain(word);
      }
    }
    // the English lines the owner's ruling HT-4 settled
    const en = text(body(modal, "en"));
    expect(en).toContain("GRSMD sends what you edit outside only when you allow it.");
  });

  it("AT-HLP-21 HT-1: only Licenses is folded: a closed <details> with the heading as its summary, holding the list slot", () => {
    const modal = helpModal();
    expect(modal.querySelectorAll("details")).toHaveLength(2);
    for (const lang of ["en", "ja"]) {
      const fold = body(modal, lang).querySelector('[data-help-section="licenses"] > details.help-fold');
      expect(fold, lang).not.toBeNull();
      expect(fold.open, lang).toBe(false);
      expect(fold.querySelector(":scope > summary > h3"), lang).not.toBeNull();
      expect(fold.querySelectorAll("[data-third-party-list]"), lang).toHaveLength(1);
    }
  });

  it("AT-HLP-22 HT-3: More details is a layer with the title row and two bodies holding the same sections, moved from the help", () => {
    const guide = guideModal();
    expect(guide.classList.contains("modal")).toBe(true);
    expect(guide.querySelector(".help-head h2").textContent).toBe("More Details");
    expect([...guide.querySelectorAll("[data-help-lang]")].map((el) => el.dataset.helpLang)).toEqual(["en", "ja"]);
    expect(guide.querySelectorAll(".help-head .close-btn")).toHaveLength(1);
    expect([...guide.querySelectorAll(".help-body")].map((el) => [el.lang, el.hidden])).toEqual([
      ["en", false],
      ["ja", true],
    ]);
    const sections = (lang) => [...body(guide, lang).querySelectorAll(":scope > [data-guide-section]")];
    expect(sections("en").map((el) => el.dataset.guideSection)).toEqual(["usage", "details", "privacy"]);
    expect(sections("ja").map((el) => el.dataset.guideSection)).toEqual(["usage", "details", "privacy"]);
    for (const [i, el] of sections("en").entries()) {
      expect(sections("ja")[i].querySelectorAll("li").length, el.dataset.guideSection).toBe(el.querySelectorAll("li").length);
    }
    // the detailed text keeps what the spec asks the help to say (5.19.13, CON-12, INV-02)
    const en = text(body(guide, "en"));
    expect(en).toContain("Copy SVG / PNG of such a diagram fetches it again without asking.");
    expect(en).toContain("To withdraw it, open the site settings for goodrelax.github.io");
    expect(en).toContain("A dropped file can be up to 5 MB.");
    expect(en).toContain("save before you replace with one.");
    // nothing to fetch and no links: the layer is text only
    expect(guide.querySelectorAll("a, img, svg, iframe, object, embed, script, link")).toHaveLength(0);
  });
});

describe("no GitHub editing in the help (AT-HLP-26, D40)", () => {
  const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const doc = () => new DOMParser().parseFromString(INDEX_HTML, "text/html");

  it("AT-HLP-26 D40: the page has no GitHub help layer, no entry to it and no figures of it", () => {
    const d = doc();
    expect(d.getElementById("githubHelpModal")).toBeNull();
    expect(d.querySelectorAll("[data-open-github-help], svg.ghf-defs, svg.ghf")).toHaveLength(0);
  });

  it("AT-HLP-26 D40: neither the help nor More details names GitHub editing, in either language", () => {
    const d = doc();
    for (const id of ["helpModal", "guideModal"]) {
      for (const lang of ["en", "ja"]) {
        const words = text(d.getElementById(id).querySelector(`.help-body[lang="${lang}"]`));
        for (const word of ["api.github.com", "[Open GitHub]", "[Push to GitHub]", "Push", "personal access token"]) {
          expect(words, `${id} ${lang} ${word}`).not.toContain(word);
        }
        // "GitHub renkei" (GitHub editing)
        expect(words, `${id} ${lang}`).not.toContain("GitHub \u9023\u643a");
        expect(words, `${id} ${lang}`).not.toMatch(/GitHub editing|from GitHub/);
      }
    }
  });

  it("AT-HLP-26 D40: the page's description promises no GitHub request", () => {
    const description = doc().querySelector('meta[name="description"]').getAttribute("content");
    expect(description).not.toMatch(/GitHub/);
    expect(description).toContain("unless you explicitly allow PlantUML rendering or external images.");
  });
});
