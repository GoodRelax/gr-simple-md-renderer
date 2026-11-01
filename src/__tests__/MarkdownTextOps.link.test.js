import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import MarkdownTextOps from "../js/classes/MarkdownTextOps.js";
import InlineRuns from "../js/classes/InlineRuns.js";
import ClipboardLink from "../js/classes/ClipboardLink.js";

// INV-69 in the block editor: the link put on the selection (Ctrl+V and the
// button), put in at the caret (the button without a selection), and taken
// off. Only the inline range of the selection is lexed and written again.

const app = new Marked();
app.use(markedKatex({ throwOnError: false }));

/** Block tokens only, as MarkdownRenderer.lex. */
function lexBlocks(src) {
  const lexer = new app.Lexer(app.defaults);
  lexer.blockTokens(src, lexer.tokens);
  return lexer.tokens;
}

function contextWith(links = {}) {
  return {
    lexBlocks,
    lexInline: (src) => {
      const lexer = new app.Lexer(app.defaults);
      Object.assign(lexer.tokens.links, links);
      return lexer.inlineTokens(src);
    },
    colors: [],
  };
}
const ctx = contextWith();

/** The op of INV-69 for a URL the user has (as BlockEditController makes it). */
const linkOp = (url, strictEnds = false) => ({ kind: "link", link: InlineRuns.inlineLink(ClipboardLink.toDestination(url)), url, strictEnds });
const PASTE = (url) => linkOp(url, true);

/** Select part (its n-th occurrence) and run fn(text, start, end). */
function on(text, part, fn, occurrence = 0) {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = text.indexOf(part, at + 1);
  if (at < 0) throw new Error(`no ${part}`);
  return fn(text, at, at + part.length);
}
const linked = (text, part, op, context = ctx, occurrence = 0) =>
  on(text, part, (t, s, e) => MarkdownTextOps.formatRange(t, s, e, op, context), occurrence);

