import { describe, it, expect } from "vitest";
import { hasCodeOutline, buildCodeOutline } from "../js/codeOutline.js";

// NE-9, NE-20: the index entries of a source file, per language.

// Timing (AT-COL-18) only with GRSMD_PERF=1 (test spec AT.1; review L7): a
// loaded machine must not fail it. The entries are checked always.
const PERF = process.env.GRSMD_PERF === "1";

const lines = (...rows) => rows.join("\n");
const e = (line, level, label) => ({ line, level, label });

describe("codeOutline (INV-91; NE-9, NE-20)", () => {
  it("AT-COL-01 hasCodeOutline: the ten languages only", () => {
    for (const lang of ["python", "javascript", "typescript", "json", "yaml", "c", "cpp", "csharp", "java", "go"]) {
      expect(hasCodeOutline(lang), lang).toBe(true);
    }
    for (const lang of ["plaintext", "rust", "markdown", "xml", "", "JSON"]) expect(hasCodeOutline(lang), lang).toBe(false);
  });

  it("AT-COL-02 any other language gives []", () => {
    expect(buildCodeOutline("fn main() {}\nstruct A {}", "rust")).toEqual([]);
    expect(buildCodeOutline("class A:\n  pass", "plaintext")).toEqual([]);
  });

  it("AT-COL-03 python: top-level class / def / async def, and defs one level inside a class", () => {
    const text = lines(
      "import os",
      "",
      "class Foo(Base):",
      "    x = 1",
      "",
      "    @property",
      "    def name(self):",
      "        def inner():",
      "            pass",
      "        return 1",
      "",
      "    async def load(self):",
      "        pass",
      "",
      "def top(a, b):",
      "    return a",
      "",
      "async def main():",
      "    pass",
    );
    expect(buildCodeOutline(text, "python")).toEqual([
      e(2, 1, "class Foo"),
      e(6, 2, "def name()"),
      e(11, 2, "async def load()"),
      e(14, 1, "def top()"),
      e(17, 1, "async def main()"),
    ]);
  });

  it("AT-COL-04 python: lines in triple-quoted strings and comments are skipped; a def after a class is not its method", () => {
    const text = lines(
      "class A:",
      '    """Doc',
      "    def fake(): pass",
      '    """',
      "    def real(self): pass",
      "# def commented(): pass",
      "def f():",
      "    s = '''",
      "class Fake:",
      "'''",
      "    def nested(): pass",
    );
    expect(buildCodeOutline(text, "python")).toEqual([e(0, 1, "class A"), e(4, 2, "def real()"), e(6, 1, "def f()")]);
  });

  it("AT-COL-05 javascript / typescript: declarations at line start and the methods of a class", () => {
    const text = lines(
      'import x from "y";',
      "/* function fake() {}",
      "   class Fake {} */",
      "export default class App extends Base {",
      "  constructor(a) {",
      "    super(a);",
      "    if (a) {",
      "      run();",
      "    }",
      "  }",
      "",
      "  static create() { return new App(); }",
      "  get value() { return 1; }",
      "  async #load(url) {}",
      "  *items() {}",
      "  state = { a: 1 };",
      "}",
      "",
      "export async function fetchAll(urls) {}",
      "const add = (a, b) => a + b;",
      "let handler = async (e) => {};",
      "var legacy = function () {};",
      "const single = x => x * 2;",
      "const notFn = compute(3);",
      "function* gen() {}",
      "  function indented() {}",
    );
    expect(buildCodeOutline(text, "javascript")).toEqual([
      e(3, 1, "class App"),
      e(4, 2, "constructor()"),
      e(11, 2, "create()"),
      e(12, 2, "value()"),
      e(13, 2, "#load()"),
      e(14, 2, "items()"),
      e(18, 1, "function fetchAll()"),
      e(19, 1, "const add()"),
      e(20, 1, "let handler()"),
      e(21, 1, "var legacy()"),
      e(22, 1, "const single()"),
      e(24, 1, "function gen()"),
    ]);
  });

  it("AT-COL-06 typescript: interface, type, enum and const enum; a method named get", () => {
    const text = lines(
      "export interface Props { a: string }",
      "export type Id = string | number;",
      "type Handler = (e: Event) => void;",
      "export const enum Kind { A }",
      "enum Color { Red }",
      "export abstract class Store {",
      "  get(key: string): string { return key; }",
      "  private async save(): Promise<void> {}",
      "}",
      "const typed: Fn = (a) => a;",
    );
    expect(buildCodeOutline(text, "typescript")).toEqual([
      e(0, 1, "interface Props"),
      e(1, 1, "type Id"),
      e(2, 1, "type Handler"),
      e(3, 1, "enum Kind"),
      e(4, 1, "enum Color"),
      e(5, 1, "class Store"),
      e(6, 2, "get()"),
      e(7, 2, "save()"),
      e(9, 1, "const typed()"),
    ]);
  });

  it("AT-COL-07 json: keys at depth 1 and 2 that start a line, and array elements as [i]", () => {
    const text = lines(
      "{",
      '  "a": 1,',
      '  "b": {',
      '    "c": [',
      "      1,",
      '      {"d": 2}',
      "    ],",
      '    "e": "x"',
      "  },",
      '  "f": [',
      '    {"g": 1},',
      "    2",
      "  ]",
      "}",
    );
    expect(buildCodeOutline(text, "json")).toEqual([
      e(1, 1, "a"),
      e(2, 1, "b"),
      e(3, 2, "c"),
      e(7, 2, "e"),
      e(9, 1, "f"),
      e(10, 2, "[0]"),
      e(11, 2, "[1]"),
    ]);
  });

  it("AT-COL-08 json: a root array lists its elements; strings with brackets do not change the depth; comments are skipped", () => {
    const text = lines("[", '  "a{[",', "  // note", '  {"k": 1},', "  [", "    3", "  ]", "]");
    expect(buildCodeOutline(text, "json")).toEqual([e(1, 1, "[0]"), e(3, 1, "[1]"), e(4, 1, "[2]"), e(5, 2, "[0]")]);
  });

  it("AT-COL-09 json: minified JSON (one line) gives []", () => {
    expect(buildCodeOutline('{"a":1,"b":{"c":[1,2]}}', "json")).toEqual([]);
  });

  it("AT-COL-10 yaml: keys with no indent and the next indent under them; comments, markers, block scalars skipped", () => {
    const text = lines(
      "# comment",
      "---",
      "name: app",
      "spec:",
      "  replicas: 3",
      "  template:",
      "    metadata: x",
      "  script: |",
      "    key: not a key",
      "  after: yes",
      "items:",
      "  - name: a",
      "    value: 1",
      "  - name: b",
      '"quoted key": 2',
      "url: http://x",
      "- plain item",
      "  orphan: 1",
    );
    expect(buildCodeOutline(text, "yaml")).toEqual([
      e(2, 1, "name"),
      e(3, 1, "spec"),
      e(4, 2, "replicas"),
      e(5, 2, "template"),
      e(7, 2, "script"),
      e(9, 2, "after"),
      e(10, 1, "items"),
      e(11, 2, "name"),
      e(13, 2, "name"),
      e(14, 1, "quoted key"),
      e(15, 1, "url"),
    ]);
  });

  it("AT-COL-11 (NE-20) java: imports as one entry (package not counted), types, constructors and methods, not statements", () => {
    const text = lines(
      "package com.example;",
      "",
      "import java.util.List;",
      "import java.util.Map;",
      "// comment",
      "import java.io.File;",
      "",
      "@Service",
      "public class Foo extends Bar implements Baz {",
      "    private static final int X = compute(3);",
      "    private final List<String> names = new ArrayList<>();",
      "",
      "    public Foo(int x) {",
      "        this.x = x;",
      "        doSomething(x);",
      "        String s = format(x);",
      "    }",
      "",
      "    @Override",
      "    public <T> List<T> map(Function<T> f) throws IOException {",
      "        return null;",
      "    }",
      "",
      "    static class Inner {",
      "        void run() {}",
      "    }",
      "",
      "    private enum Color { RED, GREEN }",
      "}",
    );
    expect(buildCodeOutline(text, "java")).toEqual([
      e(2, 1, "import (3)"),
      e(8, 1, "class Foo"),
      e(12, 1, "Foo()"),
      e(19, 1, "map()"),
      e(23, 1, "class Inner"),
      e(24, 1, "run()"),
      e(27, 1, "enum Color"),
    ]);
  });

  it("AT-COL-12 c: #include run, prototypes and definitions (also with the brace on the next line), struct; not calls or comments", () => {
    const text = lines(
      "#include <stdio.h>",
      '#include "foo.h"',
      "",
      "#define MAX 10",
      "/* a",
      "   int fake(int x) { */",
      "static int counter = 0;",
      "",
      "struct node *make_node(int value);",
      "",
      "typedef struct point {",
      "    int x;",
      "} point_t;",
      "",
      "int main(int argc, char **argv)",
      "{",
      '    printf("%d", max(1, 2));',
      "    struct node *n = make_node(1);",
      "    return 0;",
      "}",
      "",
      "static void helper(void) {",
      "    for (int i = 0; i < 3; i++) {",
      "    }",
      "}",
    );
    expect(buildCodeOutline(text, "c")).toEqual([
      e(0, 1, "import (2)"),
      e(8, 1, "make_node()"),
      e(10, 1, "struct point"),
      e(14, 1, "main()"),
      e(21, 1, "helper()"),
    ]);
  });

  it("AT-COL-13 cpp: other preprocessor lines do not break the run; namespace, template class, members, Class::method", () => {
    const text = lines(
      "#pragma once",
      "#include <vector>",
      "#ifdef USE_STRING",
      "#include <string>",
      "#endif",
      "",
      "namespace app {",
      "",
      "template <typename T>",
      "class Stack : public Base {",
      "public:",
      "    void push(const T& v);",
      "    T pop() const { return items.back(); }",
      "private:",
      "    std::vector<T> items;",
      "};",
      "",
      "enum class Mode { A, B };",
      "",
      "int Stack::size() const {",
      "    return static_cast<int>(items.size());",
      "}",
      "",
      "}  // namespace app",
    );
    expect(buildCodeOutline(text, "cpp")).toEqual([
      e(1, 1, "import (2)"),
      e(9, 1, "class Stack"),
      e(11, 1, "push()"),
      e(12, 1, "pop()"),
      e(17, 1, "enum Mode"),
      e(19, 1, "Stack::size()"),
    ]);
  });

  it("AT-COL-14 csharp: using directives (not using statements), namespace, class, record, interface, members", () => {
    const text = lines(
      "using System;",
      "using System.Collections.Generic;",
      "using static System.Math;",
      "",
      "namespace Demo",
      "{",
      "    public sealed partial class Widget : IDisposable",
      "    {",
      "        public string Name { get; set; }",
      "        public Widget(string name) { Name = name; }",
      "        public async Task<int> LoadAsync(CancellationToken ct)",
      "        {",
      "            using (var s = Open()) { }",
      "            var x = Compute(1);",
      "            return 1;",
      "        }",
      "        public void Dispose() => Close();",
      "    }",
      "    public record Person(string Name);",
      "    internal interface IThing { void Do(); }",
      "}",
    );
    expect(buildCodeOutline(text, "csharp")).toEqual([
      e(0, 1, "import (3)"),
      e(6, 1, "class Widget"),
      e(9, 1, "Widget()"),
      e(10, 1, "LoadAsync()"),
      e(16, 1, "Dispose()"),
      e(18, 1, "record Person"),
      e(19, 1, "interface IThing"),
    ]);
  });

  it("AT-COL-15 (NE-20) go: the import block as one entry (package not counted), struct / interface types, func and methods; not func literals", () => {
    const text = lines(
      "package main",
      "",
      "import (",
      '\t"fmt"',
      "\t// a comment",
      '\t"os"',
      ")",
      "",
      "type Server struct {",
      "\tname string",
      "}",
      "",
      "type Handler interface {",
      "\tServe()",
      "}",
      "",
      "type ID int",
      "",
      "func (s *Server) Start(port int) error {",
      "\tf := func(x int) int { return x }",
      "\treturn nil",
      "}",
      "",
      "func Map[T any](xs []T) []T {",
      '\tfmt.Println("hi")',
      "}",
    );
    expect(buildCodeOutline(text, "go")).toEqual([
      e(2, 1, "import (2)"),
      e(8, 1, "type Server"),
      e(12, 1, "type Handler"),
      e(18, 1, "Start()"),
      e(23, 1, "Map()"),
    ]);
  });

  it("AT-COL-16 a run of 12 import lines becomes one entry import (12); code between runs splits them", () => {
    const imports = [];
    for (let i = 0; i < 12; i++) imports.push(`import pkg.Class${i};`);
    imports.splice(6, 0, "", "/* grouped */");
    const text = lines(...imports, "", "class A {}", "import late.One;");
    expect(buildCodeOutline(text, "java")).toEqual([e(0, 1, "import (12)"), e(15, 1, "class A"), e(16, 1, "import (1)")]);
  });

  it("AT-COL-19 (NE-20) csharp: # directives (#nullable, #region, #if, #pragma) neither break nor join the using run", () => {
    const text = lines(
      "#nullable enable",
      "using A;",
      "#region Imports",
      "using B;",
      "#if DEBUG",
      "using C.Debug;",
      "#endif",
      "#pragma warning disable CS0105",
      "global using D;",
      "#endregion",
      "",
      "class X",
      "{",
      "    #region Members",
      "    void Run() {}",
      "    #endregion",
      "}",
      "#if DEBUG",
      "class Y {}",
      "#endif",
    );
    expect(buildCodeOutline(text, "csharp")).toEqual([e(1, 1, "import (4)"), e(11, 1, "class X"), e(14, 1, "Run()"), e(18, 1, "class Y")]);
  });

  it("AT-COL-20 (NE-20) java / go: package is not an import: not counted, does not start or break a run", () => {
    expect(buildCodeOutline(lines("package a.b;", "", "class A {}"), "java")).toEqual([e(2, 1, "class A")]);
    expect(buildCodeOutline(lines("import x.One;", "package a.b;", "import x.Two;"), "java")).toEqual([e(0, 1, "import (2)")]);
    const twelve = ["package a.b;", ""];
    for (let i = 0; i < 12; i++) twelve.push(`import pkg.Class${i};`);
    expect(buildCodeOutline(lines(...twelve), "java")).toEqual([e(2, 1, "import (12)")]);
    expect(buildCodeOutline(lines("package main", "", 'import "fmt"', 'import "os"', "", "func main() {}"), "go")).toEqual([
      e(2, 1, "import (2)"),
      e(5, 1, "main()"),
    ]);
    expect(buildCodeOutline(lines("package main", "", "func main() {}"), "go")).toEqual([e(2, 1, "main()")]);
  });

  it("AT-COL-17 never throws, for odd input in every language", () => {
    const odd = ['"""', "/*", "{[{[", "- : :", "class", "func (", "#include", "\"\\", "type =", "}}}}"].join("\n");
    for (const lang of ["python", "javascript", "typescript", "json", "yaml", "c", "cpp", "csharp", "java", "go"]) {
      expect(Array.isArray(buildCodeOutline(odd, lang)), lang).toBe(true);
      expect(buildCodeOutline("", lang), lang).toEqual([]);
    }
  });

  it("AT-COL-18 (INV-91) a 1 MB source in each language is outlined, an entry per unit (within 5,000 ms with GRSMD_PERF=1)", () => {
    const samples = {
      python: "class C:\n    def m(self):\n        return 1\n\ndef f():\n    pass\n",
      javascript: "export class C {\n  m() {\n    return 1;\n  }\n}\nfunction f() {}\n",
      json: '  "k": {\n    "a": [\n      1\n    ]\n  },\n',
      yaml: "key:\n  sub: 1\n  list:\n    - a\n",
      java: "public class C {\n    void m() {\n        call(1);\n    }\n}\n",
      go: "func f() {\n\tx := g(1)\n}\n",
    };
    for (const [lang, unit] of Object.entries(samples)) {
      const reps = Math.ceil(1000000 / unit.length);
      const text = lang === "json" ? "{\n" + unit.repeat(reps) + '  "z": 0\n}' : unit.repeat(reps);
      const t0 = performance.now();
      const outline = buildCodeOutline(text, lang);
      if (PERF) expect(performance.now() - t0, lang).toBeLessThan(5000);
      expect(outline.length, lang).toBeGreaterThanOrEqual(reps);
    }
  });
});
