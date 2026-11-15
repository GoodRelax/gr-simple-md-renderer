import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Why: staticChecks.test.js and purityTags.test.js keep their own listJs; each moves to this walker when a diff touches it (review standard 1.2).

/**
 * @param {string} dir the directory to walk
 * @param {RegExp} pattern the file names to keep
 * @returns {string[]} the absolute paths of the matching files below dir, without node_modules
 */
export function listFiles(dir, pattern) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : listFiles(full, pattern);
    return pattern.test(name) ? [full] : [];
  });
}
