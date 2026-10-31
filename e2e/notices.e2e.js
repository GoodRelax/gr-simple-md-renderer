import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";

// Third-party notices in the built file (spec appendix A.2, INV-75): the full
// texts in a comment at the end, a pointer near the top, and the short list in
// both help bodies. The page itself must still load under its CSP (fixtures).

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const installed = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;

async function builtHtml(page) {
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  return response.text();
}

test("PRT-AA01: the built file ends with the notices of every direct dependency", async ({ page }) => {
  const html = await builtHtml(page);
  const start = html.lastIndexOf("<!--\nGR Simple Markdown (GRSMD)\nCopyright 2026 GoodRelax\n");
  expect(start).toBeGreaterThan(0);
  const comment = html.slice(start, html.indexOf("-->", start) + 3);
  // the comment is the last thing in <body>, and holds no other comment end
  expect(html.slice(start + comment.length).replace(/\s+/g, " ").trim()).toBe("</body> </html>");
  // GRSMD's own notice first (LIC-2), then the third-party notices; the
  // Apache License 2.0 is in full once, shared with the Apache-2.0 entries
  expect(comment).toContain('\nLicensed under the Apache License, Version 2.0 (the "License");\n');
  expect(comment).toContain("\nThe full text of the License is below, in the section that starts with ");
  expect(comment.indexOf("\nTHIRD-PARTY SOFTWARE NOTICES\n")).toBeGreaterThan(comment.indexOf("limitations under the License."));
  expect(comment.split("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION")).toHaveLength(2);
  for (const name of Object.keys(pkg.dependencies)) {
    expect(comment, name).toContain(`\n  ${name} ${installed(name)} `);
  }
  // code bundled inside a dist, and the KaTeX fonts
  expect(comment).toContain(" -- inside @mermaid-js/parser\n");
  expect(comment).toContain("with Reserved Font Name KaTeX_Main.");
  // the OFL text is taken from another font package: only the license, not its copyright lines
  expect(comment).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(comment).not.toContain("Inter Project");
  expect(comment).toContain("Copyright (c) 2013-2020 Khan Academy and other contributors");
  expect(comment).toContain("Apache License\n");
  // the pointer right after the CSP, which is still first in <head>
  const csp = html.indexOf('http-equiv="Content-Security-Policy"');
  const pointer = html.indexOf("<!-- Third-party notices: see the comment at the end of this file. -->");
  expect(csp).toBeGreaterThan(0);
  expect(pointer).toBeGreaterThan(csp);
  expect(pointer).toBeLessThan(html.indexOf("<script"));
});

for (const lang of ["en", "ja"]) {
  test(`PRT-AA02 (${lang}): the help's Licenses section lists the bundled software`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#helpBtn").click();
    await page.locator(`#helpModal [data-help-lang="${lang}"]`).click();
    const section = page.locator(`#helpModal .help-body[lang="${lang}"] [data-help-section="licenses"]`);
    await expect(section).toBeVisible();
    await expect(section.locator("h3")).toHaveText(lang === "en" ? "Licenses" : "\u30e9\u30a4\u30bb\u30f3\u30b9");
    // GRSMD's own license first, before the third-party list (LIC-2)
    await expect(section.locator("p").first()).toContainText("GRSMD");
    await expect(section.locator("p").first()).toContainText("Apache License 2.0");
    await expect(page.locator("#copyright")).toHaveText("\u00a9 2026 GoodRelax. Apache-2.0.");
    const list = section.locator("[data-third-party-list]");
    await expect(list).toContainText(`mermaid ${installed("mermaid")} (MIT)`);
    await expect(list).toContainText(`dompurify ${installed("dompurify")} (Apache-2.0)`);
    await expect(list).toContainText("KaTeX fonts");
    await expect(list.locator("*")).toHaveCount(0); // text only, escaped
  });
}
