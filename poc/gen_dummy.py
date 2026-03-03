"""
gen_dummy.py
Generates a fake C source file for smooth-scroll PoC.

Usage:
    python gen_dummy.py                     # default: 4.8 MB
    python gen_dummy.py --size 2.0          # ~2.0 MB
    python gen_dummy.py --lines 50000       # ~50000 lines
    python gen_dummy.py --size 1.0 -o out.c # custom output name
"""

import argparse
import random

# ----------------------------------------
# Argument parsing
# ----------------------------------------
parser = argparse.ArgumentParser(description="Generate dummy C source file.")
group = parser.add_mutually_exclusive_group()
group.add_argument("--size",  type=float, default=4.8,
                   metavar="MB", help="target file size in MB (default: 4.8)")
group.add_argument("--lines", type=int,   default=None,
                   metavar="N", help="target line count")
parser.add_argument("-o", "--output", default="dummy_long.c",
                    metavar="FILE", help="output filename (default: dummy_long.c)")
args = parser.parse_args()

TARGET_BYTES = int(args.size * 1024 * 1024) if args.lines is None else None
TARGET_LINES = args.lines

random.seed(42)

# ----------------------------------------
# Vocabulary
# ----------------------------------------
TYPES   = ["int", "float", "double", "char", "void",
           "uint8_t", "uint16_t", "uint32_t", "uint64_t", "size_t", "ptrdiff_t"]
NAMES   = ["index", "count", "value", "result", "buffer", "length", "offset",
           "data", "ptr", "node", "size", "limit", "threshold", "flag", "status",
           "cursor", "pos", "base", "end", "head", "tail", "mask", "step", "delta"]
OPS     = ["+=", "-=", "*=", "/=", "&=", "|=", "^=", ">>=", "<<="]
CMP     = ["==", "!=", "<", ">", "<=", ">="]
STRUCTS = ["Vector", "Matrix", "Node", "Queue", "Stack", "Buffer", "Context",
           "Config", "Handle", "Frame", "Packet", "Record", "Token", "Span",
           "Cursor", "Entry", "Bitmap", "Ring"]

# ----------------------------------------
# Code fragment generators
# ----------------------------------------
def indent(n):
    return "    " * n

def rand_var():
    return random.choice(NAMES) + "_" + str(random.randint(0, 9))

def rand_type():
    return random.choice(TYPES)

def rand_expr():
    return f"{rand_var()} {random.choice(CMP)} {rand_var()}"

def decl(depth=1):
    return f"{indent(depth)}{rand_type()} {rand_var()} = {random.randint(0, 0xFFFF)};"

def assign(depth=1):
    return f"{indent(depth)}{rand_var()} {random.choice(OPS)} {random.randint(1, 128)};"

def if_block(depth=1):
    out = [f"{indent(depth)}if ({rand_expr()}) {{"]
    out.append(assign(depth + 1))
    if random.random() > 0.5:
        out.append(f"{indent(depth + 1)}return -1;")
    if random.random() > 0.7:
        out.append(f"{indent(depth)}}} else {{")
        out.append(assign(depth + 1))
    out.append(f"{indent(depth)}}}")
    return out

def for_loop(depth=1):
    var = random.choice(["i", "j", "k", "n", "m"])
    n   = random.randint(4, 64)
    out = [f"{indent(depth)}for (int {var} = 0; {var} < {n}; {var}++) {{"]
    out.append(assign(depth + 1))
    if random.random() > 0.5:
        out.append(decl(depth + 1))
    if random.random() > 0.6:
        out.extend(if_block(depth + 1))
    out.append(f"{indent(depth)}}}")
    return out

def while_loop(depth=1):
    out = [f"{indent(depth)}while ({rand_expr()}) {{"]
    out.append(assign(depth + 1))
    out.append(f"{indent(depth + 1)}if ({rand_var()} == 0) break;")
    out.append(f"{indent(depth)}}}")
    return out

