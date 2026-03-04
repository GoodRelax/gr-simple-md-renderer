import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src",
  build: {
    outDir: "../docs",
    emptyOutDir: false,
    rollupOptions: {
      external: [/^https?:\/\//],
    },
  },
  plugins: [viteSingleFile()],
  test: {
    environment: "jsdom",
    root: ".",
  },
});
