import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  compactOf,
  isCompact,
  separatedOf,
  separatedOfEpochSeconds,
  stampBuildVersion,
} from "../../tools/version.mjs";
import {
  checkReleaseBranch,
  RESTORE_HINT,
  WRITTEN_FILES,
  newestChangelogVersion,
  withChangelogRelease,
  withPackageVersion,
  withReadmeVersion,
  README_VERSION_EN,
  README_VERSION_JA,
} from "../../tools/release.mjs";
import { buildVersionOf } from "../../vite.config.js";

// AT-VER-01..05: the version rule (spec 1.7) kept by machines (M1, M2, M3).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n");

/**
 * Every place that names the version, and the problems found: all must name
 * the same compact version, or (before the first release) none may name one.
 */
function checkVersions({ pkg, lock, changelog, readme }) {
  const pkgJson = JSON.parse(pkg);
  const lockJson = JSON.parse(lock);
  const heading = newestChangelogVersion(changelog);
  const places = {
    "package.json": pkgJson.version,
    "package-lock.json version": lockJson.version,
    'package-lock.json packages[""].version': lockJson.packages[""].version,
    "CHANGELOG.md newest heading": heading?.version,
    "README.md (en)": README_VERSION_EN.exec(readme)?.[1],
    "README.md (en) tag": README_VERSION_EN.exec(readme)?.[2],
    "README.md (ja)": README_VERSION_JA.exec(readme)?.[1],
    "README.md (ja) tag": README_VERSION_JA.exec(readme)?.[2],
  };
  const named = Object.entries(places).filter(([, v]) => v !== undefined);
  if (named.length === 0) return { version: null, problems: [] }; // before the first release
  const problems = [];
  const version = places["package.json"];
  for (const [place, value] of Object.entries(places)) {
    if (value !== version) problems.push(`${place}: ${value} (package.json: ${version})`);
  }
  if (version !== undefined && !isCompact(version)) problems.push(`not the compact form: ${version}`);
  if (heading && isCompact(heading.version) && heading.date !== separatedOf(heading.version).slice(0, 10)) {
    problems.push(`CHANGELOG.md heading date ${heading.date} is not the UTC day of ${heading.version}`);
  }
  return { version, problems };
}

const current = () => ({
  pkg: read("package.json"),
  lock: read("package-lock.json"),
  changelog: read("CHANGELOG.md"),
  readme: read("README.md"),
});

