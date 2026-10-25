import { describe, it, expect } from "vitest";
import { searchPattern, findMatches, expandReplacement, replaceOne, replaceAll } from "../js/textSearch.js";

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

  it("AT-SRCH-04 expandReplacement reads $$, $&, $1 to $99 and $<name> as String.replace does; a missing group is empty, a number beyond the groups stays", () => {
    const re = /(?<first>\w+) (\w+)?/;
    const m = re.exec("John ");
    for (const template of ["$$-$&-$1-$2-$<first>-$3-$<none>", "plain", "$", "$<first", "$0"]) {
      expect(expandReplacement(template, m), template).toBe("John ".replace(re, template));
    }
    expect(expandReplacement("$$-$&-$1-$2-$<first>-$3-$<none>", m)).toBe("$-John -John--John-$3-");
    const re2 = /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)/;
    expect(expandReplacement("$10/$1", re2.exec("abcdefghij"))).toBe("abcdefghij".replace(re2, "$10/$1"));
  });

  it("AT-SRCH-05 replaceOne / replaceAll: a plain template is taken as it is ($ forms too), a regular expression's is expanded; replaceAll counts", () => {
    const text = "cat cat dog";
    const [first, second] = all(text, "cat", plain);
    expect(replaceOne(text, second, "$&s", false)).toBe("cat $&s dog");
    expect(replaceOne(text, first, "x", false)).toBe("x cat dog");
    const [rm] = all("v1.2", "(\\d)\\.(\\d)", regex);
    expect(replaceOne("v1.2", rm, "$2.$1", true)).toBe("v2.1");

    expect(replaceAll(text, searchPattern("cat", plain), "$1", false)).toEqual({ text: "$1 $1 dog", count: 2 });
    expect(replaceAll("## A\n## B", searchPattern("^## (?<t>\\w)$", regex), "### $<t>!", true)).toEqual({ text: "### A!\n### B!", count: 2 });
    expect(replaceAll("a\nb", searchPattern("^", regex), "> ", true)).toEqual({ text: "> a\n> b", count: 2 });
    expect(replaceAll(text, searchPattern("zzz", plain), "x", false)).toEqual({ text, count: 0 });
  });
});
