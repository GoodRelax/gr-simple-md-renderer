// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preprocessCSS, resolveConfig } from "vite";
import viteConfig, { noHljsThemeCss } from "../../vite.config.js";

// AT-THM: the build-time PostCSS check that keeps highlight.js theme CSS out
// of the bundle (spec 5.8.1: style.css colors the code with Primer
// prettylights). The CSS goes through vite's own CSS pipeline with this
// project's vite.config.js, so the file path vite hands to PostCSS is the one
// the build uses.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const stylesDir = resolve(root, "node_modules/highlight.js/styles");

let config;
beforeAll(async () => {
  config = await resolveConfig({ configFile: resolve(root, "vite.config.js") }, "build");
});

/** The CSS after vite's pipeline, as if it were the file at `filename`. */
async function processed(css, filename) {
  return (await preprocessCSS(css, filename, config)).code;
}

describe("no-hljs-theme-css PostCSS check (spec 5.8.1)", () => {
  it("AT-THM-11 is registered in the build's PostCSS plugins", () => {
    expect(viteConfig.css.postcss.plugins).toContain(noHljsThemeCss);
  });

  it.each(["github.css", "github-dark.css", "vs2015.css", "base16/github.css"])(
    "AT-THM-12 bundling highlight.js/styles/%s fails the build",
    async (file) => {
      const path = resolve(stylesDir, file);
      await expect(processed(readFileSync(path, "utf8"), path)).rejects.toThrow(/must not be bundled/);
    },
  );

  it("AT-THM-13 Windows paths are recognized too; other files are left as they are", async () => {
    await expect(processed(".hljs { color: red }", "C:\\x\\node_modules\\highlight.js\\styles\\github.css")).rejects.toThrow(
      /must not be bundled/,
    );
    for (const filename of ["/x/src/css/style.css", "/x/node_modules/katex/dist/katex.min.css"]) {
      const code = await processed(".hljs { color: red } a { color: blue }", filename);
      expect(code, filename).toMatch(/\.hljs\s*\{\s*color: red/);
    }
  });
});
