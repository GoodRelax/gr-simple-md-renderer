// Helpers for the state transition tables kept as data (spec 3.3: 11-c,
// 11-d, 11-e). Pure: they only build frozen values.

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
