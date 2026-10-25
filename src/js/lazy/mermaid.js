// On-demand library (INV-81): built alone as an IIFE and put in the file as
// a data block; it hands itself over when LibraryLoader runs it. mermaid's
// DOMPurify is the core's (the build points "dompurify" at boot.shared).
import mermaid from "mermaid";

globalThis.__grsmdBoot.provide("mermaid", mermaid);
