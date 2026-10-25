// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import viteConfig, { scriptElementsOf } from "../../vite.config.js";
import {
  BETA_FILE,
  BETA_ROBOTS,
  PRODUCTION_ROBOTS,
  betaHtmlOf,
  differingLines,
  main,
  writeBeta,
} from "../../tools/buildBeta.mjs";

// AT-BETA-01..08: the beta build (INV-82, spec 5.18). The beta is the output
// of the production build with only its robots meta set to "noindex", written
// as docs/grsmd-beta.html by tools/buildBeta.mjs; docs/index.html is never
// touched (owner's decision 2026-10-25, ruling 2026-10-26: no BETA mark, the
// help unchanged).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

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

const cspOf = (html) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];

/**
 * Run an npm script of package.json the way npm would, but with every path
 * moved under `into` (nothing is written to docs/ or output/ of the
 * checkout): "vite build [--mode m] [--outDir d] [--emptyOutDir]" and
 * "node tools/buildBeta.mjs a b", joined by "&&". `plugins` go into every vite
 * build. Any other command fails the test.
 */
async function runScript(name, into, plugins = []) {
  for (const command of pkg.scripts[name].split("&&").map((part) => part.trim().split(/\s+/))) {
    if (command[0] === "vite" && command[1] === "build") {
      const option = (flag) => (command.includes(flag) ? command[command.indexOf(flag) + 1] : undefined);
      // --outDir is relative to the config's root (src); the default is ../docs
      const outDir = join(into, (option("--outDir") ?? "../docs").replace(/^\.\.\//, ""));
      await build({
        configFile: join(root, "vite.config.js"),
        logLevel: "silent",
        mode: option("--mode"),
        plugins,
        build: { outDir, emptyOutDir: command.includes("--emptyOutDir") },
      });
    } else if (command[0] === "node" && command[1] === "tools/buildBeta.mjs" && command.length === 4) {
      mkdirSync(dirname(join(into, command[3])), { recursive: true });
      writeBeta(join(into, command[2]), join(into, command[3]));
    } else {
      throw new Error(`unknown command in "${name}": ${command.join(" ")}`);
    }
  }
}

describe("AT-BETA-01 the beta changes the robots meta only", () => {
  it("replaces index, follow with noindex and leaves every other byte", () => {
    const beta = betaHtmlOf(PAGE);
    expect(beta).toBe(PAGE.replace(PRODUCTION_ROBOTS, BETA_ROBOTS));
    expect(BETA_ROBOTS).toBe('<meta name="robots" content="noindex" />');
    expect(differingLines(PAGE, beta)).toEqual([PAGE.split("\n").indexOf(PRODUCTION_ROBOTS)]);
  });

  it("keeps the scripts (so the CSP) the same", () => {
    expect(scriptElementsOf(betaHtmlOf(PAGE))).toEqual(scriptElementsOf(PAGE));
  });

  it("differingLines counts every line of a text with another line count", () => {
    expect(differingLines("a\nb", "a\nb")).toEqual([]);
    expect(differingLines("a\nb", "a\nc")).toEqual([1]);
    expect(differingLines("a", "a\nb")).toEqual([0, 1]);
  });
});

describe("AT-BETA-02 a page without exactly one production robots meta fails", () => {
  it("fails with none, two, or another robots meta", () => {
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, ""))).toThrow(/exactly one robots meta, found 0/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, PRODUCTION_ROBOTS + PRODUCTION_ROBOTS))).toThrow(/found 2/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, PRODUCTION_ROBOTS + BETA_ROBOTS))).toThrow(/found 2/);
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, '<meta name="robots" content="index" />'))).toThrow(
      /must be <meta name="robots" content="index, follow" \/>, found <meta name="robots" content="index" \/>/,
    );
  });

  it("(review L1) counts a robots meta whatever the order, case or quotes of its attributes", () => {
    const second = [
      '<meta content="index, follow" name="robots" />',
      '<META NAME="ROBOTS" CONTENT="index, follow">',
      "<meta content='noindex' name='robots'>",
      "<meta name=robots content=noindex>",
    ];
    for (const extra of second) {
      expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, PRODUCTION_ROBOTS + "\n" + extra)), extra).toThrow(/found 2/);
    }
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, '<meta name="robotsx" content="x" />'))).toThrow(/found 0/);
  });

  it("fails when the robots meta shares its line with other text", () => {
    expect(() => betaHtmlOf(PAGE.replace(PRODUCTION_ROBOTS, `<meta name="author" content="a" />${PRODUCTION_ROBOTS}`))).toThrow(
      /robots meta line only/,
    );
  });

  it("fails when the only robots meta is inside a script (the CSP would differ)", () => {
    const withoutRobots = PAGE.replace(PRODUCTION_ROBOTS + "\n", "");
    // on its own line inside the script, and on the script's line
    const ownLine = withoutRobots.replace("run()", `\n${PRODUCTION_ROBOTS}\nrun()`);
    expect(() => betaHtmlOf(ownLine)).toThrow(/must not change a script/);
    const scriptLine = withoutRobots.replace("run()", `run('${PRODUCTION_ROBOTS}')`);
    expect(() => betaHtmlOf(scriptLine)).toThrow(/robots meta line only/);
  });
});

