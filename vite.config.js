import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { build as viteBuild, defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";
import { CONFIG } from "./src/js/config.js";
import { separatedOf, separatedOfEpochSeconds, stampBuildVersion } from "./tools/version.mjs";
import { APP_VIRTUAL, collectNotices, formatHelpList, formatNotices, stampNotices, verdictOf } from "./tools/notices.mjs";
import { DATA_ID_PREFIX, LAZY_LIBRARIES, layoutForFastStartup } from "./tools/fastStartup.mjs";

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
// on that host to start. Listed after fastStartup so it sees the final HTML,
// the on-demand libraries' data included.
// The Oxc minifier (Vite 8) may emit import(`...`) with a template literal.
const REMOTE_IMPORT = /\bimport\b[^;]*?\bfrom\s*["']https?:\/\/|\bimport\s*\(\s*["'`]https?:\/\//;

export function hasExternalImport(code) {
  return REMOTE_IMPORT.test(code) || code.includes("cdnjs");
}

const noExternalImports = {
  name: "no-external-imports",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      const code = file.type === "chunk" ? file.code : String(file.source);
      if (hasExternalImport(code)) {
        this.error(`External import or "cdnjs" found in ${file.fileName}`);
      }
    }
  },
};

// Fast startup (INV-81, spec 5.17): the core (the app, marked, DOMPurify)
// runs right after the markup; mermaid, highlight.js, KaTeX and the PlantUML
// encoder are each built alone (an IIFE) and put after it as data blocks
// that run on demand (src/js/classes/LibraryLoader.js). The layout is in
// tools/fastStartup.mjs. mermaid's "dompurify" is the core's (one copy, as
// before), and marked-katex-extension's "katex" in the core is a stand-in:
// src/js/lazyMath.js draws with the KaTeX that runs on demand.
const SHARED_DOMPURIFY = `${APP_VIRTUAL}shared-dompurify`;
const KATEX_STAND_IN = `${APP_VIRTUAL}katex-stand-in`;
const ON_DEMAND_PACKAGES = /[\\/]node_modules[\\/](?:mermaid|highlight\.js|katex|plantuml-encoder)[\\/]/;

const sharedDompurify = {
  name: "shared-dompurify",
  enforce: "pre",
  resolveId(source) {
    return source === "dompurify" ? SHARED_DOMPURIFY : null;
  },
  load(id) {
    return id === SHARED_DOMPURIFY ? "export default globalThis.__grsmdBoot.shared.dompurify;" : null;
  },
};

// One on-demand script built alone: an IIFE, minified, nothing split off.
async function buildIife(projectDir, entry, sharesDompurify) {
  const result = await viteBuild({
    configFile: false,
    logLevel: "warn",
    root: projectDir,
    publicDir: false,
    plugins: sharesDompurify ? [sharedDompurify] : [],
    build: {
      write: false,
      minify: true,
      lib: { entry: join(projectDir, entry), formats: ["iife"], name: "grsmdOnDemand", fileName: () => "on-demand.js" },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  if (outputs.length !== 1 || outputs[0].type !== "chunk") {
    throw new Error(`${entry}: expected one script, got ${outputs.map((o) => o.fileName).join(", ")}`);
  }
  const [chunk] = outputs;
  const modules = Object.entries(chunk.modules).map(([id, info]) => ({ id, renderedLength: info.renderedLength }));
  return { code: chunk.code, modules };
}

// lazyModules() gives the modules of the on-demand scripts to the
// third-party notices.
export function fastStartup() {
  let projectDir = "";
  let parts = null;
  let lazyModules = [];
  const coreModules = [];
  return {
    name: "fast-startup",
    apply: "build",
    enforce: "post",
    lazyModules: () => lazyModules,
    configResolved(config) {
      projectDir = dirname(config.root); // root is <project>/src
    },
    async buildStart() {
      coreModules.length = 0;
      const boot = await buildIife(projectDir, "src/js/bootScript.js", false);
      const libraries = [];
      lazyModules = [];
      for (const { name, entry, sharesDompurify } of LAZY_LIBRARIES) {
        const built = await buildIife(projectDir, entry, sharesDompurify);
        if (hasExternalImport(built.code)) this.error(`External import or "cdnjs" found in ${name}`);
        libraries.push({ name, code: built.code });
        lazyModules.push(...built.modules);
      }
      parts = { boot: boot.code, libraries };
    },
    renderChunk(_code, chunk) {
      coreModules.push(...Object.keys(chunk.modules));
      return null;
    },
    generateBundle(_options, bundle) {
      // the KaTeX CSS (no fonts) stays in the core's <style>
      const heavy = coreModules.filter((id) => ON_DEMAND_PACKAGES.test(id) && !/\.css($|\?)/.test(id));
      if (heavy.length > 0) this.error(`the core must not bundle an on-demand library: ${heavy[0]}`);
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        try {
          file.source = layoutForFastStartup(String(file.source), parts);
        } catch (error) {
          this.error(`${file.fileName}: ${error.message}`);
        }
      }
    },
  };
}

// Before Vite's own resolver: the core's marked-katex-extension gets the stand-in.
const katexStandIn = {
  name: "katex-stand-in",
  apply: "build",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "katex" && /marked-katex-extension/.test(importer ?? "")) return KATEX_STAND_IN;
    return null;
  },
  load(id) {
    if (id !== KATEX_STAND_IN) return null;
    return 'export default { renderToString() { throw new Error("KaTeX runs on demand (src/js/lazyMath.js)"); } };';
  },
};

