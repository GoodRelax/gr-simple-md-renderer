import { describe, it, expect, vi } from "vitest";
import { parseGitHubFileUrl, resolveRelativeUrl, classifyToken, encodePath } from "../js/gitHubUrl.js";
import { textToBase64, base64ToText, withoutBom } from "../js/base64Text.js";
import GitHubFileRef from "../js/classes/GitHubFileRef.js";
import GitHubLink from "../js/classes/GitHubLink.js";
import GitHubContentsClient from "../js/classes/GitHubContentsClient.js";
import DocumentLifecycle from "../js/classes/DocumentLifecycle.js";
import SaveDocument from "../js/classes/SaveDocument.js";
import SaveDocumentAs from "../js/classes/SaveDocumentAs.js";
import { CONFIG } from "../js/config.js";
import { fakeFileAccess } from "./helpers/fakeFs.js";

// AT-GH (SC-27): the GitHub URL, Base64, the API client and
// the GitHub link of DocumentLifecycle. No request leaves the test.

const G = CONFIG.github;
const TOKEN = "github_pat_11ABCDEF0123456789_abcdefghijklmnopqrstuvwxyz";
const REF = new GitHubFileRef("GoodRelax", "repo", "main", "docs/a.md");

describe("AT-GH-01 parseGitHubFileUrl", () => {
  it("splits the file page URL", () => {
    const r = parseGitHubFileUrl(" https://github.com/GoodRelax/repo/blob/main/docs/a.md ", G);
    expect(r.ok).toBe(true);
    expect(r.ref).toEqual(REF);
    expect(r.ref.label()).toBe("GoodRelax/repo @main docs/a.md");
  });

  it("takes the first segment as the branch (feature/x is corrected in the dialog)", () => {
    const r = parseGitHubFileUrl("https://github.com/o/r/blob/feature/x/a.md", G);
    expect(r.ref.branch).toBe("feature");
    expect(r.ref.path).toBe("x/a.md");
  });

  it("decodes percent-encoded segments", () => {
    const r = parseGitHubFileUrl("https://github.com/o/r/blob/main/%E8%B3%87%E6%96%99/a%20b.md", G);
    expect(r.ref.path).toBe("\u8cc7\u6599/a b.md");
  });

  it.each([
    ["https://raw.githubusercontent.com/o/r/main/a.md", "raw"],
    ["https://github.com/o/r/blob/main/a.txt", "notMarkdown"],
    ["https://github.com/o/r/tree/main/docs", "notGitHub"],
    ["https://github.com/o/r", "notGitHub"],
    ["https://gitlab.com/o/r/blob/main/a.md", "notGitHub"],
    ["https://evil.example/https://github.com/o/r/blob/main/a.md", "notGitHub"],
    ["https://user:pw@github.com/o/r/blob/main/a.md", "notGitHub"],
    ["http://github.com/o/r/blob/main/a.md", "notGitHub"],
    ["not a url", "notGitHub"],
  ])("refuses %s (%s)", (url, reason) => {
    expect(parseGitHubFileUrl(url, G)).toEqual({ ok: false, reason });
  });

  it("accepts .markdown in any case", () => {
    expect(parseGitHubFileUrl("https://github.com/o/r/blob/main/A.MARKDOWN", G).ok).toBe(true);
  });
});

describe("AT-GH-02 resolveRelativeUrl", () => {
  it.each([
    ["img/a.png", "image", "https://raw.githubusercontent.com/GoodRelax/repo/main/docs/img/a.png"],
    ["../top.png", "image", "https://raw.githubusercontent.com/GoodRelax/repo/main/top.png"],
    ["/root.png", "image", "https://raw.githubusercontent.com/GoodRelax/repo/main/root.png"],
    ["../../../up.png", "image", "https://raw.githubusercontent.com/GoodRelax/repo/main/up.png"],
    ["b.md", "link", "https://github.com/GoodRelax/repo/blob/main/docs/b.md"],
    ["b.md#part", "link", "https://github.com/GoodRelax/repo/blob/main/docs/b.md#part"],
    ["a b.md", "link", "https://github.com/GoodRelax/repo/blob/main/docs/a%20b.md"],
  ])("%s (%s) -> %s", (value, kind, expected) => {
    expect(resolveRelativeUrl(REF, value, kind, G)).toBe(expected);
  });

  it.each(["https://x.example/a.png", "//x.example/a.png", "#top", "mailto:a@b.c", "data:image/png;base64,AA", ""])(
    "leaves %s alone",
    (value) => {
      expect(resolveRelativeUrl(REF, value, "image", G)).toBeNull();
      expect(resolveRelativeUrl(REF, value, "link", G)).toBeNull();
    },
  );

  it("keeps a branch with a slash", () => {
    const ref = new GitHubFileRef("o", "r", "feature/x", "a.md");
    expect(resolveRelativeUrl(ref, "i.png", "image", G)).toBe("https://raw.githubusercontent.com/o/r/feature/x/i.png");
    expect(encodePath("feature/x y")).toBe("feature/x%20y");
  });
});

