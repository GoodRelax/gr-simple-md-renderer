// Write a release's version, build the release file and print the commands
// the owner runs (M3). The rule -- the forms, where the version is written,
// on which branch and when this runs -- is spec/grsmd_gen2_spec_ja.md
// section 1.7 only.
//
//     node tools/release.mjs
//
// The version is now (UTC, whole seconds). It is written into package.json,
// both places of package-lock.json, the "## [Unreleased]" heading of
// CHANGELOG.md (the one without a date) and the two version lines of
// README.md. Then npm run build:release writes docs/index.html, which is
// copied to output/release/GRSMD.html. Nothing is committed, tagged, pushed
// or uploaded: the tool prints those commands.

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compactOf, isCompact, separatedOf, separatedOfEpochSeconds } from "./version.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const TAG_PREFIX = "Release-";
export const RELEASE_FILE = "output/release/GRSMD.html";

// README's version lines. The Japanese one is written with escapes so this
// file stays ASCII: "\u7248" is the word for version, "\u30bf\u30b0" for tag,
// and \uff08 \uff09 are full-width parentheses.
export const README_POINTER_EN = /^Version rule: .*grsmd_gen2_spec_ja\.md.*1\.7.*$/m;
export const README_POINTER_JA = /^\u7248\u306e\u898f\u5247: .*grsmd_gen2_spec_ja\.md.*1\.7.*$/m;
export const README_VERSION_EN = /^Version `(\d{8}T\d{6}Z)` \(tag `Release-(\d{8}T\d{6}Z)`\)$/m;
export const README_VERSION_JA = /^\u7248 `(\d{8}T\d{6}Z)`\uff08\u30bf\u30b0 `Release-(\d{8}T\d{6}Z)`\uff09$/m;
export const CHANGELOG_VERSION = /^## \[(\d{8}T\d{6}Z)\] - (\d{4}-\d{2}-\d{2})$/m;
export const CHANGELOG_UNRELEASED = /^## \[Unreleased\]$/m;
export const RELEASE_BRANCH = "main";
export const WRITTEN_FILES = ["package.json", "package-lock.json", "CHANGELOG.md", "README.md", "docs/index.html"];
/** What to run when the tool stopped after writing (it never undoes files itself). */
export const RESTORE_HINT = `restore with: git checkout -- ${WRITTEN_FILES.join(" ")}  (then run the tool again)`;

/**
 * A release is made on main only (spec 1.7.4, step 3).
 * @param {string} branch the current branch ("" when detached)
 * @returns {string|null} why not, or null when the branch is right
 * @purity pure
 */
export function checkReleaseBranch(branch) {
  if (branch === RELEASE_BRANCH) return null;
  const name = branch === "" ? "a detached HEAD" : `branch "${branch}"`;
  return `release: run this on ${RELEASE_BRANCH} (after merging develop), not on ${name}`;
}

/**
 * @param {string} version compact form
 * @returns {{en: string, ja: string}}
 * @purity pure
 */
export function readmeVersionLines(version) {
  return {
    en: `Version \`${version}\` (tag \`${TAG_PREFIX}${version}\`)`,
    ja: `\u7248 \`${version}\`\uff08\u30bf\u30b0 \`${TAG_PREFIX}${version}\`\uff09`,
  };
}

/**
 * The newest version heading of CHANGELOG.md, or null before the first release.
 * @param {string} text
 * @returns {{version: string, date: string}|null}
 * @purity pure
 */
export function newestChangelogVersion(text) {
  const m = CHANGELOG_VERSION.exec(text.replace(/\r\n/g, "\n"));
  return m === null ? null : { version: m[1], date: m[2] };
}

/**
 * package.json or package-lock.json with the package's own version set (after
 * "name"; in the lock also in packages[""]).
 * @param {string} text
 * @param {string} version
 * @param {{lock: boolean}} options
 * @returns {string}
 * @purity pure
 */
export function withPackageVersion(text, version, { lock }) {
  const withName = (obj) => {
    const { name, version: _old, ...rest } = obj;
    return { name, version, ...rest };
  };
  const json = withName(JSON.parse(text));
  // the spread keeps "" as the first key; the later "" replaces its value
  if (lock) json.packages = { ...json.packages, "": withName(json.packages[""]) };
  return JSON.stringify(json, null, 2) + "\n";
}

