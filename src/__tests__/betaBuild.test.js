// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  BETA_FILE,
  BETA_MODE,
  BETA_ROBOTS,
  PRODUCTION_ROBOTS,
  betaChannel,
  betaHtmlOf,
  scriptElementsOf,
} from "../../vite.config.js";

// AT-BETA-01..07: the beta build (INV-82). The beta is the production file
// with only its robots meta set to "noindex", written as docs/grsmd-beta.html;
// docs/index.html is never touched (owner's decision 2026-10-25, ruling
// 2026-10-26: no BETA mark, the help unchanged).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PAGE = [
  "<!doctype html>",
  "<html><head>",
  '<meta charset="UTF-8" />',
  '<meta http-equiv="Content-Security-Policy" content="script-src \'sha256-x\'" />',
  PRODUCTION_ROBOTS,
  "</head><body>",
  "<script>run()</script>",
  '<script type="text/plain" id="grsmd-lib-katex">data()</script>',
  "</body></html>",
].join("\n");

// A stand-in for the bundle and the plugin context of generateBundle.
function runPlugin(bundle) {
  const emitted = [];
  const context = {
    error(message) {
      throw new Error(message);
    },
    emitFile(file) {
      emitted.push(file);
    },
  };
  betaChannel.generateBundle.call(context, {}, bundle);
  return emitted;
}

describe("AT-BETA-01 the beta changes the robots meta only", () => {
  it("replaces index, follow with noindex and leaves every other byte", () => {
    const beta = betaHtmlOf(PAGE);
    expect(beta).toBe(PAGE.replace(PRODUCTION_ROBOTS, BETA_ROBOTS));
    expect(BETA_ROBOTS).toBe('<meta name="robots" content="noindex" />');
    expect(beta).not.toContain("index, follow");
  });

  it("keeps the scripts (so the CSP) the same", () => {
    expect(scriptElementsOf(betaHtmlOf(PAGE))).toEqual(scriptElementsOf(PAGE));
  });
});

describe("AT-BETA-02 a page without exactly one production robots meta fails", () => {
  it("fails with none, two, or another robots meta", () => {
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, ""))).toThrow(/exactly one/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, PRODUCTION_ROBOTS + PRODUCTION_ROBOTS))).toThrow(/exactly one/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, '<meta name="robots" content="index" />'))).toThrow(/exactly one/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, PRODUCTION_ROBOTS + BETA_ROBOTS))).toThrow(/exactly one/);
  });

  it("fails when the only robots meta is inside a script (the CSP would differ)", () => {
    const inScript = PAGE.replace(PRODUCTION_ROBOTS, "").replace("run()", `run('${PRODUCTION_ROBOTS}')`);
    expect(() => betaHtmlOf(inScript)).toThrow(/must not change a script/);
  });
});

describe("AT-BETA-03 the plugin runs only in a build of mode beta", () => {
  it("is applied to vite build --mode beta and nothing else", () => {
    expect(BETA_MODE).toBe("beta");
    expect(betaChannel.apply({}, { command: "build", mode: "beta" })).toBe(true);
    for (const mode of ["production", "release", "development"]) {
      expect(betaChannel.apply({}, { command: "build", mode }), mode).toBe(false);
    }
    expect(betaChannel.apply({}, { command: "serve", mode: "beta" })).toBe(false);
  });
});

describe("AT-BETA-04 the plugin writes grsmd-beta.html instead of index.html", () => {
  it("drops index.html from the bundle and emits the beta page", () => {
    const bundle = { "index.html": { type: "asset", fileName: "index.html", source: PAGE } };
    const emitted = runPlugin(bundle);
    expect(BETA_FILE).toBe("grsmd-beta.html");
    expect(Object.keys(bundle)).toEqual([]);
    expect(emitted).toEqual([{ type: "asset", fileName: BETA_FILE, source: betaHtmlOf(PAGE) }]);
  });

  it("fails without exactly one HTML file named index.html", () => {
    expect(() => runPlugin({})).toThrow(/expects one index\.html/);
    expect(() => runPlugin({ "other.html": { type: "asset", fileName: "other.html", source: PAGE } })).toThrow(
      /expects one index\.html/,
    );
    expect(() =>
      runPlugin({
        "index.html": { type: "asset", fileName: "index.html", source: PAGE },
        "other.html": { type: "asset", fileName: "other.html", source: PAGE },
      }),
    ).toThrow(/expects one index\.html/);
    expect(() => runPlugin({ "index.html": { type: "asset", fileName: "index.html", source: "<html></html>" } })).toThrow(
      /index\.html: the beta needs exactly one/,
    );
  });
});

describe("AT-BETA-05 the scripts", () => {
  it("build:beta is a vite build of mode beta; build:e2e also builds the beta next to index.html", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts["build:beta"]).toBe("vite build --mode beta");
    expect(pkg.scripts["build:e2e"]).toBe(
      "vite build --outDir ../output/e2e --emptyOutDir && vite build --mode beta --outDir ../output/e2e",
    );
  });
});

describe("AT-BETA-06 / AT-BETA-07 the real builds", () => {
  let production;
  let betaDir;
  let betaFiles;
  let beta;
  let sentinel;
  beforeAll(async () => {
    const productionDir = mkdtempSync(join(tmpdir(), "grsmd-prod-"));
    betaDir = mkdtempSync(join(tmpdir(), "grsmd-beta-"));
    // stands for docs/index.html: the beta build must leave it as it is
    sentinel = "<!-- docs/index.html of production -->\n";
    writeFileSync(join(betaDir, "index.html"), sentinel);
    try {
      await build({
        configFile: join(root, "vite.config.js"),
        logLevel: "silent",
        build: { outDir: productionDir, emptyOutDir: true },
      });
      production = readFileSync(join(productionDir, "index.html"), "utf8");
      await build({
        configFile: join(root, "vite.config.js"),
        logLevel: "silent",
        mode: BETA_MODE,
        build: { outDir: betaDir },
      });
      betaFiles = readdirSync(betaDir).sort();
      beta = readFileSync(join(betaDir, BETA_FILE), "utf8");
      sentinel = [sentinel, readFileSync(join(betaDir, "index.html"), "utf8")];
    } finally {
      rmSync(productionDir, { recursive: true, force: true });
      rmSync(betaDir, { recursive: true, force: true });
    }
  }, 300_000);

  it("AT-BETA-06 the beta build writes only grsmd-beta.html; index.html stays byte for byte", () => {
    expect(betaFiles).toEqual([BETA_FILE, "index.html"]);
    expect(sentinel[1]).toBe(sentinel[0]);
  });

  it("AT-BETA-07 the beta is the production file with noindex: same CSP, same scripts, same help", () => {
    expect(production).toContain(PRODUCTION_ROBOTS);
    expect(production).not.toContain("noindex");
    expect(beta).toBe(betaHtmlOf(production));
    const csp = (html) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
    expect(csp(beta)).toBe(csp(production));
    expect(csp(beta)).not.toContain("unsafe-eval");
    expect(csp(beta)).toMatch(/script-src 'sha256-[^;]*;/);
    expect(beta).toContain('data-build-kind="dev">Development build</span>');
    expect(beta).not.toMatch(/\bBETA\b/);
  });
});