def switch_block(depth=1):
    out = [f"{indent(depth)}switch ({rand_var()}) {{"]
    for case_val in random.sample(range(0, 16), 3):
        out.append(f"{indent(depth)}case {case_val}:")
        out.append(assign(depth + 1))
        out.append(f"{indent(depth + 1)}break;")
    out.append(f"{indent(depth)}default:")
    out.append(f"{indent(depth + 1)}break;")
    out.append(f"{indent(depth)}}}")
    return out

def function_block(name, return_type="int"):
    args = ", ".join(f"{rand_type()} {rand_var()}"
                     for _ in range(random.randint(1, 4)))
    out = [f"{return_type} {name}({args})", "{"]

    for _ in range(random.randint(2, 6)):
        out.append(decl(1))
    out.append("")

    generators = [if_block, for_loop, while_loop, switch_block,
                  lambda d: [assign(d)], lambda d: [decl(d)]]
    for _ in range(random.randint(4, 12)):
        out.extend(random.choice(generators)(1))

    out.append("")
    if return_type == "int":
        out.append(f"{indent(1)}return 0;")
    elif return_type not in ("void",):
        out.append(f"{indent(1)}return ({return_type})result_0;")
    out.append("}")
    return out

# ----------------------------------------
# File header (written once)
# ----------------------------------------
def file_header():
    return [
        "/*",
        " * dummy_long.c",
        " * Auto-generated dummy source for smooth-scroll PoC.",
        " * Do not edit by hand.",
        " */",
        "",
        "#include <stdio.h>",
        "#include <stdlib.h>",
        "#include <string.h>",
        "#include <stdint.h>",
        "#include <assert.h>",
        "",
        "#define MAX_SIZE    4096",
        "#define CHUNK_SIZE   256",
        "#define VERSION       42",
        "#define ALIGN(x, a)  (((x) + (a) - 1) & ~((a) - 1))",
        "",
    ]

def struct_block(name):
    out = [f"typedef struct {name} {{"]
    for _ in range(random.randint(3, 7)):
        out.append(f"    {rand_type()} {rand_var()};")
    out.append(f"}} {name};")
    out.append("")
    return out

def module_header(n):
    return [
        f"/* {'=' * 60} */",
        f"/* Module {n:04d}                                              */",
        f"/* {'=' * 60} */",
        "",
    ]

# ----------------------------------------
# Main generation loop
# ----------------------------------------
def generate(target_bytes, target_lines):
    lines = file_header()

    for s in random.sample(STRUCTS, min(6, len(STRUCTS))):
        lines.extend(struct_block(s))

    module_idx = 0
    func_idx   = 0

    while True:
        # Check stop condition
        current_bytes = sum(len(l) + 1 for l in lines)
        current_lines = len(lines)
        if target_bytes is not None and current_bytes >= target_bytes:
            break
        if target_lines is not None and current_lines >= target_lines:
            break

        # Emit a module header every 20 functions
        if func_idx % 20 == 0:
            lines.extend(module_header(module_idx))
            module_idx += 1

        fname = f"func_{func_idx:05d}"
        rt    = random.choice(["int", "void", "double", "uint32_t"])
        lines.append(f"/* ---- {fname} ---- */")
        lines.extend(function_block(fname, rt))
        lines.append("")
        func_idx += 1

    # Trim to target (lines mode)
    if target_lines is not None:
        lines = lines[:target_lines]

    return lines


lines    = generate(TARGET_BYTES, TARGET_LINES)
content  = "\n".join(lines)
out_path = args.output

with open(out_path, "w", encoding="utf-8") as f:
    f.write(content)

size_kb = len(content.encode("utf-8")) / 1024
print(f"Generated  : {out_path}")
print(f"Lines      : {len(lines):,}")
print(f"Size       : {size_kb:.1f} KB  ({size_kb/1024:.2f} MB)")
