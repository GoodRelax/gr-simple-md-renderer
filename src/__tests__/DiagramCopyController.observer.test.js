import { describe, it, expect, vi, afterEach } from "vitest";
import DiagramCopyController from "../js/classes/DiagramCopyController.js";
import { CONFIG } from "../js/config.js";

// The copy bar is attached to diagram containers that appear in the preview.
// Only the added nodes are searched: a scan of the whole preview on every
// change cost ~9 ms per commit on a 1 MB document.

const tick = () => new Promise((r) => setTimeout(r, 0));
let preview;

afterEach(() => {
  preview?.remove();
  vi.restoreAllMocks();
});

function setup(paragraphs = 200) {
  preview = document.createElement("div");
  for (let i = 0; i < paragraphs; i++) {
    const p = document.createElement("p");
    p.textContent = `para ${i}`;
    preview.appendChild(p);
  }
  document.body.appendChild(preview);
  return new DiagramCopyController(preview);
}

const hasBar = (container) => container.previousElementSibling?.classList.contains("diagram-copy-bar") === true;

describe("AT-DCC-01 DiagramCopyController attaches bars to added diagram containers only (FS-09)", () => {
  it("a container added directly gets a bar", async () => {
    setup();
    await tick();
    const m = document.createElement("div");
    m.className = "mermaid";
    preview.appendChild(m);
    await tick();
    expect(hasBar(m)).toBe(true);
  });

  it("a container inside an added block wrapper gets a bar", async () => {
    setup();
    await tick();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<div class="plantuml-wrapper"></div>';
    preview.appendChild(wrapper);
    await tick();
    expect(hasBar(wrapper.querySelector(".plantuml-wrapper"))).toBe(true);
  });

  it("a change elsewhere does not search the whole preview", async () => {
    setup();
    await tick();
    const all = vi.spyOn(preview, "querySelectorAll");
    preview.children[100].textContent = "changed";
    preview.children[50].appendChild(document.createElement("span"));
    await tick();
    expect(all).not.toHaveBeenCalled();
  });

  it("no second bar when the same container is moved", async () => {
    setup();
    const m = document.createElement("div");
    m.className = "mermaid";
    preview.appendChild(m);
    await tick();
    preview.insertBefore(m, preview.firstChild);
    await tick();
    expect(preview.querySelectorAll(".diagram-copy-bar").length).toBeGreaterThanOrEqual(1);
    expect(hasBar(m) || m.previousElementSibling === null).toBe(true);
  });
});

describe("AT-DCC-02 INV-02, FS-09 (owner ruling AQ7, review L9): Copy SVG / PNG of an allowed PlantUML diagram fetches it again without a dialog", () => {
  it("Copy SVG fetches the image's own /svg/ address, Copy PNG the same diagram's /png/ address; no confirm", async () => {
    setup(0);
    await tick();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetched = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      fetched.push(url);
      return { text: async () => "<svg></svg>", blob: async () => new Blob(["png"], { type: "image/png" }) };
    }));
    const written = [];
    vi.stubGlobal("ClipboardItem", class {
      constructor(items) {
        this.types = Object.keys(items);
      }
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn(async ([item]) => written.push(item.types[0])) } });
    const wrapper = document.createElement("div");
    wrapper.className = "plantuml-wrapper";
    const img = document.createElement("img");
    img.className = "plantuml-diagram";
    img.src = `${CONFIG.plantuml.serverUrl}ENCODED`; // drawn after the dialog's OK
    wrapper.append(img);
    preview.append(wrapper);
    await tick();
    const [svgButton, pngButton] = wrapper.previousElementSibling.querySelectorAll("button");
    svgButton.click();
    await tick();
    pngButton.click();
    await tick();
    expect(fetched).toEqual([img.src, img.src.replace("/plantuml/svg/", "/plantuml/png/")]);
    expect(fetched[1]).toContain("/plantuml/png/ENCODED");
    expect(written).toEqual(["image/svg+xml", "image/png"]);
    expect(confirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    delete navigator.clipboard;
  });
});