describe("versions (AT-VER)", () => {
  it("AT-VER-01 package.json, package-lock.json (2), CHANGELOG.md's newest version and README.md (2) name the same version, or none does yet", () => {
    const { problems } = checkVersions(current());
    expect(problems).toEqual([]);
  });

  it("AT-VER-01 the check itself: a release written by tools/release.mjs passes; one place left behind fails", () => {
    const v = "20261022T013000Z";
    const texts = current();
    const released = {
      pkg: withPackageVersion(texts.pkg, v, { lock: false }),
      lock: withPackageVersion(texts.lock, v, { lock: true }),
      changelog: withChangelogRelease(texts.changelog, v),
      readme: withReadmeVersion(texts.readme, v),
    };
    expect(checkVersions(released)).toEqual({ version: v, problems: [] });
    expect(released.changelog).toContain(`## [${v}] - 2026-10-22`);
    // the next release replaces the README lines instead of adding more
    const next = "20261101T000000Z";
    const again = withReadmeVersion(released.readme, next);
    expect(again.match(/^Version `/gm)).toHaveLength(1);
    expect(checkVersions({ ...released, readme: again }).problems).toHaveLength(4);
    expect(checkVersions({ ...released, lock: texts.lock }).problems).toHaveLength(2);
    const wrongDay = released.changelog.replace(`## [${v}] - 2026-10-22`, `## [${v}] - 2026-10-21`);
    expect(checkVersions({ ...released, changelog: wrongDay }).problems).toEqual([
      `CHANGELOG.md heading date 2026-10-21 is not the UTC day of ${v}`,
    ]);
  });

  it("AT-VER-01 tools/release.mjs keeps the files' shape: name first, then version; the lock's packages keep their order", () => {
    const v = "20261022T013000Z";
    const pkg = JSON.parse(withPackageVersion(read("package.json"), v, { lock: false }));
    expect(Object.keys(pkg).slice(0, 2)).toEqual(["name", "version"]);
    const lockBefore = JSON.parse(read("package-lock.json"));
    const lock = JSON.parse(withPackageVersion(read("package-lock.json"), v, { lock: true }));
    expect(Object.keys(lock).slice(0, 2)).toEqual(["name", "version"]);
    expect(Object.keys(lock.packages)).toEqual(Object.keys(lockBefore.packages));
    expect(lock.packages[""]).toEqual({ ...lockBefore.packages[""], version: v });
    expect(() => withChangelogRelease("# Changelog\n\n## [Unreleased] - 2026-10-10\n", v)).toThrow(/Unreleased/);
  });

  it("AT-VER-02 the build writes the version into the help's two slots and fails on a wrong help", () => {
    const html = read("src/index.html");
    const dev = stampBuildVersion(html, { kind: "dev", instant: "2026-10-23T04:00:00Z" });
    expect(dev).toContain('<span data-build-kind="dev">Development build</span>');
    expect(dev).not.toContain('data-build-kind="release"');
    expect(dev.match(/<time datetime="2026-10-23T04:00:00Z">2026-10-23T04:00:00Z<\/time>/g)).toHaveLength(2);
    const rel = stampBuildVersion(html, { kind: "release", instant: "2026-10-22T01:30:00Z" });
    expect(rel).toContain('<span data-build-kind="release">Version</span>');
    expect(rel).not.toContain("Development build");
    expect(rel).not.toContain('data-build-kind="dev"');
    // only the slots change
    expect(rel.replace(/<p class="help-version"[\s\S]*?<\/p>/g, "")).toBe(html.replace(/<p class="help-version"[\s\S]*?<\/p>/g, ""));

    const slot = '<p data-build-version><span data-build-kind="release">V</span><span data-build-kind="dev">D</span> <time></time></p>';
    const build = { kind: "dev", instant: "2026-10-23T04:00:00Z" };
    expect(() => stampBuildVersion(slot, build)).toThrow(/2 version slots/);
    expect(() => stampBuildVersion(slot + slot + slot, build)).toThrow(/2 version slots/);
    expect(() => stampBuildVersion("<p>none</p>", build)).toThrow(/found 0/);
    expect(() => stampBuildVersion(slot + slot.replace('<span data-build-kind="dev">D</span>', ""), build)).toThrow(/data-build-kind="dev"/);
    expect(() => stampBuildVersion(slot + slot.replace("<time></time>", "<time>x</time>"), build)).toThrow(/empty <time>/);
    expect(() => stampBuildVersion(slot + slot, { kind: "beta", instant: build.instant })).toThrow(/kind/);
    expect(() => stampBuildVersion(slot + slot, { kind: "dev", instant: "20261023T040000Z" })).toThrow(/separated/);
  });

  it("AT-VER-02 a release build takes package.json's version; any other build, the HEAD commit's time", () => {
    const deps = (version, seconds) => ({ readPackage: () => ({ version }), headEpochSeconds: () => seconds });
    expect(buildVersionOf("release", deps("20261022T013000Z", 0))).toEqual({ kind: "release", instant: "2026-10-22T01:30:00Z" });
    expect(buildVersionOf("production", deps(undefined, 1792728000))).toEqual({ kind: "dev", instant: "2026-10-23T04:00:00Z" });
    expect(buildVersionOf("development", deps("20261022T013000Z", 1792728000)).kind).toBe("dev");
    expect(() => buildVersionOf("release", deps(undefined, 0))).toThrow(/no version/);
    expect(() => buildVersionOf("release", deps("2026.1022.13000", 0))).toThrow(/compact/);
    expect(() => buildVersionOf("production", deps(undefined, NaN))).toThrow(/seconds/);
  });

  it.each([
    ["20261022T013000Z", "2026-10-22T01:30:00Z"],
    ["20240229T235959Z", "2024-02-29T23:59:59Z"],
    ["20270101T000000Z", "2027-01-01T00:00:00Z"],
  ])("AT-VER-03 %s <-> %s", (compact, separated) => {
    expect(separatedOf(compact)).toBe(separated);
    expect(compactOf(separated)).toBe(compact);
    expect(isCompact(compact)).toBe(true);
  });

  it.each(["20261322T013000Z", "20230229T000000Z", "20261022T246000Z", "20261022T013000", "2026-10-22T01:30:00Z", "", "Release-20261022T013000Z"])(
    "AT-VER-03 %j is not a compact version",
    (text) => {
      expect(isCompact(text)).toBe(false);
      expect(() => separatedOf(text)).toThrow();
    },
  );

  it("AT-VER-03 a time in seconds becomes the separated form without a fraction", () => {
    expect(separatedOfEpochSeconds(0)).toBe("1970-01-01T00:00:00Z");
    expect(separatedOfEpochSeconds(1792728000)).toBe("2026-10-23T04:00:00Z");
    expect(() => separatedOfEpochSeconds(1.5)).toThrow();
    expect(() => compactOf("2026-10-22 01:30:00Z")).toThrow();
  });

  it("AT-VER-04 the rule lives in spec 1.7 only: README.md, CHANGELOG.md and the test spec point to it and do not restate the forms", () => {
    const POINTER = /grsmd_gen2_spec_ja\.md[^\n]*1\.7/g;
    const files = {
      "README.md": 2, // English and Japanese
      "CHANGELOG.md": 1,
      "spec/gen2_prerelease_test_spec_ja.md": 1,
    };
    for (const [file, count] of Object.entries(files)) {
      const text = read(file);
      expect((text.match(POINTER) ?? []).length, `${file}: pointers to spec 1.7`).toBe(count);
      for (const form of ["YYYYMMDDTHHMMSSZ", "YYYY-MM-DDTHH:MM:SSZ"]) {
        expect(text.includes(form), `${file} restates ${form}`).toBe(false);
      }
    }
    const spec = read("spec/grsmd_gen2_spec_ja.md");
    const section = /^### 1\.7 [^\n]*\n([\s\S]*?)(?=^## |^### )/m.exec(spec);
    expect(section, "spec 1.7 exists").not.toBeNull();
    for (const form of ["YYYYMMDDTHHMMSSZ", "YYYY-MM-DDTHH:MM:SSZ", "Release-", "build:release", "tools/release.mjs"]) {
      expect(section[1], `spec 1.7 names ${form}`).toContain(form);
    }
    // outside 1.7 the spec does not restate the forms either
    const outside = spec.replace(section[0], "");
    for (const form of ["YYYYMMDDTHHMMSSZ", "YYYY-MM-DDTHH:MM:SSZ"]) {
      expect(outside.includes(form), `spec outside 1.7 restates ${form}`).toBe(false);
    }
  });

  it("AT-VER-05 npm run build:release is a release-mode build", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["build:release"]).toBe("vite build --mode release");
    expect(pkg.scripts.build).toBe("vite build");
  });

  it.each([
    ["main", null],
    ["develop", /on main .*not on branch "develop"/],
    ["feature/help-improve", /not on branch "feature\/help-improve"/],
    ["Main", /not on branch "Main"/],
    ["", /not on a detached HEAD/],
  ])("AT-VER-05 tools/release.mjs runs on main only: %j", (branch, refusal) => {
    const why = checkReleaseBranch(branch);
    if (refusal === null) expect(why).toBeNull();
    else expect(why).toMatch(refusal);
  });

  it("AT-VER-05 when tools/release.mjs stops after writing, it says how to restore every file it writes", () => {
    expect(WRITTEN_FILES).toEqual(["package.json", "package-lock.json", "CHANGELOG.md", "README.md", "docs/index.html"]);
    expect(RESTORE_HINT).toBe(
      "restore with: git checkout -- package.json package-lock.json CHANGELOG.md README.md docs/index.html  (then run the tool again)",
    );
    const source = read("tools/release.mjs");
    // both stops after the files are written print the hint
    expect(source.match(/\$\{RESTORE_HINT\}/g)).toHaveLength(2);
  });
});