describe("AT-FR links: Ctrl+V and the button with a selection (INV-69)", () => {
  it("AT-FR-38 the selected text becomes [text](URL); the text stays selected", () => {
    const edit = linked("See the example here.", "example", PASTE("https://example.com/"));
    expect(edit.text).toBe("See the [example](https://example.com/) here.");
    expect(edit.text.slice(edit.selStart, edit.selEnd)).toBe("example");
  });

  it("AT-FR-39 the URL is the user's string: \\ as %5C, < > as %3C %3E in <...>, unbalanced parentheses in <...>", () => {
    expect(linked("a word b", "word", PASTE("https://example.com/a\\b")).text).toBe("a [word](https://example.com/a%5Cb) b");
    expect(linked("a word b", "word", PASTE("https://example.com/a<b>")).text).toBe("a [word](<https://example.com/a%3Cb%3E>) b");
    expect(linked("a word b", "word", PASTE("https://example.com/a(b")).text).toBe("a [word](<https://example.com/a(b>) b");
    expect(linked("a word b", "word", PASTE("https://example.com/a_(b)c")).text).toBe("a [word](https://example.com/a_(b)c) b");
  });

  it("AT-FR-40 in a list item and a quote: the marks of the lines stay", () => {
    expect(linked("- one\n- two", "two", PASTE("https://x.example/")).text).toBe("- one\n- [two](https://x.example/)");
    expect(linked("> quoted text", "text", PASTE("https://x.example/")).text).toBe("> quoted [text](https://x.example/)");
  });

  it("AT-FR-41 in a table row the pipes of the URL are written \\| and the table stays (INV-69, INV-72 (d))", () => {
    const table = "| A | B |\n| --- | --- |\n| cell | x |";
    const edit = linked(table, "cell", PASTE("https://x.example/p|q"));
    expect(edit.text).toBe("| A | B |\n| --- | --- |\n| [cell](https://x.example/p\\|q) | x |");
    const html = app.parse(edit.text);
    expect(html).toContain('<a href="https://x.example/p%7Cq">cell</a>');
    expect((html.match(/<td>/g) ?? []).length).toBe(2);
  });

  it("AT-FR-42 Ctrl+V does not link: in a code block, a code span, a link destination, an inline HTML tag, math, across a blank line", () => {
    const url = "https://example.com/";
    expect(linked("```\nfoo bar\n```", "foo", PASTE(url))).toBeNull();
    expect(linked("    foo bar", "foo", PASTE(url))).toBeNull();
    expect(linked("a `code span` b", "code", PASTE(url))).toBeNull();
    expect(linked("a `code span` b", "a `code", PASTE(url))).toBeNull();
    expect(linked("a [text](https://old.example/) b", "old", PASTE(url))).toBeNull();
    expect(linked("a [text](https://old.example/) b", "text](https", PASTE(url))).toBeNull();
    expect(linked('a <span title="tip">x</span> b', "tip", PASTE(url))).toBeNull();
    expect(linked("<div>\nfoo\n</div>", "foo", PASTE(url))).toBeNull();
    expect(linked("$$\nx^2\n$$", "x^2", PASTE(url))).toBeNull();
    expect(linked("one\n\ntwo", "one\n\ntwo", PASTE(url))).toBeNull();
    expect(linked("[r]: https://r.example/", "r.example", PASTE(url))).toBeNull();
  });

  it("AT-FR-43 a whole code span or element selected from its edges is linked (Ctrl+V); the button takes a code span whole", () => {
    expect(linked("a `code` b", "`code`", PASTE("https://x.example/")).text).toBe("a [`code`](https://x.example/) b");
    expect(linked("a `code` b", "od", linkOp("https://x.example/")).text).toBe("a [`code`](https://x.example/) b");
  });

  it("AT-FR-44 in a link the URL is replaced; a reference link becomes [text](URL), its definition stays", () => {
    expect(linked("a [text](https://old.example/) b", "text", PASTE("https://new.example/")).text).toBe("a [text](https://new.example/) b");
    const doc = "a [text][r] b\n\n[r]: https://old.example/";
    const edit = linked(doc, "text", PASTE("https://new.example/"), contextWith({ r: { href: "https://old.example/", title: null } }));
    expect(edit.text).toBe("a [text](https://new.example/) b\n\n[r]: https://old.example/");
  });

  it("AT-FR-45 in a bare URL or <URL>: its text and URL become the new URL", () => {
    expect(linked("see https://old.example/ now", "old", PASTE("https://new.example/")).text).toBe(
      "see [https://new.example/](https://new.example/) now",
    );
    expect(linked("see <https://old.example/> now", "old", PASTE("https://new.example/")).text).toBe(
      "see [https://new.example/](https://new.example/) now",
    );
  });
});

describe("AT-FR insertLink: the button without a selection (INV-69 (b), ruling V2)", () => {
  const link = InlineRuns.inlineLink("https://example.com/");

  it("AT-FR-46 the link goes in at the caret with its text selected; the text is escaped (INV-72 (d))", () => {
    const edit = MarkdownTextOps.insertLink("ab", 1, "Example [1]", link, ctx);
    expect(edit.text).toBe("a[Example \\[1\\]](https://example.com/)b");
    expect(edit.text.slice(edit.selStart, edit.selEnd)).toBe("Example \\[1\\]");
    expect(app.parseInline(edit.text)).toContain('<a href="https://example.com/">Example [1]</a>');
  });

  it("AT-FR-47 the URL is the text when the clipboard has no link text; in a table row the pipes are \\|", () => {
    const url = "https://x.example/p|q";
    const own = InlineRuns.inlineLink(ClipboardLink.toDestination(url));
    const table = "| A |\n| --- |\n| x |";
    const edit = MarkdownTextOps.insertLink(table, table.length - 2, url, own, ctx);
    expect(edit.text).toBe("| A |\n| --- |\n| x[https://x.example/p\\|q](https://x.example/p\\|q) |");
    expect((app.parse(edit.text).match(/<td>/g) ?? []).length).toBe(1);
    // outside a table: the text's pipe is escaped (INV-72 (d)), the destination's is not
    expect(MarkdownTextOps.insertLink("", 0, url, own, ctx).text).toBe("[https://x.example/p\\|q](https://x.example/p|q)");
  });
});

