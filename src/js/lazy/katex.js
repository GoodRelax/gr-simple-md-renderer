// On-demand library (INV-81): see mermaid.js. The core keeps the math
// tokenizer (marked-katex-extension, src/js/lazyMath.js); this is KaTeX itself.
import katex from "katex";

globalThis.__grsmdBoot.provide("katex", katex);
