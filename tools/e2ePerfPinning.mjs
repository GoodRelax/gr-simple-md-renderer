// Spec: INV-86 (performance).
// Why: apart from tools/e2ePerf.mjs, which runs the tests as soon as it is read

// Section: pure

/**
 * @purity pure
 * @param {string} text - lines of "logical processor,efficiency class"
 * @returns {{index: number, efficiencyClass: number}[]}
 */
export function cpuSetsFromText(text) {
  return [...text.matchAll(/^(\d+),(\d+)\s*$/gm)].map((match) => ({ index: Number(match[1]), efficiencyClass: Number(match[2]) }));
}

/**
 * @purity pure
 * @param {{index: number, efficiencyClass: number}[]} cpuSets
 * @returns {string|null} the hexadecimal mask of the most performant class; null: fewer than two classes
 */
export function performanceCoreMask(cpuSets) {
  const classes = new Set(cpuSets.map(({ efficiencyClass }) => efficiencyClass));
  if (classes.size < 2) return null;
  const top = Math.max(...classes);
  const bits = cpuSets.filter(({ efficiencyClass }) => efficiencyClass === top).map(({ index }) => 1n << BigInt(index));
  return bits.reduce((mask, bit) => mask | bit, 0n).toString(16).toUpperCase();
}

/**
 * Spec: INV-86 (performance).
 * @purity pure
 * @param {string|null} mask - performanceCoreMask
 * @param {boolean} isPinned - the affinity was set
 * @param {number} cpuSetCount - the logical processors read
 * @param {string} platform - process.platform
 * @returns {string} the line that says whether the run is pinned
 */
export function pinningReport(mask, isPinned, cpuSetCount, platform) {
  if (isPinned) return `e2ePerf: pinned to the P cores (affinity ${mask})`;
  if (mask !== null) return `e2ePerf: not pinned: the affinity ${mask} could not be set`;
  if (platform !== "win32") return `e2ePerf: not pinned: no way to pin on ${platform}`;
  return cpuSetCount === 0 ? "e2ePerf: not pinned: the CPU sets could not be read" : "e2ePerf: not pinned: this machine has one kind of core";
}
