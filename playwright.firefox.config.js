import { defineConfig } from "@playwright/test";
import baseConfig, { firefoxProject } from "./playwright.config.js";

// Opt-in Firefox run (npm run test:e2e:firefox). Same tests and server as the
// default config; only the browser differs. Needs `npx playwright install firefox`.
export default defineConfig({
  ...baseConfig,
  projects: [firefoxProject],
});
