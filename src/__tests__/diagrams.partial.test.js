import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PlantUMLRenderer from "../js/classes/PlantUMLRenderer.js";
import MermaidRenderer from "../js/classes/MermaidRenderer.js";
import ExternalImageGate from "../js/classes/ExternalImageGate.js";
import { CONFIG } from "../js/config.js";

const SERVER = CONFIG.plantuml.serverUrl;
const PUML = (body) => `<pre><code class="language-plantuml">@startuml\n${body}\n@enduml</code></pre>`;
const MERMAID = (body) => `<pre><code class="language-mermaid">flowchart TD\n${body}</code></pre>`;

describe("partial diagram rendering (INV-23, INV-42)", () => {
  let preview;
  let encoder;

  beforeEach(() => {
    vi.useFakeTimers();
    preview = document.createElement("div");
    document.body.appendChild(preview);
    encoder = { encode: vi.fn((code) => `ENC${code.length}`) };
  });

  afterEach(() => {
    preview.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function blocks(...htmls) {
    preview.innerHTML = htmls.map((h) => `<div class="md-block">${h}</div>`).join("");
    return [...preview.children];
  }

  it("AT-DG-01 placeholder mode: no confirm, no server image, a pending box with a Render button", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const [w] = blocks(PUML("A -> B"));
    await new PlantUMLRenderer(preview, encoder).render("light", w, "placeholder");
    expect(confirm).not.toHaveBeenCalled();
    expect(preview.querySelector("img")).toBeNull();
    const pending = w.querySelector(".plantuml-pending");
    expect(pending).not.toBeNull();
    expect(pending.textContent).toContain(CONFIG.messages.edit.plantumlPending);
    const button = pending.querySelector("button");
    expect(button.textContent).toBe(CONFIG.messages.edit.plantumlRenderButton);
    expect(w.querySelector("code.language-plantuml")).toBeNull();
  });

  it("AT-DG-02 Render asks once; Cancel sends nothing; OK creates the server image", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const [w] = blocks(PUML("A -> B"));
    const r = new PlantUMLRenderer(preview, encoder);
    await r.render("dark", w, "placeholder");

    w.querySelector(".plantuml-pending button").click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(preview.querySelector("img")).toBeNull();
    expect(w.querySelector(".plantuml-pending")).not.toBeNull();

    w.querySelector(".plantuml-pending button").click();
    expect(confirm).toHaveBeenCalledTimes(2);
    const img = preview.querySelector("img.plantuml-diagram");
    expect(img).not.toBeNull();
    expect(img.src.startsWith(SERVER)).toBe(true);
    expect(encoder.encode.mock.calls.at(-1)[0]).toContain("!theme");
    expect(w.querySelector(".plantuml-pending")).toBeNull();
  });

  it("AT-DG-02 renderPending ignores an element it did not create (no user-written pending box)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const [w] = blocks('<div class="plantuml-pending"><button>Render</button></div>');
    const r = new PlantUMLRenderer(preview, encoder);
    w.querySelector("button").click();
    await r.renderPending(w.firstElementChild, "light");
    expect(confirm).not.toHaveBeenCalled();
    expect(preview.querySelector("img")).toBeNull();
  });

  it("AT-DG-03 consent mode: one confirm for all PlantUML blocks in the root (unchanged behaviour)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    blocks(PUML("A -> B"), PUML("C -> D"));
    await Promise.race([new PlantUMLRenderer(preview, encoder).render("light"), Promise.resolve()]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(preview.querySelectorAll("img.plantuml-diagram")).toHaveLength(2);
  });

  it("AT-DG-03 the consent, the alt text and the tooltip come from CONFIG (R14, R15)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    blocks(PUML("A -> B"));
    await Promise.race([new PlantUMLRenderer(preview, encoder).render("light"), Promise.resolve()]);
    expect(confirm).toHaveBeenCalledWith(CONFIG.messages.plantuml.consent);
    const img = preview.querySelector("img.plantuml-diagram");
    expect(img.alt).toBe(CONFIG.messages.plantuml.diagramAlt);
    expect(img.alt).toBe("PlantUML Diagram");
    expect(img.title).toBe(CONFIG.messages.diagram.tooltip);
  });

  it("AT-DG-03 Cancel shows the canceled text in place of each diagram (INV-03)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    blocks(PUML("A -> B"));
    await new PlantUMLRenderer(preview, encoder).render("light");
    expect(preview.querySelector(".plantuml-error").textContent).toBe("PlantUML diagram (not sent)");
  });

  it("AT-DG-04 a partial render leaves PlantUML images outside the root alone", async () => {
    const [done, edited] = blocks(`<div class="plantuml-wrapper"><img class="plantuml-diagram" src="${SERVER}OLD"></div>`, PUML("X"));
    const oldImg = done.querySelector("img");
    await new PlantUMLRenderer(preview, encoder).render("light", edited, "placeholder");
    expect(done.querySelector("img")).toBe(oldImg);
    expect(oldImg.getAttribute("src")).toBe(`${SERVER}OLD`);
    expect(preview.querySelectorAll("img")).toHaveLength(1);
  });

  it("AT-DG-05 Mermaid converts and runs only the diagrams inside the root", async () => {
    const mermaid = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
    const [a, b] = blocks(MERMAID("A-->B"), MERMAID("C-->D"));
    await new MermaidRenderer(preview, mermaid).render("light", b);
    expect(a.querySelector("code.language-mermaid")).not.toBeNull();
    expect(b.querySelector("code.language-mermaid")).toBeNull();
    const nodes = [...mermaid.run.mock.calls[0][0].nodes];
    expect(nodes).toHaveLength(1);
    expect(b.contains(nodes[0])).toBe(true);
    expect(nodes[0].title).toBe(CONFIG.messages.diagram.tooltip);
  });

  it("AT-DG-05 Mermaid accepts a list of roots", async () => {
    const mermaid = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
    const [a, b, c] = blocks(MERMAID("A-->B"), MERMAID("C-->D"), MERMAID("E-->F"));
    await new MermaidRenderer(preview, mermaid).render("light", [a, c]);
    expect([...mermaid.run.mock.calls[0][0].nodes]).toHaveLength(2);
    expect(b.querySelector("code.language-mermaid")).not.toBeNull();
  });

  it("AT-DG-06 without a root, the whole preview is rendered (unchanged behaviour)", async () => {
    const mermaid = { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) };
    blocks(MERMAID("A-->B"), MERMAID("C-->D"));
    await new MermaidRenderer(preview, mermaid).render("dark");
    expect([...mermaid.run.mock.calls[0][0].nodes]).toHaveLength(2);
    expect(mermaid.initialize.mock.calls[0][0].theme).toBe("dark");
  });

  it("AT-DG-07 the placeholder flow sends nothing: no fetch, no server URL in the DOM (INV-01)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const confirm = vi.spyOn(window, "confirm");
    const [w] = blocks(PUML("A -> B"), PUML("C -> D"));
    await new PlantUMLRenderer(preview, encoder).render("light", preview, "placeholder");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(preview.innerHTML).not.toContain(SERVER);
    expect(preview.querySelectorAll(".plantuml-pending")).toHaveLength(2);
    expect(w).toBeTruthy();
  });

  it("AT-DG-08 an image the server does not answer within CONFIG.plantuml.imageLoadTimeout (5,000 ms) shows the timeout text (INV-10, FS-02)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(CONFIG.plantuml.imageLoadTimeout).toBe(5000);
    const [w] = blocks(PUML("A -> B"));
    let done = false;
    const rendering = new PlantUMLRenderer(preview, encoder).render("light", w).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4999);
    expect(w.querySelector("img.plantuml-diagram")).not.toBeNull();
    expect(w.querySelector(".plantuml-error")).toBeNull();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rendering;
    expect(w.querySelector("img.plantuml-diagram")).toBeNull();
    const error = w.querySelector(".plantuml-wrapper > .plantuml-error");
    expect(error.textContent).toBe(CONFIG.messages.plantuml.timeout(5));
    expect(error.textContent).toBe("The PlantUML server didn't answer in 5 seconds.");
  });

  it("AT-MR-11 ExternalImageGate.apply(root) only touches the root; no argument means the whole preview", () => {
    const gate = new ExternalImageGate(preview);
    preview.innerHTML =
      '<div><img data-external-src="https://a.example/x.png" alt="a"></div>' +
      '<div><img data-external-src="https://b.example/y.png" alt="b"></div>';
    const [first, second] = [...preview.children];
    gate.apply(first);
    expect(first.querySelector(".external-image-placeholder")).not.toBeNull();
    expect(second.querySelector("img")).not.toBeNull();
    gate.apply();
    expect(second.querySelector(".external-image-placeholder")).not.toBeNull();
  });
});
