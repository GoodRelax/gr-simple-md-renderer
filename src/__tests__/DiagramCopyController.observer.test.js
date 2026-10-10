import { describe, it, expect, vi, afterEach } from "vitest";
import DiagramCopyController from "../js/classes/DiagramCopyController.js";

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

describe("DiagramCopyController attaches bars to added diagram containers only", () => {
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
