import { describe, it, expect } from "vitest";
import { isSignedUrl, isReloadable, markUrlForReload, markSrcsetForReload, RELOAD_MARK_PARAM } from "../js/imageReloadMark.js";
import { stripUrlEnds } from "../js/urlEnds.js";

const PAGES = "https://goodrelax.github.io/gr-simple-md-renderer/";
const LOCAL_FILE = "file:///C:/Users/someone/GRSMD.html";
const MARK = "1763000000000";

describe("AT-IRM imageReloadMark (INV-110)", () => {
  // Spec: INV-110 (2).
  it("AT-IRM-01 (a) marks http: and https: URLs, and a relative URL that resolves to them", () => {
    expect(markUrlForReload("https://example.com/a.png", MARK, PAGES)).toBe(`https://example.com/a.png?grsmd=${MARK}`);
    expect(markUrlForReload("http://127.0.0.1:8080/a.png", MARK, PAGES)).toBe(`http://127.0.0.1:8080/a.png?grsmd=${MARK}`);
    expect(markUrlForReload("HTTPS://EXAMPLE.COM/A.PNG", MARK, PAGES)).toBe(`HTTPS://EXAMPLE.COM/A.PNG?grsmd=${MARK}`);
    expect(markUrlForReload("//example.com/a.png", MARK, PAGES)).toBe(`//example.com/a.png?grsmd=${MARK}`);
    expect(markUrlForReload("img/a.png", MARK, PAGES)).toBe(`img/a.png?grsmd=${MARK}`);
    expect(RELOAD_MARK_PARAM).toBe("grsmd");
  });

  // Spec: INV-110 (2).
  it.each([
    ["data:", "data:image/png;base64,iVBORw0KGgo="],
    ["blob:", "blob:https://goodrelax.github.io/0f1e2d3c"],
    ["ftp:", "ftp://example.com/a.png"],
    ["javascript:", "javascript:alert(1)"],
    ["a relative URL under file:", "img/a.png"],
  ])("AT-IRM-01 (b) leaves %s as written", (_, url) => {
    const base = url === "img/a.png" ? LOCAL_FILE : PAGES;
    expect(markUrlForReload(url, MARK, base)).toBe(url);
    expect(isReloadable(url, base)).toBe(false);
  });

  // Spec: INV-110 (2).
  it("AT-IRM-01 (c) leaves a URL that cannot be parsed as written", () => {
    expect(markUrlForReload("http://[::1", MARK, PAGES)).toBe("http://[::1");
  });

  // Spec: INV-110 (2).
  it("AT-IRM-02 adds the mark with & after a query, keeps the fragment last, and keeps the rest as written", () => {
    expect(markUrlForReload("https://h/a.png?w=10", MARK, PAGES)).toBe(`https://h/a.png?w=10&grsmd=${MARK}`);
    expect(markUrlForReload("https://h/a.png?", MARK, PAGES)).toBe(`https://h/a.png?grsmd=${MARK}`);
    expect(markUrlForReload("https://h/a.png?w=10&", MARK, PAGES)).toBe(`https://h/a.png?w=10&grsmd=${MARK}`);
    expect(markUrlForReload("https://h/a.svg#icon", MARK, PAGES)).toBe(`https://h/a.svg?grsmd=${MARK}#icon`);
    expect(markUrlForReload("https://h/a.svg?v=2#icon?x", MARK, PAGES)).toBe(`https://h/a.svg?v=2&grsmd=${MARK}#icon?x`);
    expect(markUrlForReload("https://h/a%20b.png?q=%E3%81%82", MARK, PAGES)).toBe(`https://h/a%20b.png?q=%E3%81%82&grsmd=${MARK}`);
  });

  // Spec: INV-110 (3).
  it.each([
    ["Azure SAS", "https://acct.blob.core.windows.net/c/a.png?sv=2024-01-01&se=2026-12-01&sig=abc%3D"],
    ["Azure SAS (se only)", "https://acct.blob.core.windows.net/c/a.png?se=2026-12-01"],
    ["S3 presigned", "https://b.s3.amazonaws.com/a.png?X-Amz-Algorithm=AWS4&X-Amz-Credential=k&X-Amz-Signature=f00"],
    ["GCS signed", "https://storage.googleapis.com/b/a.png?X-Goog-Signature=f00"],
    ["CloudFront", "https://d.cloudfront.net/a.png?Expires=1&Signature=s&Key-Pair-Id=k"],
    ["SharePoint tempauth", "https://t.sharepoint.com/_layouts/15/download.aspx?UniqueId=1&tempauth=v1.e"],
    ["raw token", "https://raw.githubusercontent.com/o/r/main/a.png?token=GHSAT0"],
    ["Alibaba Cloud OSS V4", "https://b.oss-cn-hangzhou.aliyuncs.com/a.png?x-oss-signature-version=OSS4&x-oss-signature=f00"],
    ["Tencent Cloud COS", "https://b.cos.ap-tokyo.myqcloud.com/a.png?q-sign-algorithm=sha1&q-signature=f00"],
    ["Akamai hdnts", "https://cdn.example.com/a.png?hdnts=st=1~exp=2~hmac=f00"],
    ["Akamai hdnea", "https://cdn.example.com/a.png?hdnea=exp=2~hmac=f00"],
    ["Akamai __token__", "https://cdn.example.com/a.png?__token__=exp=2~hmac=f00"],
    ["percent-encoded name", "https://h/a.png?X%2DAmz%2DSignature=f00"],
    ["name without a value", "https://h/a.png?sig"],
    ["signed, with a fragment", "https://h/a.png?sig=1#top"],
  ])("AT-IRM-03 (a) leaves a signed URL as written: %s", (_, url) => {
    expect(isSignedUrl(url)).toBe(true);
    expect(markUrlForReload(url, MARK, PAGES)).toBe(url);
  });

  // Spec: INV-110 (3).
  it.each([
    ["no query", "https://h/a.png"],
    ["a name that only starts like one", "https://h/a.png?sigma=1&seed=2&tokens=3"],
    ["sig= inside a value", "https://h/a.png?q=sig=1"],
    ["sig= only in the fragment", "https://h/a.png#sig=1"],
    ["sig= in a fragment that holds a ?", "https://h/a.png#top?sig=1"],
    ["sig= in the fragment after a query", "https://h/a.png?x=1#a&sig=2"],
    ["sig= in the path", "https://h/sig=1/a.png"],
    ["a broken percent escape", "https://h/a.png?%E0%A4%A=1"],
  ])("AT-IRM-03 (b) marks a URL that is not signed: %s", (_, url) => {
    expect(isSignedUrl(url)).toBe(false);
    expect(markUrlForReload(url, MARK, PAGES)).not.toBe(url);
  });

  // Spec: INV-110 (4).
  it("AT-IRM-04 (a) marks each srcset candidate and keeps its descriptor", () => {
    expect(markSrcsetForReload("https://h/a.png 1x, https://h/a@2x.png 2x", MARK, PAGES)).toBe(
      `https://h/a.png?grsmd=${MARK} 1x, https://h/a@2x.png?grsmd=${MARK} 2x`,
    );
    expect(markSrcsetForReload("https://h/a.png?w=480 480w,https://h/b.png 800w", MARK, PAGES)).toBe(
      `https://h/a.png?w=480&grsmd=${MARK} 480w, https://h/b.png?grsmd=${MARK} 800w`,
    );
    expect(markSrcsetForReload("https://h/a.png", MARK, PAGES)).toBe(`https://h/a.png?grsmd=${MARK}`);
  });

  // Spec: INV-110 (3)(4).
  it("AT-IRM-04 (b) leaves signed and non-http candidates as written, and splits as the srcset parser does", () => {
    expect(markSrcsetForReload("https://h/a.png?sig=1 1x, https://h/b.png 2x", MARK, PAGES)).toBe(
      `https://h/a.png?sig=1 1x, https://h/b.png?grsmd=${MARK} 2x`,
    );
    expect(markSrcsetForReload("data:image/png;base64,AAA= 1x, https://h/b.png 2x", MARK, PAGES)).toBe(
      `data:image/png;base64,AAA= 1x, https://h/b.png?grsmd=${MARK} 2x`,
    );
    expect(markSrcsetForReload("https://h/a,b.png 1x, https://h/c.png,, https://h/d.png 3x", MARK, PAGES)).toBe(
      `https://h/a,b.png?grsmd=${MARK} 1x, https://h/c.png?grsmd=${MARK}, https://h/d.png?grsmd=${MARK} 3x`,
    );
  });

  // Spec: INV-19, INV-110 (2).
  it("AT-IRM-06 (a) stripUrlEnds strips only C0 controls and SPACE from both ends", () => {
    expect(stripUrlEnds(" \u000b\t\nhttps://h/a.png \r ")).toBe("https://h/a.png");
    expect(stripUrlEnds("\u00a0https://h/a.png\u3000")).toBe("\u00a0https://h/a.png\u3000");
    expect(stripUrlEnds("\ufeffdata:x\u2028")).toBe("\ufeffdata:x\u2028");
    expect(stripUrlEnds("a b")).toBe("a b");
    expect(stripUrlEnds("  ")).toBe("");
  });

  // Spec: INV-110 (2)(7).
  it.each([
    ["U+00A0 before https:", "\u00a0https://h.example/a.png"],
    ["U+3000 before //host", "\u3000//h.example/b"],
    ["U+3000 after the path", "https://h.example/x.png\u3000"],
    ["U+FEFF before https:", "\ufeffhttps://h.example/a.png"],
    ["SPACE and U+000B around the URL", " \u000bhttps://h.example/a.png "],
  ])("AT-IRM-06 (b) the mark keeps where the browser sends the image: %s", (_, url) => {
    const marked = markUrlForReload(url, MARK, PAGES);
    expect(marked).not.toBe(url);
    expect(marked.endsWith(`grsmd=${MARK}`)).toBe(true);
    const before = new URL(url, PAGES);
    const after = new URL(marked, PAGES);
    expect(after.origin).toBe(before.origin);
    expect(after.pathname).toBe(before.pathname);
  });

  // Spec: INV-110 (5).
  it("AT-IRM-05 a null mark leaves every URL and srcset as written", () => {
    expect(markUrlForReload("https://h/a.png", null, PAGES)).toBe("https://h/a.png");
    expect(markSrcsetForReload("https://h/a.png 1x,  https://h/b.png 2x", null, PAGES)).toBe("https://h/a.png 1x,  https://h/b.png 2x");
  });
});
