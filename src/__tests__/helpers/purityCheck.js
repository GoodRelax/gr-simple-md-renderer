import { parseAst } from "vite";

// @purity tag checker (CON-15, spec 5.16.2). Test code: no tag of its own.
//
// Counted: methods (constructor, getter, setter included), function declarations
// and expressions, and arrow functions whose body is a block. Not counted:
// arrow functions whose body is a single expression (R7.6 exclusion).
//
// The tag must sit in the nearest /** ... */ comment before the function.
// Between that comment and the function only "leading" code may appear
// (export, const x =, key:, a call like el.on("x", ...) on the same statement),
// so no ";", "{" or "}" may be in between.

export const PURITY_VALUES = ["pure", "semi-pure-a", "semi-pure-b", "non-pure"];

function walk(node, parent, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, node, visit);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      walk(value, node, visit);
    }
  }
}

function isTarget(node) {
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") return true;
  return node.type === "ArrowFunctionExpression" && node.body?.type === "BlockStatement";
}

function attachStart(node, parent) {
  if (parent && parent.type === "MethodDefinition") return parent.start;
  if (parent && parent.type === "Property" && (parent.method || parent.kind !== "init")) return parent.start;
  return node.start;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function nameOf(node, parent) {
  const key = parent?.key;
  if (key?.name) return key.name;
  if (node.id?.name) return node.id.name;
  return "(anonymous)";
}

/**
 * Check one source text. Returns { total, tagged, violations: [{ line, name, reason }] }.
 * @param {string} src
 */
export function checkPuritySource(src) {
  const ast = parseAst(src);
  const result = { total: 0, tagged: 0, violations: [] };
  walk(ast, null, (node, parent) => {
    if (!isTarget(node)) return;
    result.total++;
    const start = attachStart(node, parent);
    const where = { line: lineOf(src, start), name: nameOf(node, parent) };
    const end = src.lastIndexOf("*/", start);
    const begin = end < 0 ? -1 : src.lastIndexOf("/**", end);
    if (begin < 0) {
      result.violations.push({ ...where, reason: "no JSDoc" });
      return;
    }
    const gap = src.slice(end + 2, start).replace(/\/\/[^\n]*/g, "");
    if (/[;{}]/.test(gap) || gap.includes("/*")) {
      result.violations.push({ ...where, reason: "no JSDoc" });
      return;
    }
    const comment = src.slice(begin, end + 2);
    const values = [...comment.matchAll(/@purity\b[ \t]*([^\s*]*)/g)].map((m) => m[1]);
    if (values.length !== 1) {
      result.violations.push({ ...where, reason: `${values.length} @purity tags` });
      return;
    }
    if (!PURITY_VALUES.includes(values[0])) {
      result.violations.push({ ...where, reason: `invalid value "${values[0]}"` });
      return;
    }
    result.tagged++;
  });
  return result;
}
