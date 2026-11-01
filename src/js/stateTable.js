// Helpers for the state transition tables kept as data (spec 3.3: 11-c,
// 11-d, 11-e, 11-f, 11-g). Pure: they only build frozen values.

/**
 * One cell of a transition table.
 * @purity pure
 * @param {string} to - next state
 * @param {string[]} actions
 * @param {string} [guard]
 * @returns {Readonly<{to: string, actions: ReadonlyArray<string>, guard?: string}>}
 */
export function cell(to, actions, guard) {
  const transition = { to, actions: Object.freeze(actions) };
  if (guard) transition.guard = guard;
  return Object.freeze(transition);
}

/**
 * One row of a table: the cell for each current state, in the order of
 * states (null = no change).
 * @purity pure
 * @param {string[]} states
 * @param {Array<object|null>} cells
 * @returns {Readonly<object>}
 */
export function row(states, cells) {
  const byState = {};
  for (let index = 0; index < states.length; index++) byState[states[index]] = cells[index] ?? null;
  return Object.freeze(byState);
}

/**
 * Guarded alternatives of one cell, tried in order (spec 11-b: guards are
 * evaluated top to bottom). The last one may have no guard ("else").
 * @purity pure
 * @param {...object} cells - made with cell()
 * @returns {ReadonlyArray<object>}
 */
export function choice(...cells) {
  return Object.freeze(cells);
}

/**
 * The transition a table entry takes: the first alternative whose guard is
 * true (an alternative without a guard always matches), or null.
 * @purity pure
 * @param {object|ReadonlyArray<object>|null} entry - a cell, a choice() or null
 * @param {(guard: string) => boolean} isGuardTrue
 * @returns {object|null}
 */
export function selectCell(entry, isGuardTrue) {
  if (!entry) return null;
  const alternatives = Array.isArray(entry) ? entry : [entry];
  return alternatives.find((c) => !c.guard || isGuardTrue(c.guard)) ?? null;
}