describe("AT-FR removeLink / canRemoveLink (INV-69, 5.15.5)", () => {
  const remove = (text, s, e = s, context = ctx) => MarkdownTextOps.removeLink(text, s, e, context);
  const can = (text, s, e = s, context = ctx) => MarkdownTextOps.canRemoveLink(text, s, e, context);

  it("AT-FR-48 the caret on a link's text (its edges included) or in its source takes it off; the text and formats stay", () => {
    const text = "a [**b c**](https://x.example/) d";
    for (const at of [3, 6, 9, text.indexOf("x.example"), text.indexOf(")")]) {
      expect(remove(text, at)?.text, String(at)).toBe("a **b c** d");
      expect(can(text, at), String(at)).toBe(true);
    }
    for (const at of [0, 1, 2, text.length]) {
      expect(remove(text, at), String(at)).toBeNull();
      expect(can(text, at), String(at)).toBe(false);
    }
  });

  it("AT-FR-49 a selection takes off every link it touches", () => {
    const text = "[a](u) and [b](v) and [c](w)";
    const edit = on(text, "a](u) and [b", (t, s, e) => remove(t, s, e));
    expect(edit.text).toBe("a and b and [c](w)");
    expect(on(text, " and ", (t, s, e) => can(t, s, e))).toBe(false);
    expect(on(text, "and [b", (t, s, e) => can(t, s, e))).toBe(true);
  });

  it("AT-FR-50 a bare URL or <URL> taken off stays text: \\: (www.: \\., an address: \\@)", () => {
    expect(on("see https://x.example/ now", "x.example", (t, s, e) => remove(t, s, e)).text).toBe("see https\\://x.example/ now");
    expect(remove("see <https://x.example/> now", 8).text).toBe("see https\\://x.example/ now");
    expect(remove("see www.x.example now", 8).text).toBe("see www\\.x.example now");
    expect(remove("mail a@x.example now", 6).text).toBe("mail a\\@x.example now");
    for (const t of ["see https\\://x.example/ now", "see www\\.x.example now", "mail a\\@x.example now"]) {
      expect(app.parseInline(t)).not.toContain("<a ");
    }
  });

  it("AT-FR-51 a reference link taken off keeps its definition; a link in a table row; no link in a code span", () => {
    const doc = "x [t][r] y\n\n[r]: https://r.example/";
    expect(remove(doc, 4, 4, contextWith({ r: { href: "https://r.example/", title: null } })).text).toBe("x t y\n\n[r]: https://r.example/");
    expect(remove("| A |\n| --- |\n| [a\\|b](u) |", 18).text).toBe("| A |\n| --- |\n| a\\|b |");
    expect(can("a `[x](u)` b", 5)).toBe(false);
    expect(can("```\n[x](u)\n```", 5)).toBe(false);
  });

  it("AT-FR-52 a \"www.\" after a letter or \"_\" is escaped too (marked makes it an autolink there)", () => {
    for (const text of ["[xwww.a.example](u)", "[_www.a.example](u)"]) {
      const edit = remove(text, 3);
      expect(edit, text).not.toBeNull();
      expect(app.parseInline(edit.text)).not.toContain("<a ");
    }
  });

  it("AT-FR-64 a link whose text makes an autolink with the text next to it comes off, the neighbour escaped; Remove link is on exactly then", () => {
    for (const [text, at, written] of [
      ["x [www](u).example y", 4, "x www\\.example y"],
      ["x [a](u)@b.example y", 3, "x a\\@b.example y"],
      ["see [https](u)://x.example now", 6, "see https\\://x.example now"],
    ]) {
      expect(can(text, at), text).toBe(true);
      const edit = remove(text, at);
      expect(edit?.text, text).toBe(written);
      expect(app.parseInline(edit.text)).not.toContain("<a ");
    }
  });

  it("AT-FR-53 a bare URL with \\| in a table row cannot come off as written: Remove link is off for it", () => {
    const table = "| A |\n| --- |\n| https://x.example/a\\|b |";
    const at = table.indexOf("x.example");
    expect(can(table, at)).toBe(remove(table, at) !== null);
  });
});

