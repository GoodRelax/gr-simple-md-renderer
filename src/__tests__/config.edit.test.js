import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { CONFIG } from "../js/config.js";
import { makeLexer } from "./helpers/samples.js";

describe("CONFIG.edit (spec 5.2)", () => {
  it("AT-CFG-01 holds the agreed values", () => {
    const e = CONFIG.edit;
    expect(e.paletteMarginPx).toBe(16);
    expect(e.paletteLongPressMs).toBe(500); // INV-68
    expect(e.doubleTapMaxIntervalMs).toBe(300);
    expect(e.doubleTapMaxDistancePx).toBe(24);
    expect(e.defaultFileName).toBe("untitled.md");
    expect(e.commitBudgetMs).toBe(300);
    expect(e.diffMaxCells).toBe(250000);
    expect(e.titleUnsavedPrefix).toBe("* ");
    expect(e.tableLineBreak).toBe("<br>");
    expect(Object.keys(e.mermaidSamples).sort()).toEqual(["class", "flowchart", "sequence", "state"]);
  });

  it("AT-CFG-02 the table template is a 3-column table with 3 body rows", () => {
    const tokens = makeLexer()(CONFIG.edit.tableTemplate).filter((t) => t.type !== "space");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe("table");
    expect(tokens[0].header).toHaveLength(3);
    expect(tokens[0].rows).toHaveLength(3);
  });

  it.each(["flowchart", "sequence", "state", "class"])(
    "AT-CFG-03 the %s sample is a mermaid fence whose content parses",
    async (key) => {
      const sample = CONFIG.edit.mermaidSamples[key];
      const m = /^```mermaid\n([\s\S]*)\n```$/.exec(sample);
      expect(m).not.toBe(null);
      await expect(mermaid.parse(m[1])).resolves.toBeTruthy();
    },
  );

  it("AT-CFG-03 (check of the check) mermaid.parse rejects broken syntax in this environment", async () => {
    await expect(mermaid.parse("flowchart TD\n    A -->|x B")).rejects.toThrow();
  });
});
