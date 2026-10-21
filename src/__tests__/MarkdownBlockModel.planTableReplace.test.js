import { describe, it, expect, vi } from "vitest";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import { makeLexer } from "./helpers/samples.js";

// INV-42 (table cells, INV-62): a cell commit or a table operation keeps the
// table's block id when, after the matching prefix and suffix are left out,
// one old table block stands against one new table block.

const lexer = makeLexer();
const MAX = 250000;
const DOC = "# H\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n";
const model = () => MarkdownBlockModel.fromBody(DOC, lexer, 1);
const tableOf = (m) => m.getBlocks().find((b) => b.type === "table");

describe("MarkdownBlockModel.planTableReplace (pure)", () => {
  it("AT-PTR-01 one table against one table keeps the id; the other ids stay", () => {
    const m = model();
    const table = tableOf(m);
    const plan = m.planTableReplace(table.id, "| a | b |\n| --- | --- |\n| 1x | 2 |", lexer, MAX);
    expect(plan.isChanged).toBe(true);
    expect(plan.keptId).toBe(true);
    expect(plan.anchorBlockId).toBe(table.id);
    expect(plan.model.getBlocks().map((b) => b.id)).toEqual(m.getBlocks().map((b) => b.id));
    expect(tableOf(plan.model).raw).toBe("| a | b |\n| --- | --- |\n| 1x | 2 |");
    expect(plan.model.toBody()).toBe(DOC.replace("| 1 | 2 |", "| 1x | 2 |"));
  });

  it("AT-PTR-02 the model itself does not change (R7.5)", () => {
    const m = model();
    const before = m.toBody();
    m.planTableReplace(tableOf(m).id, "| x |\n| --- |", lexer, MAX);
    expect(m.toBody()).toBe(before);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("AT-PTR-03 a table that became a paragraph and a table does not keep the id", () => {
    const m = model();
    const table = tableOf(m);
    const plan = m.planTableReplace(table.id, "Intro\n\n| a | b |\n| --- | --- |\n| 9 | 2 |", lexer, MAX);
    expect(plan.isChanged).toBe(true);
    expect(plan.keptId).toBe(false);
    expect(plan.model.getBlocks().some((b) => b.id === table.id)).toBe(false);
  });

  it("AT-PTR-04 a table that is no table any more does not keep the id", () => {
    const m = model();
    const plan = m.planTableReplace(tableOf(m).id, "just text", lexer, MAX);
    expect(plan.keptId).toBe(false);
    expect(plan.model.getBlocks().map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
  });

  it("AT-PTR-05 an unchanged text: isChanged false, the same model, the id kept", () => {
    const m = model();
    const table = tableOf(m);
    const plan = m.planTableReplace(table.id, MarkdownBlockModel.toEditableText(table.raw), lexer, MAX);
    expect(plan.isChanged).toBe(false);
    expect(plan.keptId).toBe(true);
    expect(plan.model).toBe(m);
  });

  it("AT-PTR-06 an unknown id changes nothing and keeps no id", () => {
    const m = model();
    const plan = m.planTableReplace(999, "| x |\n| --- |", lexer, MAX);
    expect(plan).toMatchObject({ isChanged: false, keptId: false, model: m });
  });

  it("AT-PTR-07 new ids are never given to the kept table; the next id does not go back", () => {
    const m = model();
    const plan = m.planTableReplace(tableOf(m).id, "| a |\n| --- |\n| z |", lexer, MAX);
    expect(plan.keptId).toBe(true);
    expect(plan.model.getNextBlockId()).toBeGreaterThanOrEqual(m.getNextBlockId());
  });
});

describe("MarkdownBlockModel.planTableReplace without lexing the whole body (INV-51)", () => {
  const strip = (m) => m.getBlocks().map((b) => [b.type, b.raw, b.separatorAfter]);
  const cases = [
    ["a table in the middle", "# H\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n"],
    ["a table first, with leading blank lines", "\n\n| a |\n| --- |\n| 1 |\n\n- x\n"],
    ["a table last, at the end of the body", "Intro.\n\n| a |\n| --- |\n| 1 |"],
    ["a table before a heading with no blank line", "Intro.\n\n| a |\n| --- |\n| 1 |\n# H\n"],
    ["reference links around", "[r]: https://r.example/\n\n| [a][r] |\n| --- |\n| 1 |\n\nAfter [r].\n"],
  ];
  it.each(cases)("%s: the same blocks, definitions and other ids as a whole-body lexing", (_name, body) => {
    const m = MarkdownBlockModel.fromBody(body, lexer, 1);
    const table = tableOf(m);
    const next = MarkdownBlockModel.toEditableText(table.raw).replace(/1/, "9 | x");
    const fast = m.planTableReplace(table.id, next, lexer, MAX);
    const full = m.replaceBlock(table.id, next, lexer, MAX);
    expect(fast.keptId).toBe(true);
    expect(fast.model.toBody()).toBe(full.model.toBody());
    expect(strip(fast.model)).toEqual(strip(full.model));
    expect(fast.model.links).toEqual(full.model.links);
    expect(fast.model.getBlocks().filter((b) => b.id !== table.id).map((b) => b.id)).toEqual(
      full.model.getBlocks().filter((b) => b.type !== "table").map((b) => b.id),
    );
  });

  it("a paragraph right above the table (no blank line) is lexed with the whole body", () => {
    const m = MarkdownBlockModel.fromBody("Intro\n| a |\n| --- |\n| 1 |\n", lexer, 1);
    const table = tableOf(m);
    expect(table).toBeTruthy(); // GFM: a table interrupts a paragraph
    const lex = vi.fn(lexer);
    m.planTableReplace(table.id, "| a |\n| --- |\n| 2 |", lex, MAX);
    expect(lex.mock.calls.some(([src]) => src.startsWith("Intro"))).toBe(true);
  });

  it("a new text that is not one table alone is lexed with the whole body", () => {
    const m = model();
    const lex = vi.fn(lexer);
    const plan = m.planTableReplace(tableOf(m).id, "| a |\n| --- |\n| 1 |\n\npara", lex, MAX);
    expect(plan.keptId).toBe(false);
    expect(lex.mock.calls.some(([src]) => src.startsWith("# H"))).toBe(true);
  });
});
