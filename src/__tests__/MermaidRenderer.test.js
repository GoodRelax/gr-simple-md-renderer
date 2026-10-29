import { describe, it, expect, vi } from "vitest";
import MermaidRenderer from "../js/classes/MermaidRenderer.js";

describe("AT-MMD-01 MermaidRenderer.initializeMermaid (CON-12)", () => {
  function initConfig(theme = "light") {
    const mermaid = { initialize: vi.fn(), run: vi.fn() };
    new MermaidRenderer(document.createElement("div"), mermaid).initializeMermaid(theme);
    return mermaid.initialize.mock.calls[0][0];
  }

  it("drops <img> in labels (external images, CON-12) and keeps mermaid's <style> rule", () => {
    expect(initConfig().dompurifyConfig.FORBID_TAGS).toEqual(["style", "img"]);
  });

  it("does not let an %%{init}%% directive override dompurifyConfig", () => {
    const { secure } = initConfig();
    expect(secure).toContain("dompurifyConfig");
    // mermaid's own default secure keys stay protected
    ["secure", "securityLevel", "startOnLoad", "maxTextSize"].forEach((key) =>
      expect(secure).toContain(key),
    );
  });

  it("maps the theme", () => {
    expect(initConfig("dark").theme).toBe("dark");
    expect(initConfig("light").theme).toBe("default");
  });
});
