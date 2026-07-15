import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

// Keep only the woff2 source in each @font-face rule, dropping the woff/ttf
// fallback copies. woff2 is supported by every browser that can run this app
// (ES modules, File System Access API), so the other formats are dead weight
// once inlined. Same glyphs, roughly two-thirds fewer font bytes.
const katexWoff2Only = {
  postcssPlugin: "katex-woff2-only",
  Declaration(decl) {
    if (decl.prop !== "src" || !decl.value.includes("woff2")) return;
    const woff2 = decl.value.split(",").filter((part) => part.includes("woff2"));
    if (woff2.length) decl.value = woff2.join(",").trim();
  },
};

export default defineConfig({
  root: "src",
  build: {
    outDir: "../docs",
    emptyOutDir: false,
    // Inline all assets (incl. katex woff2 fonts) as data URIs so the output
    // stays a single self-contained file.
    assetsInlineLimit: 100000000,
    rollupOptions: {
      // Canary: build the pre-release entry to docs/pre-release.html. The live
      // docs/index.html is left untouched (emptyOutDir: false) so GitHub Pages
      // keeps serving the current release until pre-release is promoted.
      input: fileURLToPath(new URL("./src/pre-release.html", import.meta.url)),
    },
  },
  css: {
    postcss: {
      plugins: [katexWoff2Only],
    },
  },
  plugins: [viteSingleFile()],
  test: {
    environment: "jsdom",
    root: ".",
  },
});
