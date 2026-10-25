import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";
import { CONFIG } from "./src/js/config.js";
import { separatedOf, separatedOfEpochSeconds, stampBuildVersion } from "./tools/version.mjs";
import { collectNotices, formatHelpList, formatNotices, stampNotices, verdictOf } from "./tools/notices.mjs";

// Keep only the woff2 source in each @font-face rule, dropping the woff/ttf
// fallback copies. woff2 is supported by every browser that can run this app
// (ES modules, File System Access API), so the other formats are dead weight
// once inlined. Same glyphs, roughly two-thirds fewer font bytes.
const katexWoff2Only = {
  postcssPlugin: "katex-woff2-only",
  Declaration(decl) {
    if (decl.prop !== "src" || !decl.value.includes("woff2")) return;
    const woff2 = decl.value.split(",").filter((part) => part.includes("woff2"));
    if (woff2.length) decl.value = woff2.join(",").trim();
  },
};

// The code colors are style.css's own (Primer prettylights, spec 5.8.1). A
// highlight.js theme is a set of global .hljs rules that would override or
// mix with them, so importing any file from highlight.js/styles fails the
// build.
export const noHljsThemeCss = {
  postcssPlugin: "no-hljs-theme-css",
  Once(root) {
    const file = root.source?.input?.file ?? "";
    const match = /[\\/]highlight\.js[\\/]styles[\\/](.+)$/.exec(file);
    if (match) {
      throw root.error(`highlight.js theme "${match[1]}" must not be bundled; style.css colors the code`);
    }
  },
};

// Fail the build if the output still imports code from the network. All
// libraries must be bundled; a leftover CDN import would make the app depend
// on that host to start. Listed after viteSingleFile so it sees the final HTML.
const noExternalImports = {
  name: "no-external-imports",
  generateBundle(_options, bundle) {
    // The Oxc minifier (Vite 8) may emit import(`...`) with a template literal.
    const remoteImport =
      /\bimport\b[^;]*?\bfrom\s*["']https?:\/\/|\bimport\s*\(\s*["'`]https?:\/\//;
    for (const file of Object.values(bundle)) {
      const code = file.type === "chunk" ? file.code : String(file.source);
      if (remoteImport.test(code) || code.includes("cdnjs")) {
        this.error(`External import or "cdnjs" found in ${file.fileName}`);
      }
    }
  },
};

// The version shown in the help (R3, R4; the rule is spec 1.7). A release
// build (npm run build:release, mode "release") shows package.json's version;
// any other build or the dev server shows the time of the HEAD commit as a
// development build, so the same commit always gives the same text. The
// version goes into the HTML as text, not into a script, so the CSP hash does
// not change. A missing version, a malformed one, an unreadable HEAD or a
// help without exactly one version slot per language fails the build.
export function buildVersionOf(mode, { readPackage, headEpochSeconds }) {
  if (mode === "release") {
    const version = readPackage().version;
    if (version === undefined) {
      throw new Error("package.json has no version; a release build runs from tools/release.mjs");
    }
    return { kind: "release", instant: separatedOf(version) };
  }
  return { kind: "dev", instant: separatedOfEpochSeconds(headEpochSeconds()) };
}

export function buildVersion() {
  let mode = "";
  let projectDir = "";
  const readPackage = () => JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
  const headEpochSeconds = () =>
    Number(execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: projectDir, encoding: "utf8" }).trim());
  return {
    name: "build-version",
    configResolved(config) {
      mode = config.mode;
      projectDir = dirname(config.root); // root is <project>/src
    },
    transformIndexHtml(html) {
      try {
        return stampBuildVersion(html, buildVersionOf(mode, { readPackage, headEpochSeconds }));
      } catch (error) {
        throw new Error(`build-version: ${error.message}`);
      }
    },
  };
}

// Third-party notices (spec appendix A.2): the copyright and license texts of
// the bundled packages go into a comment at the end of the HTML, and a short
// list into the help. The packages come from the chunk's modules, so a new
// dependency is picked up by itself; a license outside ALLOWED_LICENSES, a
// missing text, or code bundled inside a dist that tools/third-party-extras.mjs
// does not list (by its marks, the host's declared dependencies, or the record
// of that prebuilt dist's version) fails the build. A text still pending fails
// a release build and warns in any other. The comment and the list are HTML
// text, not script, so the CSP hash does not change.
/**
 * @returns {object}  the Vite plugin
 * @purity non-pure
 */