describe("AT-FR owner ruling F-R1: where a new link can go at the caret", () => {
  const link = InlineRuns.inlineLink("u");
  const insert = (text, at) => MarkdownTextOps.insertLink(text, at, "L", link, ctx);

  it("AT-FR-54 not on the marks of a line, nor in a code span, an HTML tag, a link, an image, math, an escape, an entity, emphasis markers", () => {
    const cases = [
      ["- item", 0],
      ["- item", 1],
      ["# H", 0],
      ["> quote", 0],
      ["a `code` b", 4],
      ['a <span title="t">x</span> b', 6],
      ["a [text](v) b", 4],
      ["a [text](v) b", 9],
      ["a ![alt](i.png) b", 5],
      ["a $x+y$ b", 4],
      ["a \\* b", 3],
      ["a &amp; b", 4],
      ["a **bold** b", 3],
      ["| A |\n| --- |\n| x |", 8],
      ["```\ncode\n```", 5],
      ["[r]: https://r.example/", 3],
    ];
    for (const [text, at] of cases) {
      expect(insert(text, at), `${JSON.stringify(text)} @${at}`).toBeNull();
      expect(MarkdownTextOps.canInsertLink(text, at, ctx), `${JSON.stringify(text)} @${at}`).toBe(false);
    }
  });

  it("AT-FR-55 in text, inside emphasis, at the edge of a link, on an empty line: the link goes in (normal form), checked against marked", () => {
    expect(insert("- item", 2).text).toBe("- [L](u)item");
    expect(insert("# H", 2).text).toBe("# [L](u)H");
    expect(insert("a **bold** b", 5).text).toBe("a **b**[**L**](u)**old** b");
    expect(insert("a [text](v) b", 2).text).toBe("a [L](u)[text](v) b");
    expect(insert("a [text](v) b", 11).text).toBe("a [text](v)[L](u) b");
    expect(insert("", 0).text).toBe("[L](u)");
    expect(insert("one\n\n\n\ntwo", 5).text).toBe("one\n\n[L](u)\n\ntwo");
  });

  it("AT-FR-60 an empty line between blocks: the link is a paragraph of its own, the blocks around it stay as they were", () => {
    const keepsBlocks = (text, at, expected) => {
      const edit = insert(text, at);
      expect(edit?.text, JSON.stringify(text)).toBe(expected);
      if (edit) expect(edit.text.slice(edit.selStart, edit.selEnd)).toBe("L");
    };
    keepsBlocks("para1\n\npara2", 6, "para1\n\n[L](u)\n\npara2");
    keepsBlocks("para1\n    \npara2", 8, "para1\n\n[L](u)\n\npara2"); // the line's spaces go: no code block
    keepsBlocks("> a\n\nb", 4, "> a\n\n[L](u)\n\nb");
    keepsBlocks("| t |\n| - |\n| x |\n\nafter", 18, "| t |\n| - |\n| x |\n\n[L](u)\n\nafter");
    keepsBlocks("x\n\n[r]: https://r.example/", 2, "x\n\n[L](u)\n\n[r]: https://r.example/");
    // between the items of a list the link would split the list: no link
    expect(insert("- a\n\n- b", 4)).toBeNull();
    expect(MarkdownTextOps.canInsertLink("- a\n\n- b", 4, ctx)).toBe(false);
  });

  it("AT-FR-61 a table row: not before its leading pipe nor after its trailing one", () => {
    const table = "| w | x |\n| - | - |\n| y | z |";
    const row = table.lastIndexOf("| y");
    expect(insert(table, row)).toBeNull();
    expect(insert(table, table.length)).toBeNull();
    expect(insert(table, row + 2).text).toBe("| w | x |\n| - | - |\n| [L](u)y | z |");
    expect(insert(table, table.length - 2).text).toBe("| w | x |\n| - | - |\n| y | z[L](u) |");
    expect(MarkdownTextOps.canInsertLink(table, row, ctx)).toBe(false);
  });

  it("AT-FR-63 a label shaped like a Markdown link stays text: \"(\" after an escaped \"]\" is \\( (INV-72 (d))", () => {
    for (const [label, written] of [
      ["See [docs](here)", "[See \\[docs\\]\\(here)](u)"],
      ["[x](y)", "[\\[x\\]\\(y)](u)"],
      ["[PDF] Report", "[\\[PDF\\] Report](u)"],
      ["a(b", "[a(b](u)"],
    ]) {
      const edit = MarkdownTextOps.insertLink("", 0, label, link, ctx);
      expect(edit?.text, label).toBe(written);
      expect(app.parseInline(edit.text)).toBe(`<a href="u">${label.replace(/&/g, "&amp;")}</a>`);
    }
  });

  it("AT-FR-56 a \"!\" or a lone backslash right before the caret is escaped (no image, no escape of the bracket)", () => {
    expect(insert("Hello!", 6).text).toBe("Hello\\![L](u)");
    expect(app.parseInline(insert("Hello!", 6).text)).toContain('<a href="u">L</a>');
    expect(insert("Hello! there", 6).text).toBe("Hello\\![L](u) there");
  });
});