describe("AT-GH-03 classifyToken (D12)", () => {
  it.each([
    ["", "empty"],
    [TOKEN, "fineGrained"],
    ["ghp_0123456789abcdef", "other"],
    ["gho_abc", "other"],
    ["github_pat_has space", "other"],
  ])("%s -> %s", (token, kind) => {
    expect(classifyToken(token, G.tokenPrefix)).toBe(kind);
  });
});

describe("AT-GH-04 Base64 text", () => {
  it.each(["# \u898b\u51fa\u3057\n\u672c\u6587\n", "\uFEFF# BOM\r\nCRLF\r\n", "a".repeat(100000) + "\u65e5\u672c\u8a9e"])("round-trips", (text) => {
    const decoded = base64ToText(textToBase64(text));
    expect(decoded.ok).toBe(true);
    expect(decoded.fileText).toBe(text);
    expect(decoded.hasBom).toBe(text.startsWith("\uFEFF"));
  });

  it("reads Base64 with line breaks (the Contents API's form)", () => {
    const b64 = textToBase64("x".repeat(200)).replace(/(.{60})/g, "$1\n");
    expect(base64ToText(b64).fileText).toBe("x".repeat(200));
  });

  it("refuses a NUL byte and invalid UTF-8", () => {
    expect(base64ToText(btoa("a\u0000b")).ok).toBe(false);
    expect(base64ToText(btoa("\u00ff\u00fe")).ok).toBe(false);
    expect(base64ToText("***").ok).toBe(false);
  });

  it("withoutBom", () => {
    expect(withoutBom("\uFEFFa")).toBe("a");
    expect(withoutBom("a")).toBe("a");
  });
});

/** A fetch that answers from a list and records the requests. */
function scriptedFetch(answers) {
  const calls = [];
  const fetchFn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers ?? {},
    });
  });
  return { fetchFn, calls };
}

const FILE_BODY = { type: "file", sha: "blob1", size: 10, encoding: "base64", content: textToBase64("\uFEFF# A\r\n") };
const COMMITS_BODY = [
  { sha: "c1c1c1c1c1", html_url: "https://github.com/o/r/commit/c1", commit: { message: "Fix typo\n\nbody", author: { name: "GoodRelax", date: "2026-10-24T09:12:00Z" } } },
];