// The dev server has no data blocks: the receiver and the libraries come
// from src/js/lazy/dev.js, which runs before main.js.
const devLibraries = {
  name: "dev-libraries",
  apply: "serve",
  transformIndexHtml() {
    return [{ tag: "script", attrs: { type: "module", src: "/js/lazy/dev.js" }, injectTo: "head" }];
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
export function thirdPartyNotices({ moreModules = () => [] } = {}) {
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
      const outcome = collectNotices({ modules: [...modules, ...moreModules()], nodeModules: join(projectDir, "node_modules"), fs });
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
// depth behind DOMPurify. script-src allows exactly the file's scripts by
// their sha256 hashes: the receiver, the core, the arrival notes, and the
// on-demand libraries' data blocks, which LibraryLoader runs as scripts of
// their own (INV-81). Listed last so it hashes the final text. Build only:
// the dev server serves the script from a URL and injects its own client.
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

// The script elements of an HTML text, outside comments: [attributes, text].
// A comment is skipped whole, and a script's text is taken whole (its
// "</script" are escaped, tools/fastStartup.mjs), whichever starts first.
export function scriptElementsOf(html) {
  const found = [];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!m[0].startsWith("<!--")) found.push([m[1], m[2]]);
  }
  return found;
}

export const contentSecurityPolicy = {
  name: "content-security-policy",
  apply: "build",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
      const html = String(file.source);

      const hashes = [];
      // Comments may hold disabled snippets; they never execute.
      for (const [attrs, body] of scriptElementsOf(html)) {
        if (/\ssrc\s*=/i.test(attrs)) {
          this.error(`${file.fileName}: <script src> is not allowed (inline only)`);
        }
        const type = (/\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "").toLowerCase();
        if (type === "text/plain") {
          // a library's data runs as a script of its own: hashed too; any
          // other text/plain block fails (nothing runs unlisted)
          const id = /\sid\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";
          if (!id.startsWith(DATA_ID_PREFIX)) this.error(`${file.fileName}: a text/plain script that is not a library's data block`);
        } else if (!SCRIPT_TYPES.has(type)) {
          // Data blocks such as application/ld+json never execute.
          continue;
        }
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

const onDemand = fastStartup();

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
  plugins: [
    buildVersion(),
    devLibraries,
    katexStandIn,
    viteSingleFile(),
    onDemand,
    noExternalImports,
    thirdPartyNotices({ moreModules: onDemand.lazyModules }),
    contentSecurityPolicy,
  ],
  test: {
    environment: "jsdom",
    root: ".",
    // Agent worktrees under .claude/ hold copies of the tests; skip them.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
