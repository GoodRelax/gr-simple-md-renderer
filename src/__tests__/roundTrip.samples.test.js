import { describe, it, expect } from "vitest";
import { splitMarkdownWrapper, hasUtf8Bom } from "../js/textTransforms.js";
import DocumentSession from "../js/classes/DocumentSession.js";
import MarkdownBlockModel from "../js/classes/MarkdownBlockModel.js";
import {
  loadSampleLf,
  loadFixtureLf,
  listFixtures,
  toCrlf,
  withBom,
  makeLexer,
} from "./helpers/samples.js";

// Line endings never come from the working tree (F5): every input is read as LF
// and the CRLF / BOM variants are built here.

const lexer = makeLexer();

// Heavy tests (about 1 s alone, 2 s or more when the machine is busy) get an
// explicit timeout so CPU load cannot fail them; the global 5 s default stays.
const HEAVY_TEST_TIMEOUT_MS = 30000;
const SAMPLES = ["sample-data.md", "sample-data.txt", "sample-data-2.md", "sample-data-2.txt"];
const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(160);
const EXTRA = [
  ["nul.md", `a${NUL}b\n\nc\n`],
  ["nbsp.md", `a${NBSP}b\n\n${NBSP}\n\nc\n`],
];

async function sessionFromBytes(bytes, lastModified, id) {
  const file = new File([bytes], "f.md", { lastModified });
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return DocumentSession.fromFileText(await file.text(), hasUtf8Bom(head), lastModified, id);
}

function fileTextThroughModel(session) {
  const m = MarkdownBlockModel.fromBody(session.getBodyText(), lexer, 1);
  return session.toFileText(m.toBody());
}

describe("round trips through the block model (INV-41, INV-44, INV-38)", () => {
  it.each(SAMPLES)("AT-RT-01 split -> fromBody -> toBody gives back the body (%s)", (name) => {
    const { body } = splitMarkdownWrapper(loadSampleLf(name));
    expect(MarkdownBlockModel.fromBody(body, lexer, 1).toBody()).toBe(body);
  });

  it.each(SAMPLES)("AT-RT-02 the CRLF file comes back unchanged (%s)", (name) => {
    const crlf = toCrlf(loadSampleLf(name));
    const s = DocumentSession.fromFileText(crlf, false, 1, 1);
    expect(fileTextThroughModel(s)).toBe(crlf);
  });

  it.each(SAMPLES.flatMap((n) => [[n, "LF"], [n, "CRLF"]]))(
    "AT-RT-03 the BOM file comes back byte for byte (%s, %s)",
    async (name, eol) => {
      const lf = loadSampleLf(name);
      const text = eol === "CRLF" ? toCrlf(lf) : lf;
      const bytes = withBom(text);
      const s = await sessionFromBytes(bytes, 5, 1);
      expect(s.hasBom).toBe(true);
      expect([...new TextEncoder().encode(fileTextThroughModel(s))]).toEqual([...bytes]);
    },
  );

  const fixtureCases = [
    ...listFixtures().map((n) => [n, loadFixtureLf(n)]),
    ...EXTRA,
  ].flatMap(([n, lf]) => [
    [n, "LF", lf, false],
    [n, "CRLF", toCrlf(lf), false],
    [n, "LF+BOM", lf, true],
    [n, "CRLF+BOM", toCrlf(lf), true],
  ]);

  it.each(fixtureCases)("AT-RT-04 fixture %s (%s) round-trips", async (_n, _v, text, bom) => {
    const bytes = bom ? withBom(text) : new TextEncoder().encode(text);
    const s = await sessionFromBytes(bytes, 1, 1);
    const body = s.getBodyText();
    expect(MarkdownBlockModel.fromBody(body, lexer, 1).toBody()).toBe(body);
    expect([...new TextEncoder().encode(fileTextThroughModel(s))]).toEqual([...bytes]);
  });

  it("AT-RT-05 editing any one block of sample-data-2 (CRLF + BOM) changes exactly one line", async () => {
    const original = toCrlf(loadSampleLf("sample-data-2.md"));
    const s = await sessionFromBytes(withBom(original), 1, 1);
    const m = MarkdownBlockModel.fromBody(s.getBodyText(), lexer, 1);
    const origLines = ("\uFEFF" + original).split("\n");
    expect(m.getBlocks().length).toBe(157);
    for (const block of m.getBlocks()) {
      const edited = "X" + MarkdownBlockModel.toEditableText(block.raw);
      const change = m.replaceBlock(block.id, edited, lexer, 250000);
      expect(change.isChanged).toBe(true);
      const lines = s.toFileText(change.model.toBody()).split("\n");
      expect(lines.length).toBe(origLines.length);
      expect(lines.filter((line, i) => line !== origLines[i])).toHaveLength(1);
    }
  }, HEAVY_TEST_TIMEOUT_MS);

  it("AT-RT-06 the fixtures cover every block type the model must handle", () => {
    const types = new Set();
    const langs = new Set();
    for (const n of listFixtures()) {
      for (const t of lexer(loadFixtureLf(n))) {
        types.add(t.type);
        if (t.type === "code" && t.lang) langs.add(t.lang);
      }
    }
    for (const t of ["heading", "paragraph", "list", "table", "code", "blockKatex", "hr", "blockquote", "html", "def", "space"]) {
      expect(types).toContain(t);
    }
    expect(langs).toContain("mermaid");
    expect(langs).toContain("plantuml");
  });
});
