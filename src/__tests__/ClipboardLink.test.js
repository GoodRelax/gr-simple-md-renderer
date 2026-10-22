import { describe, it, expect, vi } from "vitest";
import ClipboardLink from "../js/classes/ClipboardLink.js";

// INV-69 (URL condition), used by INV-72 (a) for a changed autolink text.
const SCHEMES = ["http:", "https:", "mailto:"];
const OPTIONS = { schemes: SCHEMES, maxLength: 2048 };

describe("AT-CL-01 ClipboardLink.isLinkableUrl (pure)", () => {
  it.each([
    ["https://example.com/", true],
    ["  http://example.com/a?b=c  ", true],
    ["mailto:a@example.com", true],
    ["javascript:alert(1)", false],
    ["data:text/html,x", false],
    ["ftp://example.com/", false],
    ["example.com", false],
    ["https://a.example/\nb", false],
    ["", false],
    // INV-69: no control, white space or invisible character inside (new URL()
    // would drop or encode it: what is checked would not be what is written)
    ["https://a\tb.example", false],
    ["\u0000https://x.example", false],
    ["\u0001https://a.example/", false],
    ["https://x.example/\u0001", false],
    ["https://x.example/a\u0000b", false],
    ["https://a.example/\u0007x", false],
    ["https://a.example/\u001bx", false],
    ["https://x.example/\u007f", false],
    ["https://x.example/\u0085", false],
    ["https://x.example/a b", false],
    ["https://x.example/a\u00a0b", false],
    ["https://x.example/a\u3000b", false],
    ["https://x.example/a\u2028b", false],
    ["https://x.example/a\u2029b", false],
    ["https://x.example/a\u200bb", false],
    ["https://x.example/a\u2060b", false],
    ["https://x.example/a\u00adb", false],
    ["https://x.example/\u202egpj.exe", false],
    ["https://x.example/a\u200eb", false],
    ["https://x.example/a\u2066b", false],
    ["https://x.example/a\ufeffb", false],
    // letters of other scripts are fine
    ["https://example.com/\u65e5\u672c", true],
  ])("%j -> %s", (text, expected) => {
    expect(ClipboardLink.isLinkableUrl(text, SCHEMES, 2048)).toBe(expected);
  });

  it("a URL longer than the limit is not one", () => {
    const url = `https://example.com/${"a".repeat(40)}`;
    expect(ClipboardLink.isLinkableUrl(url, SCHEMES, url.length)).toBe(true);
    expect(ClipboardLink.isLinkableUrl(url, SCHEMES, url.length - 1)).toBe(false);
    expect(ClipboardLink.isLinkableUrl(null, SCHEMES, 10)).toBe(false);
  });
});

/** A paste event whose clipboardData holds the given types. */
function pasteEvent(data) {
  const getData = vi.fn((type) => data[type] ?? "");
  return { event: { clipboardData: { getData } }, getData };
}

describe("AT-CL-02 urlFromPasteEvent: the paste's text/plain only (INV-69, Ctrl+V)", () => {
  it("a URL, without the spaces around it; the HTML is not read", () => {
    const { event, getData } = pasteEvent({ "text/plain": "  https://example.com/a  ", "text/html": '<a href="https://evil.example/">x</a>' });
    expect(ClipboardLink.urlFromPasteEvent(event, OPTIONS)).toBe("https://example.com/a");
    expect(getData).toHaveBeenCalledWith("text/plain");
    expect(getData).not.toHaveBeenCalledWith("text/html");
  });

  it("not a URL, another scheme, two lines, too long, or no clipboard data: null", () => {
    for (const text of ["hello", "javascript:alert(1)", "https://a.example/\nhttps://b.example/", ""]) {
      expect(ClipboardLink.urlFromPasteEvent(pasteEvent({ "text/plain": text }).event, OPTIONS), text).toBeNull();
    }
    const long = `https://example.com/${"a".repeat(30)}`;
    expect(ClipboardLink.urlFromPasteEvent(pasteEvent({ "text/plain": long }).event, { schemes: SCHEMES, maxLength: 20 })).toBeNull();
    expect(ClipboardLink.urlFromPasteEvent({}, OPTIONS)).toBeNull();
    expect(ClipboardLink.urlFromPasteEvent(null, OPTIONS)).toBeNull();
  });
});

