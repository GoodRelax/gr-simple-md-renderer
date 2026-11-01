// Make the beta file from a production build (INV-82; the rule is
// spec/grsmd_gen2_spec_ja.md section 5.18).
//
//     node tools/buildBeta.mjs <production index.html> <.../grsmd-beta.html>
//
// npm run build:beta builds production (the same vite build as npm run build,
// mode "production") into output/beta/, then runs this tool, which writes
// docs/grsmd-beta.html: that file with only its robots meta set to "noindex"
// (owner's decision 2026-10-25; no BETA mark and the same help, owner's ruling
// 2026-10-26). The beta is never built on its own, so its scripts and CSP are
// those of production by construction; docs/index.html is never written.

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scriptElementsOf } from "../vite.config.js";

export const BETA_FILE = "grsmd-beta.html";
export const PRODUCTION_ROBOTS = '<meta name="robots" content="index, follow" />';
export const BETA_ROBOTS = '<meta name="robots" content="noindex" />';
// Any robots meta, whatever the order, case or quotes of its attributes.
const ROBOTS_META = /<meta\b[^>]*\bname\s*=\s*["']?robots(?=["'\s/>])[^>]*>/gi;

/**
 * The numbers (from 0) of the lines that differ; two texts of different line
 * counts differ in every line of the longer one.
 * @param {string} a
 * @param {string} b
 * @returns {number[]}
 * @purity pure
 */
export function differingLines(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  const count = Math.max(left.length, right.length);
  const lines = [];
  for (let i = 0; i < count; i++) {
    if (left.length !== right.length || left[i] !== right[i]) lines.push(i);
  }
  return lines;
}

/**
 * The beta of a production file: its one robots meta set to "noindex". Throws
 * unless the file has exactly one robots meta, the production one, and the
 * beta differs from it in that one line only, outside every script.
 * @param {string} html  the production file
 * @returns {string}  the beta file
 * @purity pure
 */
export function betaHtmlOf(html) {
  const robots = html.match(ROBOTS_META) ?? [];
  if (robots.length !== 1) {
    throw new Error(`the beta needs exactly one robots meta, found ${robots.length}: ${robots.join(" ")}`);
  }
  if (robots[0] !== PRODUCTION_ROBOTS) {
    throw new Error(`the robots meta must be ${PRODUCTION_ROBOTS}, found ${robots[0]}`);
  }
  const beta = html.replace(PRODUCTION_ROBOTS, () => BETA_ROBOTS);
  const changed = differingLines(html, beta);
  if (changed.length !== 1 || beta.split("\n")[changed[0]].trim() !== BETA_ROBOTS) {
    throw new Error(`the beta must differ in the robots meta line only, lines ${changed.map((i) => i + 1).join(", ")} differ`);
  }
  if (JSON.stringify(scriptElementsOf(beta)) !== JSON.stringify(scriptElementsOf(html))) {
    throw new Error("the beta must not change a script (the CSP would differ)");
  }
  return beta;
}

/**
 * Read the production file and write its beta.
 * @param {string} productionPath
 * @param {string} betaPath  must be named grsmd-beta.html
 * @purity non-pure
 */
export function writeBeta(productionPath, betaPath) {
  if (basename(betaPath) !== BETA_FILE) throw new Error(`the beta must be written as ${BETA_FILE}, not ${betaPath}`);
  if (resolve(productionPath) === resolve(betaPath)) throw new Error("the beta must not overwrite the production file");
  writeFileSync(betaPath, betaHtmlOf(readFileSync(productionPath, "utf8")));
}

/**
 * @param {string[]} args  [production index.html, beta file]
 * @returns {number}  the exit code
 * @purity non-pure
 */
export function main(args) {
  if (args.length !== 2) {
    process.stderr.write(`usage: node tools/buildBeta.mjs <production index.html> <.../${BETA_FILE}>\n`);
    return 1;
  }
  try {
    writeBeta(args[0], args[1]);
  } catch (error) {
    process.stderr.write(`build-beta: ${error.message}\n`);
    return 1;
  }
  process.stdout.write(`build-beta: wrote ${args[1]} from ${args[0]}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
