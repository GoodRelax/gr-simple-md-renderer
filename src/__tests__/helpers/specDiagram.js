import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Spec 11-b: a state diagram shows every transition of its table (all cells
// that are not "-"). These helpers read the Mermaid diagram of a section of
// spec/grsmd_gen2_spec_ja.md and list the transitions of a table definition
// in the same form, so a test can compare the two.

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(here, "../../../spec/grsmd_gen2_spec_ja.md");

/**
 * Transitions of the first Mermaid diagram after the line that starts with
 * the bold section title (e.g. "**11-d "). Lines from [*] (the start) are
 * left out: they are not cells of the table. Any other line that is not a
 * transition throws, so a malformed line cannot slip through.
 * @param {string} title - e.g. "11-d"
 * @returns {string[]} "from --> to : event [if guard]" sorted
 */
export function diagramTransitions(title) {
  const text = readFileSync(SPEC, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`\n**${title} `);
  if (start < 0) throw new Error(`No section ${title} in the spec`);
  const open = text.indexOf("```mermaid\n", start);
  const close = text.indexOf("\n```", open + 1);
  const lines = text.slice(open, close).split("\n").slice(1);
  if (lines.shift()?.trim() !== "stateDiagram-v2") throw new Error(`The ${title} diagram is not a stateDiagram-v2`);
  const out = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = /^\s*(\S+) --> (\S+) : (\w+)(?: (if .+|else))?\s*$/.exec(line);
    if (!m) throw new Error(`Unparsed line in the ${title} diagram: ${line}`);
    if (m[1] === "[*]") continue;
    out.push(`${m[1]} --> ${m[2]} : ${m[3]}${m[4] ? ` ${m[4]}` : ""}`);
  }
  return out.sort();
}

/**
 * The same form for a table definition (event -> state -> cell, choice or null).
 * A guard "a&&b" is written "if a and b"; an alternative without a guard
 * after guarded ones is "else".
 * @param {object} machine
 * @returns {string[]}
 */
export function tableTransitions(machine) {
  const out = [];
  for (const [event, byState] of Object.entries(machine)) {
    for (const [state, entry] of Object.entries(byState)) {
      if (!entry) continue;
      const alternatives = Array.isArray(entry) ? entry : [entry];
      for (const alt of alternatives) {
        let guard = "";
        if (alt.guard) guard = ` if ${alt.guard.split("&&").join(" and ")}`;
        else if (alternatives.length > 1) guard = " else";
        out.push(`${state} --> ${alt.to} : ${event}${guard}`);
      }
    }
  }
  return out.sort();
}