describe("AT-GH-05 GitHubContentsClient", () => {
  it("opens: file, last commit, visibility; headers and the fixed origin", async () => {
    const { fetchFn, calls } = scriptedFetch([{ body: FILE_BODY }, { body: COMMITS_BODY }, { body: { private: true } }]);
    const r = await new GitHubContentsClient(fetchFn, G).openFile(REF, TOKEN);
    expect(r.status).toBe("ok");
    expect(r.text).toBe("# A\r\n");
    expect(r.hasBom).toBe(true);
    expect(r.link.blobSha).toBe("blob1");
    expect(r.link.fileText).toBe("\uFEFF# A\r\n");
    expect(r.link.isPrivate).toBe(true);
    expect(r.link.lastCommit).toMatchObject({ message: "Fix typo", author: "GoodRelax" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/GoodRelax/repo/contents/docs/a.md?ref=main",
      "https://api.github.com/repos/GoodRelax/repo/commits?path=docs%2Fa.md&sha=main&per_page=1",
      "https://api.github.com/repos/GoodRelax/repo",
    ]);
    for (const { url, init } of calls) {
      expect(url).not.toContain(TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.headers["X-GitHub-Api-Version"]).toBe(G.apiVersion);
      expect(init).toMatchObject({ cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    }
  });

  it("sends no Authorization header without a token", async () => {
    const { fetchFn, calls } = scriptedFetch([{ body: FILE_BODY }, { body: [] }, { body: { private: false } }]);
    await new GitHubContentsClient(fetchFn, G).openFile(REF, "");
    expect(calls.every((c) => !("Authorization" in c.init.headers))).toBe(true);
  });

  it("refuses a file over 1 MB and a directory", async () => {
    const big = scriptedFetch([{ body: { ...FILE_BODY, size: G.maxBytes + 1 } }]);
    expect((await new GitHubContentsClient(big.fetchFn, G).openFile(REF, "")).message).toBe(G.messages.tooLarge);
    const dir = scriptedFetch([{ body: [{ type: "file" }] }]);
    expect((await new GitHubContentsClient(dir.fetchFn, G).openFile(REF, "")).message).toBe(G.messages.notFile);
  });

  it.each([
    [{ status: 401, body: { message: "Bad credentials" } }, G.messages.unauthorized],
    [{ status: 404, body: { message: "Not Found" } }, G.messages.notFound],
    [{ status: 403, body: { message: "Resource not accessible" } }, G.messages.forbidden(G.labels.gitHubDetail("Resource not accessible"))],
    [{ status: 403, body: {}, headers: { "x-ratelimit-remaining": "0", "retry-after": "30" } }, G.messages.rateLimited(G.labels.retryIn("30"))],
    [{ status: 500, body: {} }, G.messages.failed(500)],
    [new TypeError("offline"), G.messages.network],
  ])("maps a failure to its message", async (answer, message) => {
    const { fetchFn } = scriptedFetch([answer]);
    const r = await new GitHubContentsClient(fetchFn, G).openFile(REF, TOKEN);
    expect(r).toEqual({ status: "error", message });
    expect(r.message).not.toContain(TOKEN);
  });

  it("pushes with the blob sha and branch; 409 does not change the link", async () => {
    const link = new GitHubLink({ ref: REF, blobSha: "blob1", fileText: "a\n", isPrivate: false, lastCommit: null });
    const ok = scriptedFetch([{ body: { content: { sha: "blob2" }, commit: { sha: "c2c2c2c", message: "m", html_url: "https://github.com/x" } } }]);
    const r = await new GitHubContentsClient(ok.fetchFn, G).pushFile(link, "\uFEFFb\r\n", "Update docs/a.md", TOKEN);
    expect(r.status).toBe("ok");
    expect(r.link.blobSha).toBe("blob2");
    expect(r.link.isSameAs("\uFEFFb\r\n")).toBe(true);
    const sent = JSON.parse(ok.calls[0].init.body);
    expect(ok.calls[0].init.method).toBe("PUT");
    expect(sent).toEqual({ message: "Update docs/a.md", content: textToBase64("\uFEFFb\r\n"), sha: "blob1", branch: "main" });
    const conflict = scriptedFetch([{ status: 409, body: { message: "docs/a.md does not match blob1" } }]);
    const c = await new GitHubContentsClient(conflict.fetchFn, G).pushFile(link, "b\n", "m", TOKEN);
    expect(c.status).toBe("error");
    expect(c.message).toContain("409");
    expect(link.blobSha).toBe("blob1");
  });
});

describe("AT-GH-06 DocumentLifecycle and the GitHub link", () => {
  const setup = () => {
    const access = fakeFileAccess({});
    const M = CONFIG.messages.edit;
    const N = CONFIG.edit.defaultFileName;
    return new DocumentLifecycle(access, {
      saveDocument: new SaveDocument(access, M, N),
      saveDocumentAs: new SaveDocumentAs(access, M, N),
      messages: M,
      defaultFileName: N,
    });
  };
  const link = new GitHubLink({ ref: REF, blobSha: "s1", fileText: "# A\r\n", isPrivate: false, lastCommit: null });

  it("openGitHub: the file name as the local target, no handle; the link is kept", () => {
    const d = setup();
    d.openGitHub("# A\r\n", false, link);
    expect(d.location.fileName).toBe("a.md");
    expect(d.location.fileHandle).toBeNull();
    expect(d.gitHub).toBe(link);
    expect(d.fileTextOf(d.session.getBodyText())).toBe("# A\r\n");
  });

  it("a drop keeps the link only when asked; paste, close drop it", () => {
    const d = setup();
    d.openGitHub("# A\n", false, link);
    d.openFile("# B\n", false, 1, "b.md", null, true);
    expect(d.gitHub).toBe(link);
    d.openFile("# C\n", false, 1, "c.md", null);
    expect(d.gitHub).toBeNull();
    d.openGitHub("# A\n", false, link);
    d.startPasted("x");
    expect(d.gitHub).toBeNull();
    d.openGitHub("# A\n", false, link);
    d.close();
    expect(d.gitHub).toBeNull();
  });

  it("a push refuses replaces (as INV-54) and moves the baseline on success", () => {
    const d = setup();
    d.openGitHub("# A\n", false, link);
    const started = d.startPush();
    expect(started).not.toBeNull();
    expect(d.isSaving()).toBe(true);
    expect(d.startPush()).toBeNull();
    const pushed = link.withPushed("s2", "# A2\n", null);
    expect(d.finishPush(started, { link: pushed, bodyText: "# A2\n" })).toBe(true);
    expect(d.isSaving()).toBe(false);
    expect(d.isBodyChanged("# A2\n")).toBe(false);
    expect(d.gitHub.blobSha).toBe("s2");
  });

  it("a failed push changes nothing", () => {
    const d = setup();
    d.openGitHub("# A\n", false, link);
    const started = d.startPush();
    expect(d.finishPush(started, null)).toBe(false);
    expect(d.gitHub).toBe(link);
    expect(d.isBodyChanged("# A\n")).toBe(false);
  });
});
