import { describe, it, expect } from "vitest";
import { searchPattern, findMatches, occurrences, countOccurrences, replaceOne, replaceAll } from "../js/textSearch.js";

// INV-80 (2)(5): the search and replace of Search, as pure functions.

const plain = { isRegex: false, matchCase: false };
const regex = { isRegex: true, matchCase: false };
const all = (text, query, options, limit = 100) => findMatches(text, searchPattern(query, options), limit);
const where = (matches) => matches.map((m) => [m.index, m[0]]);

describe("textSearch (INV-80)", () => {
  it("AT-SRCH-01 a plain query is taken as it is: every regular expression sign is a character", () => {
    const text = "a.b a+b (a) [x] $1 ^ \\ a*b a?b {2} |";
    for (const query of [".", "a+b", "(a)", "[x]", "$1", "^", "\\", "a*b", "a?b", "{2}", "|"]) {
      expect(where(all(text, query, plain)), query).toEqual([[text.indexOf(query), query]]);
    }
    expect(searchPattern("", plain)).toBeNull();
    expect(searchPattern("", regex)).toBeNull();
  });

  it("AT-SRCH-02 the flags: ^ and $ at each line, the case by Match case; an invalid expression throws a SyntaxError", () => {
    const text = "# One\ntext\n# Two\nONE one";
    expect(where(all(text, "^# (\\w+)$", regex))).toEqual([[0, "# One"], [11, "# Two"]]);
    expect(where(all(text, "one", plain))).toEqual([[2, "One"], [17, "ONE"], [21, "one"]]);
    expect(where(all(text, "one", { isRegex: false, matchCase: true }))).toEqual([[21, "one"]]);
    expect(searchPattern("one", plain).flags).toBe("gim");
    expect(searchPattern("one", { isRegex: true, matchCase: true }).flags).toBe("gm");
    expect(() => searchPattern("(", regex)).toThrow(SyntaxError);
  });

  it("AT-SRCH-03 an empty match counts and the search moves on by one; the matches stop at the limit; the pattern given is not changed", () => {
    expect(where(all("a\nb\nc", "^", regex))).toEqual([[0, ""], [2, ""], [4, ""]]);
    expect(all("x".repeat(50), "x", plain, 10)).toHaveLength(10);
    const pattern = searchPattern("x", plain);
    pattern.lastIndex = 3;
    findMatches("xxxx", pattern, 100);
    expect(pattern.lastIndex).toBe(3);
  });

  it.each([
    ["(b)", "abc", "[$10]"], // the review's case (a): one group, $10 is $1 and a 0
    ["(b)", "abc", "[$<x>]"], // (b): no named group, $<x> stays
    ["(?<x>b)", "abc", "[$<x>|$<y>]"],
    ["(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)", "abcdefghijk", "[$11|$10|$1x]"],
    ["(b)", "abc", "[$01|$00|$0]"],
    ["(b)", "abc", "[$`|$']"],
    ["(?<first>\\w+) (\\w+)?", "John ", "$$-$&-$1-$2-$<first>-$3-$<none>"],
    ["(\\w+)", "a b", "plain $ $<first $"],
  ])("AT-SRCH-04 (INV-80 (5)) /%s/ in %j with %j: the template is expanded as String.replace does it, for one match and for all", (source, text, template) => {
    const pattern = searchPattern(source, regex);
    const [first] = findMatches(text, pattern, 100);
    expect(replaceOne(text, first, pattern, template, true)).toBe(text.replace(new RegExp(source, "im"), template));
    expect(replaceAll(text, pattern, template, true).text).toBe(text.replace(new RegExp(source, "gim"), template));
  });

  it("AT-SRCH-04 (INV-80 (5)) one match is replaced where it is: ^ and a look-behind see the text around it", () => {
    const lines = "x\nx";
    const line = searchPattern("^x", regex);
    expect(replaceOne(lines, findMatches(lines, line, 100)[1], line, "y", true)).toBe("x\ny");
    const text = "ab cb ab";
    const behind = searchPattern("(?<=a)b", regex);
    expect(replaceOne(text, findMatches(text, behind, 100)[1], behind, "[$&]", true)).toBe("ab cb a[b]");
  });

  it("AT-SRCH-05 (INV-80 (5)) replaceOne / replaceAll: a plain template is taken as it is ($ forms too), a regular expression's is expanded; replaceAll counts", () => {
    const text = "cat cat dog";
    const [first, second] = all(text, "cat", plain);
    const cat = searchPattern("cat", plain);
    expect(replaceOne(text, second, cat, "$&s", false)).toBe("cat $&s dog");
    expect(replaceOne(text, first, cat, "x", false)).toBe("x cat dog");
    const digits = searchPattern("(\\d)\\.(\\d)", regex);
    const [rm] = findMatches("v1.2", digits, 100);
    expect(replaceOne("v1.2", rm, digits, "$2.$1", true)).toBe("v2.1");

    expect(replaceAll(text, searchPattern("cat", plain), "$1", false)).toEqual({ text: "$1 $1 dog", count: 2 });
    expect(replaceAll("## A\n## B", searchPattern("^## (?<t>\\w)$", regex), "### $<t>!", true)).toEqual({ text: "### A!\n### B!", count: 2 });
    expect(replaceAll("a\nb", searchPattern("^", regex), "> ", true)).toEqual({ text: "> a\n> b", count: 2 });
    expect(replaceAll(text, searchPattern("zzz", plain), "x", false)).toEqual({ text, count: 0 });
    const many = "x".repeat(10050);
    expect(replaceAll(many, searchPattern("x", regex), "y", true).count).toBe(10050); // no limit
  });

  it("AT-SRCH-13 (INV-80 (4)) occurrences walks the places of a text in order, not overlapping; countOccurrences counts them (0 for an empty needle)", () => {
    expect([...occurrences("aaaa", "aa")]).toEqual([0, 2]);
    expect([...occurrences("a cat, a Cat", "cat")]).toEqual([2]);
    expect([...occurrences("abc", "x")]).toEqual([]);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("line\nline\n", "\n")).toBe(2);
    expect(countOccurrences("abc", "")).toBe(0);
  });
});
