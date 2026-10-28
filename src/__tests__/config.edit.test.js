import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { CONFIG } from "../js/config.js";
import { makeLexer } from "./helpers/samples.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

/** WCAG 2 relative luminance of #rrggbb. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("CONFIG.edit text colors and invisible marks (INV-66, INV-70, 5.14.14)", () => {
  it("AT-CFG-06 the agreed values", () => {
    expect(CONFIG.edit.textColors).toEqual({
      red: { light: "#CF222E", dark: "#F85149" },
      blue: { light: "#0550AE", dark: "#58A6FF" },
      green: { light: "#1A7F37", dark: "#3FB950" },
    });
    expect(CONFIG.edit.invisibleMarkMaxChars).toBe(50000);
    expect(CONFIG.edit.invisibleMarkMaxMarks).toBe(2000); // P-3
    expect(CONFIG.edit.caretLineMaxChars).toBe(20000); // INV-84 (performance)
  });

  // The grounds text can be on: page, block editor, table header (light);
  // page, block editor (inset), muted (dark).
  const GROUNDS = { light: ["#ffffff", "#fffdf5", "#f6f8fa"], dark: ["#0d1117", "#010409", "#151b23"] };
  it.each(
    Object.entries(CONFIG.edit.textColors).flatMap(([name, c]) =>
      ["light", "dark"].flatMap((theme) => GROUNDS[theme].map((ground) => [name, theme, c[theme], ground])),
    ),
  )("AT-CFG-07 %s (%s) %s on %s has a contrast of 4.5 or more", (_name, _theme, color, ground) => {
    expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5);
  });

  it("AT-CFG-07 (check of the check) the formula gives 21 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("the dark text colors in style.css (INV-66, 5.14.14)", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../css/style.css"), "utf8");
  it.each(Object.entries(CONFIG.edit.textColors))("AT-CFG-08 %s: the light value shows as its dark pair", (_name, { light, dark }) => {
    const rule = new RegExp(`body\\.dark #preview span\\[style\\*="${light}" i\\] \\{\\s*color: ${dark} !important;\\s*\\}`);
    expect(css).toMatch(rule);
  });
});