describe("AT-BETA-03 (review M1) the beta is never built on its own", () => {
  it("build:beta is the production build into output/beta, then tools/buildBeta.mjs", () => {
    expect(pkg.scripts.build).toBe("vite build");
    expect(pkg.scripts["build:beta"]).toBe(
      "vite build --outDir ../output/beta --emptyOutDir && node tools/buildBeta.mjs output/beta/index.html docs/grsmd-beta.html",
    );
    expect(pkg.scripts["build:e2e"]).toBe(
      "vite build --outDir ../output/e2e --emptyOutDir && node tools/buildBeta.mjs output/e2e/index.html output/e2e/grsmd-beta.html",
    );
  });

  it("no script builds in a mode of its own but release; vite.config.js has no beta plugin", () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      const modes = [...script.matchAll(/--mode\s+(\S+)/g)].map((m) => m[1]);
      expect(modes, name).toEqual(name === "build:release" ? ["release"] : []);
    }
    expect(viteConfig.plugins.map((plugin) => plugin.name).filter((n) => /beta/i.test(n))).toEqual([]);
  });
});

describe("AT-BETA-04 writeBeta writes grsmd-beta.html from the production file", () => {
  it("reads the production file, leaves it, and writes the beta", () => {
    const dir = mkdtempSync(join(tmpdir(), "grsmd-beta-tool-"));
    try {
      writeFileSync(join(dir, "index.html"), PAGE);
      writeBeta(join(dir, "index.html"), join(dir, BETA_FILE));
      expect(BETA_FILE).toBe("grsmd-beta.html");
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(PAGE);
      expect(readFileSync(join(dir, BETA_FILE), "utf8")).toBe(betaHtmlOf(PAGE));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses another file name or the production file itself, and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "grsmd-beta-tool-"));
    try {
      writeFileSync(join(dir, "index.html"), PAGE);
      expect(() => writeBeta(join(dir, "index.html"), join(dir, "index.html"))).toThrow(/must be written as grsmd-beta\.html/);
      expect(() => writeBeta(join(dir, "index.html"), join(dir, "beta.html"))).toThrow(/must be written as grsmd-beta\.html/);
      expect(() => writeBeta(join(dir, BETA_FILE), join(dir, BETA_FILE))).toThrow(/must not overwrite/);
      expect(readdirSync(dir)).toEqual(["index.html"]);
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(PAGE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AT-BETA-05 the command line", () => {
  it("needs two paths; a failure is exit code 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "grsmd-beta-tool-"));
    const stderr = process.stderr.write;
    const stdout = process.stdout.write;
    process.stderr.write = () => true;
    process.stdout.write = () => true;
    try {
      writeFileSync(join(dir, "index.html"), PAGE.replace(PRODUCTION_ROBOTS, ""));
      expect(main([])).toBe(1);
      expect(main([join(dir, "index.html")])).toBe(1);
      expect(main([join(dir, "index.html"), join(dir, BETA_FILE)])).toBe(1);
      expect(readdirSync(dir)).toEqual(["index.html"]);
      writeFileSync(join(dir, "index.html"), PAGE);
      expect(main([join(dir, "index.html"), join(dir, BETA_FILE)])).toBe(0);
      expect(readFileSync(join(dir, BETA_FILE), "utf8")).toBe(betaHtmlOf(PAGE));
    } finally {
      process.stderr.write = stderr;
      process.stdout.write = stdout;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AT-BETA-06 / AT-BETA-07 the real builds of npm run build and npm run build:beta", () => {
  let production;
  let docsFiles;
  let beta;
  let sentinelAfterBeta;
  const sentinelWritten = "<!-- docs/index.html of production -->\n";
  beforeAll(async () => {
    const productionDir = mkdtempSync(join(tmpdir(), "grsmd-prod-"));
    const betaDir = mkdtempSync(join(tmpdir(), "grsmd-beta-"));
    // docs/index.html of the beta's checkout: npm run build:beta must leave it
    mkdirSync(join(betaDir, "docs"));
    writeFileSync(join(betaDir, "docs", "index.html"), sentinelWritten);
    try {
      await runScript("build", productionDir);
      production = readFileSync(join(productionDir, "docs", "index.html"), "utf8");
      await runScript("build:beta", betaDir);
      docsFiles = readdirSync(join(betaDir, "docs")).sort();
      beta = readFileSync(join(betaDir, "docs", BETA_FILE), "utf8");
      sentinelAfterBeta = readFileSync(join(betaDir, "docs", "index.html"), "utf8");
    } finally {
      rmSync(productionDir, { recursive: true, force: true });
      rmSync(betaDir, { recursive: true, force: true });
    }
  }, 300_000);

  it("AT-BETA-06 build:beta writes only docs/grsmd-beta.html; docs/index.html stays byte for byte", () => {
    expect(docsFiles).toEqual([BETA_FILE, "index.html"]);
    expect(sentinelAfterBeta).toBe(sentinelWritten);
  });

  it("AT-BETA-07 the beta is the production file with noindex: same CSP, same scripts, same help", () => {
    expect(production).toContain(PRODUCTION_ROBOTS);
    expect(production).not.toContain("noindex");
    expect(beta).toBe(betaHtmlOf(production));
    expect(cspOf(beta)).toBe(cspOf(production));
    expect(cspOf(beta)).not.toContain("unsafe-eval");
    expect(cspOf(beta)).toMatch(/script-src 'sha256-[^;]*;/);
    expect(beta).toContain('data-build-kind="dev">Development build</span>');
    expect(beta).not.toMatch(/\bBETA\b/);
  });
});

describe("AT-BETA-08 (review M1) code that depends on the build's mode still gives the beta production's scripts", () => {
  // The review's reproduction: the core reads import.meta.env.MODE, which a
  // build in a mode of its own would change.
  const readsMode = {
    name: "test-reads-mode",
    enforce: "pre",
    transform(code, id) {
      return /[\\/]src[\\/]js[\\/]main\.js$/.test(id) ? `${code}\nglobalThis.__grsmdTestMode = import.meta.env.MODE;\n` : null;
    },
  };
  let production;
  let beta;
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "grsmd-mode-"));
    try {
      await runScript("build", join(dir, "production"), [readsMode]);
      production = readFileSync(join(dir, "production", "docs", "index.html"), "utf8");
      await runScript("build:beta", join(dir, "beta"), [readsMode]);
      beta = readFileSync(join(dir, "beta", "docs", BETA_FILE), "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("has the same mode, scripts and CSP as production", () => {
    // the minifier may write the string with backquotes
    expect(production).toMatch(/__grsmdTestMode\s*=\s*(["'`])production\1/);
    expect(beta).toMatch(/__grsmdTestMode\s*=\s*(["'`])production\1/);
    expect(scriptElementsOf(beta)).toEqual(scriptElementsOf(production));
    expect(cspOf(beta)).toBe(cspOf(production));
    expect(beta).toBe(betaHtmlOf(production));
  });
});