describe("AT-CL-03 toDestination: the user's string as a link destination (pure)", () => {
  it.each([
    ["https://example.com/a?b=c#d", "https://example.com/a?b=c#d"],
    ["  https://example.com/  ", "https://example.com/"],
    // not normalized by new URL(): the user's string is kept
    ["https://EXAMPLE.com/%7Ex", "https://EXAMPLE.com/%7Ex"],
    ["https://example.com/a\\b", "https://example.com/a%5Cb"],
    ["https://example.com/a_(b)c", "https://example.com/a_(b)c"],
    ["https://example.com/a(b", "<https://example.com/a(b>"],
    ["https://example.com/a)b", "<https://example.com/a)b>"],
    ["https://example.com/<x>", "<https://example.com/%3Cx%3E>"],
    ["mailto:a@example.com", "mailto:a@example.com"],
    // an entity form is kept as typed (marked reads it, a known limit)
    ["https://example.com/?a=1&amp;b=2", "https://example.com/?a=1&amp;b=2"],
  ])("%j -> %j", (url, dest) => {
    expect(ClipboardLink.toDestination(url)).toBe(dest);
  });

  it("linkOp: an inline link to the destination; the URL (trimmed) is the new text of a bare URL", () => {
    const op = ClipboardLink.linkOp("  https://example.com/a(b  ", true);
    expect(op).toMatchObject({ kind: "link", url: "https://example.com/a(b", strictEnds: true });
    expect(op.link).toMatchObject({ kind: "inline", href: "https://example.com/a(b", dest: "(<https://example.com/a(b>)" });
  });

  it("what passed the check is what is written: the checked (trimmed) string is the destination, unchanged", () => {
    for (const url of ["https://example.com/p?q=1#f", "mailto:a@example.com", "https://example.com/%7Ex"]) {
      expect(ClipboardLink.isLinkableUrl(` ${url} `, SCHEMES, 2048)).toBe(true);
      expect(ClipboardLink.linkOp(` ${url} `).link.href).toBe(url);
    }
  });
});

/** A clipboard item as navigator.clipboard.read() gives it. */
function item(types) {
  return {
    types: Object.keys(types),
    getType: vi.fn(async (type) => ({ text: async () => types[type] })),
  };
}

describe("AT-CL-04 readUrlAndText: the button's clipboard read (INV-69, ruling V2)", () => {
  it("read(): the URL from text/plain, the text of the one a element with that href", async () => {
    const clipboard = { read: vi.fn(async () => [item({ "text/plain": "https://example.com/", "text/html": '<p>see <a href="https://example.com/"> Example\npage </a></p>' })]), readText: vi.fn() };
    expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS)).toEqual({ url: "https://example.com/", text: "Example page" });
    expect(clipboard.readText).not.toHaveBeenCalled();
  });

  it("no a element, or two with that href, or one whose text is empty: no text (the URL is the text)", async () => {
    for (const html of [
      "<p>https://example.com/</p>",
      '<a href="https://example.com/">A</a> <a href="https://example.com/">B</a>',
      '<a href="https://other.example/">A</a>',
      '<a href="https://example.com/">  </a>',
    ]) {
      const clipboard = { read: async () => [item({ "text/plain": "https://example.com/", "text/html": html })] };
      expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS), html).toEqual({ url: "https://example.com/", text: null });
    }
  });

  it("the HTML is parsed in an inert document: nothing goes into the page, no image is fetched, no script runs", async () => {
    window.__clipboardScriptRan = false;
    const before = document.body.innerHTML;
    const html = '<img src="https://evil.example/x.png" onerror="window.__clipboardScriptRan = true"><script>window.__clipboardScriptRan = true</script><a href="https://example.com/">ok</a>';
    const clipboard = { read: async () => [item({ "text/plain": "https://example.com/", "text/html": html })] };
    expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS)).toEqual({ url: "https://example.com/", text: "ok" });
    await new Promise((r) => setTimeout(r, 0));
    expect(window.__clipboardScriptRan).toBe(false);
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('img[src^="https://evil"]')).toBeNull();
    delete window.__clipboardScriptRan;
  });

  it("without read(): readText(); the text is the URL", async () => {
    const clipboard = { readText: vi.fn(async () => " https://example.com/x ") };
    expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS)).toEqual({ url: "https://example.com/x", text: null });
  });

  it("not a URL, refused, failed or no clipboard: null (the noUrlInClipboard toast)", async () => {
    const refused = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const cases = [
      { read: async () => [item({ "text/plain": "just text" })] },
      { read: async () => [item({ "text/html": '<a href="https://example.com/">x</a>' })] },
      { read: async () => [] },
      { read: async () => Promise.reject(refused), readText: vi.fn(async () => "https://example.com/") },
      { readText: async () => Promise.reject(refused) },
      { readText: async () => "javascript:alert(1)" },
      {},
      null,
      undefined,
    ];
    for (const clipboard of cases) expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS)).toBeNull();
    // a refused read() does not ask again with readText()
    expect(cases[3].readText).not.toHaveBeenCalled();
  });

  it("a read() that throws at once is a refusal too", async () => {
    const clipboard = {
      read: () => {
        throw new Error("no");
      },
    };
    expect(await ClipboardLink.readUrlAndText(clipboard, OPTIONS)).toBeNull();
  });
});