export function thirdPartyNotices() {
  let mode = "";
  let projectDir = "";
  const modules = [];
  const fs = {
    readText: (path) => readFileSync(path, "utf8"),
    readBytes: (path) => readFileSync(path),
    list: (dir) => readdirSync(dir),
  };
  return {
    name: "third-party-notices",
    apply: "build",
    enforce: "post",
    /**
     * @param {object} config
     * @purity non-pure
     */
    configResolved(config) {
      mode = config.mode;
      projectDir = dirname(config.root); // root is <project>/src
    },
    /**
     * A new build (watch mode, or a second build with this plugin) starts empty.
     * @purity non-pure
     */
    buildStart() {
      modules.length = 0;
    },
    /**
     * @param {string} _code
     * @param {object} chunk
     * @returns {null}
     * @purity non-pure
     */
    renderChunk(_code, chunk) {
      for (const [id, info] of Object.entries(chunk.modules)) {
        modules.push({ id, renderedLength: info.renderedLength });
      }
      return null;
    },
    /**
     * @param {object} _options
     * @param {object} bundle
     * @purity non-pure
     */
    generateBundle(_options, bundle) {
      const outcome = collectNotices({ modules, nodeModules: join(projectDir, "node_modules"), fs });
      const { error, warning } = verdictOf(outcome, mode);
      if (error) this.error(error);
      if (warning) this.warn(warning);
      const { entries } = outcome;
      const parts = { notices: formatNotices(entries), list: formatHelpList(entries) };
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        try {
          file.source = stampNotices(String(file.source), parts);
        } catch (error) {
          this.error(`${file.fileName}: ${error.message}`);
        }
      }
    },
  };
}

// Content-Security-Policy for the built single file (INV-20), as defense in
// depth behind DOMPurify. vite-plugin-singlefile inlines the module script, so
// script-src allows exactly that script by its sha256 hash. Listed after
// viteSingleFile so it hashes the final inlined code. Build only: the dev
// server serves the script from a URL and injects its own client.
//
// img-src allows https: because external images load after the user consents
// (INV-19) and a <meta> CSP cannot change at runtime. The consent gate is
// what keeps them from loading earlier; the CSP still blocks http: images,
// media, frames, plugins, remote fonts and any fetch except to PlantUML.
const PLANTUML_ORIGIN = new URL(CONFIG.plantuml.serverUrl).origin;
const SCRIPT_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);

export function buildCsp(scriptHashes) {
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.map((h) => `'sha256-${h}'`).join(" ")}`,
    // KaTeX and Mermaid write inline style attributes and <style> elements.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${PLANTUML_ORIGIN} https:`,
    "font-src data:",
    // DiagramCopyController fetches the PlantUML image to copy it.
    `connect-src ${PLANTUML_ORIGIN}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export const contentSecurityPolicy = {
  name: "content-security-policy",
  apply: "build",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
      const html = String(file.source);
      // Comments may hold disabled snippets; they never execute.
      const live = html.replace(/<!--[\s\S]*?-->/g, "");

      const hashes = [];
      // Inlined code has "</script" and "<!--" escaped by viteSingleFile, so
      // each match is one real <script> element.
      for (const [, attrs, body] of live.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      )) {
        if (/\ssrc\s*=/i.test(attrs)) {
          this.error(`${file.fileName}: <script src> is not allowed (inline only)`);
        }
        const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";
        // Data blocks such as application/ld+json never execute.
        if (!SCRIPT_TYPES.has(type.toLowerCase())) continue;
        // The HTML parser turns CR LF / CR into LF before the browser hashes.
        const source = body.replace(/\r\n?/g, "\n");
        hashes.push(createHash("sha256").update(source, "utf8").digest("base64"));
      }
      if (hashes.length === 0) {
        this.error(`${file.fileName}: no inline script found to hash`);
      }

      // A <meta> CSP only governs what comes after it: put it first in <head>.
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(hashes)}" />`;
      const charset = /<meta\s+charset\s*=[^>]*>/i;
      if (!charset.test(html)) {
        this.error(`${file.fileName}: <meta charset> not found; cannot place the CSP`);
      }
      file.source = html.replace(charset, (tag) => `${tag}\n    ${meta}`);
    }
  },
};

export default defineConfig({
  root: "src",
  build: {
    outDir: "../docs",
    emptyOutDir: false,
    // Inline all assets (incl. katex woff2 fonts) as data URIs so the output
    // stays a single self-contained file.
    assetsInlineLimit: 100000000,
  },
  css: {
    postcss: {
      plugins: [katexWoff2Only, noHljsThemeCss],
    },
  },
  plugins: [buildVersion(), viteSingleFile(), noExternalImports, thirdPartyNotices(), contentSecurityPolicy],
  test: {
    environment: "jsdom",
    root: ".",
    // Agent worktrees under .claude/ hold copies of the tests; skip them.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
