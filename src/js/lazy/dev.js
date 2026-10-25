// The dev server only (vite.config.js, devLibraries): the receiver, and the
// on-demand libraries provided at once. It runs before main.js.
import { installBoot } from "../boot.js";
import mermaid from "mermaid";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import plantumlEncoder from "plantuml-encoder";

installBoot(window);
const boot = globalThis.__grsmdBoot;
boot.provide("mermaid", mermaid);
boot.provide("hljs", hljs);
boot.provide("katex", katex);
boot.provide("plantuml", plantumlEncoder);
