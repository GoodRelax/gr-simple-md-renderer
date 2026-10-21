import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the built single file (same build as
// docs/index.html, written to the gitignored output/e2e/ so docs/ is never
// touched). `vite preview` serves it on the loopback interface only; the tests
// themselves block every request that leaves that origin.
//
// Default projects: Chromium and WebKit. Firefox runs only on request through
// playwright.firefox.config.js (npm run test:e2e:firefox).

// The port is derived from this checkout's path so that two git worktrees
// running e2e at the same time never collide. GRSMD_E2E_PORT overrides it.
function portForThisCheckout() {
  const named = Number(process.env.GRSMD_E2E_PORT);
  if (Number.isInteger(named) && named > 0) return named;
  let hash = 0;
  for (const ch of process.cwd()) hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
  return 4200 + (hash % 700);
}

const PORT = portForThisCheckout();
const BASE_URL = `http://127.0.0.1:${PORT}`;

export const firefoxProject = { name: "firefox", use: { ...devices["Desktop Firefox"] } };

export default defineConfig({
  testDir: "e2e",
  // *.e2e.js keeps these files out of vitest's default *.test.js / *.spec.js glob.
  testMatch: "**/*.e2e.js",
  outputDir: "output/e2e-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Keep the page's own CSP in force (Playwright can bypass it; we must not).
    bypassCSP: false,
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `npx --no-install vite preview --outDir ../output/e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Never attach to some other server that happens to hold the port.
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