describe("AT-FR owner ruling F-R3: Ctrl+V inside an image or inline math is the normal paste", () => {
  it("AT-FR-57 an end inside an image (its alt or its destination) or inline math: null; from its edges: linked", () => {
    const url = "https://new.example/";
    expect(linked("a ![alt](https://img.example/i.png) b", "i.png", PASTE(url))).toBeNull();
    expect(linked("a ![alt](https://img.example/i.png) b", "alt", PASTE(url))).toBeNull();
    expect(linked("a $x+y$ b", "x+y", PASTE(url))).toBeNull();
    expect(linked("a $x+y$ b", "$x+y$", PASTE(url)).text).toBe(`a [$x+y$](${url}) b`);
    expect(linked("a ![alt](i.png) b", "![alt](i.png)", PASTE(url)).text).toBe(`a [![alt](i.png)](${url}) b`);
  });
});

describe("AT-FR brackets in a link's text", () => {
  it("AT-FR-58 selected text with a raw ] or [ is linked with the bracket escaped", () => {
    const edit = linked("a b]c d", "b]c", PASTE("https://x.example/"));
    expect(edit.text).toBe("a [b\\]c](https://x.example/) d");
    expect(app.parseInline(edit.text)).toContain('<a href="https://x.example/">b]c</a>');
    expect(linked("a [b c", "[b", PASTE("https://x.example/")).text).toBe("a [\\[b](https://x.example/) c");
  });

  it("AT-FR-62 a selection right after a literal \"!\" (or literal * _ ~): they are escaped so the link stays a link (Ctrl+V and the button)", () => {
    for (const op of [PASTE("https://x.example/"), linkOp("https://x.example/")]) {
      const edit = linked("Hello!world x", "world", op);
      expect(edit?.text).toBe("Hello\\![world](https://x.example/) x");
      expect(app.parseInline(edit.text)).toContain('<a href="https://x.example/">world</a>');
      expect(edit.text.slice(edit.selStart, edit.selEnd)).toBe("world");
      const stars = linked("**Hi!**world x", "world", op);
      expect(stars?.text).toBe("**Hi!\\*\\*[world](https://x.example/) x");
      expect(app.parseInline(stars.text)).not.toContain("<strong>");
      expect(app.parseInline(stars.text)).toContain('<a href="https://x.example/">world</a>');
    }
    // an escaped "!" and a "!" with a space after it were fine already
    expect(linked("Hello\\!world x", "world", PASTE("u")).text).toBe("Hello\\![world](u) x");
    expect(linked("Hello! world", "world", PASTE("u")).text).toBe("Hello! [world](u)");
  });

  it("AT-FR-59 a link whose text has \\[ \\] is read as a link: Bold inside it, Remove link", () => {
    expect(MarkdownTextOps.removeLink("a [x \\[1\\]](u) b", 4, 4, ctx).text).toBe("a x \\[1\\] b");
    // INV-67 (6): a link is taken whole
    const bold = linked("a [x \\[1\\]](u) b", "x", { kind: "strong" });
    expect(bold.text).toBe("a [**x \\[1\\]**](u) b");
    expect(linked("a [x \\[1\\]](https://old.example/) b", "old", PASTE("https://new.example/"))).toBeNull(); // in the destination
  });
});