/**
 * CHANGELOG.md with its "## [Unreleased]" heading (no date) turned into the
 * release's heading. The older "[Unreleased] - date" headings stay.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 * @purity pure
 */
export function withChangelogRelease(text, version) {
  if (!CHANGELOG_UNRELEASED.test(text)) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" heading (without a date) to release');
  }
  const date = separatedOf(version).slice(0, 10);
  return text.replace(CHANGELOG_UNRELEASED, `## [${version}] - ${date}`);
}

/**
 * README.md with its two version lines set: replaced if there, else put
 * right after the two version-rule pointers.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 * @purity pure
 */
export function withReadmeVersion(text, version) {
  const lines = readmeVersionLines(version);
  let out = text;
  for (const [line, current, pointer] of [
    [lines.en, README_VERSION_EN, README_POINTER_EN],
    [lines.ja, README_VERSION_JA, README_POINTER_JA],
  ]) {
    if (current.test(out)) out = out.replace(current, () => line);
    else if (pointer.test(out)) out = out.replace(pointer, (found) => `${found}\n\n${line}`);
    else throw new Error(`README.md has no version line and no pointer for ${pointer}`);
  }
  return out;
}

/**
 * Keep the file's own line ends (the working copy may use CR LF).
 * @purity non-pure
 */
function rewrite(file, change) {
  const path = join(ROOT, file);
  const raw = readFileSync(path, "utf8");
  const crlf = raw.includes("\r\n");
  const next = change(raw.replace(/\r\n/g, "\n"));
  writeFileSync(path, crlf ? next.replace(/\n/g, "\r\n") : next);
}

/** @purity non-pure */
function main() {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim();
  const wrongBranch = checkReleaseBranch(branch);
  if (wrongBranch !== null) {
    process.stderr.write(`${wrongBranch}\n`);
    return 1;
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty !== "") {
    process.stderr.write("release: the working tree has changes; commit or remove them first\n");
    return 1;
  }
  const version = compactOf(separatedOfEpochSeconds(Math.floor(Date.now() / 1000)));
  if (!isCompact(version)) throw new Error(`bad version ${version}`);
  const newest = newestChangelogVersion(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
  if (newest !== null && newest.version >= version) {
    process.stderr.write(`release: CHANGELOG.md already names ${newest.version}, not older than ${version}\n`);
    return 1;
  }

  try {
    rewrite("CHANGELOG.md", (text) => withChangelogRelease(text, version));
    rewrite("README.md", (text) => withReadmeVersion(text, version));
    rewrite("package.json", (text) => withPackageVersion(text, version, { lock: false }));
    rewrite("package-lock.json", (text) => withPackageVersion(text, version, { lock: true }));
    execSync("npm run build:release", { cwd: ROOT, stdio: "inherit" });
  } catch (error) {
    process.stderr.write(`release: ${error.message}\n${RESTORE_HINT}\n`);
    return 1;
  }
  const built = readFileSync(join(ROOT, "docs/index.html"), "utf8");
  if (built.includes("Development build") || !built.includes(`>${separatedOf(version)}</time>`)) {
    process.stderr.write(`release: docs/index.html does not carry the release version\n${RESTORE_HINT}\n`);
    return 1;
  }
  mkdirSync(join(ROOT, dirname(RELEASE_FILE)), { recursive: true });
  copyFileSync(join(ROOT, "docs/index.html"), join(ROOT, RELEASE_FILE));

  const tag = `${TAG_PREFIX}${version}`;
  process.stdout.write(
    [
      "",
      `version   ${version} (${separatedOf(version)})`,
      `tag       ${tag}`,
      `file      ${RELEASE_FILE}`,
      `written   ${WRITTEN_FILES.join(", ")}`,
      "",
      "The owner runs (spec 1.7):",
      `  git add ${WRITTEN_FILES.join(" ")}`,
      `  git commit -m "Release ${version}"`,
      "  git push origin main",
      `  git tag ${tag}`,
      `  git push origin ${tag}`,
      `  gh release create ${tag} ${RELEASE_FILE} --title "${tag}" --notes "See CHANGELOG.md"`,
      "  git switch develop && git merge main && git push origin develop",
      "",
    ].join("\n"),
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
