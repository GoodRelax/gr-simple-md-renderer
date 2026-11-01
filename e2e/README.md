# E2E tests (Playwright)

Browser tests for the built single file. Dev-only: nothing here goes into `docs/index.html`.

## Network use

- `npx playwright install ...` downloads the browser builds from Playwright's official
  download hosts. This is the only external traffic, once per machine and Playwright version,
  at development time only.
- The browsers are stored outside the repository, in `%LOCALAPPDATA%\ms-playwright` on Windows
  (`~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS).
- Running the tests sends nothing outside: the app is served on `127.0.0.1`, `vite` runs
  from the local `node_modules` (`npx --no-install`), and every request to another origin is
  aborted inside the browser (see Guards below).

## Run

Default run: Chromium and WebKit.

```bash
npx playwright install chromium webkit
```

```bash
npm run test:e2e
```

Firefox is opt-in and never part of the default run. It needs its own browser download:

```bash
npx playwright install firefox
```

```bash
npm run test:e2e:firefox
```

Both scripts build the app into the gitignored `output/e2e/` first (`npm run build:e2e`; same
build as `docs/index.html`, plus the beta `grsmd-beta.html` that `tools/buildBeta.mjs` makes
from it, as `npm run build:beta` does; `docs/` is not touched) and serve it with `vite preview` on
`127.0.0.1`. The port is derived from the checkout path so parallel worktrees do not collide;
set `GRSMD_E2E_PORT` to fix it. The Playwright version matches gr-scheduler (1.62.1).
One browser only (after `npm run build:e2e`): `npx playwright test --project=webkit`.

Files are named `*.e2e.js` so vitest (`npm test`) does not collect them.

Timing tests depend on the machine, so they are skipped unless `GRSMD_PERF=1` is set (they
run in Chromium only), for example in a POSIX shell:

```bash
GRSMD_PERF=1 npm run test:e2e
```

## Helpers

- `fixtures.js`: the guards below, used by every test file.
- `pausedServer.js`: a small server on `127.0.0.1` (a free port) for `fastStartup.e2e.js`. It
  sends the built file up to a given point (before the core, or before the first library's
  data) and holds the rest until the test resumes it, so a test sees the page while the file
  is still arriving, in every browser and without network throttling. The test lets the page
  reach this loopback origin with `extraOrigins.allow(origin)` (`fixtures.js`).

## Guards in every test (`fixtures.js`)

Both guards are automatic fixtures: they run for every test, whether or not the test names
them, and are set up before any `beforeEach`. At teardown each list must be empty.

- `externalRequests`: any request to an origin other than the local server is aborted inside
  the browser and recorded. Nothing reaches a real external host.
- `pageProblems`: console errors, uncaught errors and CSP violations. The page CSP stays on
  (`bypassCSP: false`).

A test that checks a guard itself opts out with
`test.use({ allowExternalRequests: true, allowPageProblems: true })` inside a
`guard check` describe and asserts on the lists on its own. `guards.e2e.js` holds the
self-tests that prove each guard records what it should.

## What these tests can cover

- File drop (`DataTransfer` + `File` on a synthetic `drop` event), .md and other files.
- Download path of Save as (`page.waitForEvent("download")`, file content checked).
- `showSaveFilePicker` replaced by a fake that records the call and the written text.
- Consent gates: no external request before consent or after a refusal.
- Chromium and WebKit engines (headless); Firefox on request.

## What they cannot cover

- IME composition (Japanese input). Playwright types characters, not real IME events.
- Real iPhone / iPad (touch, Safari UI, iOS file picker). WebKit here is the desktop engine.
- The native save dialog of `showSaveFilePicker`, and real permission prompts.
- A real OS drag from the file manager. A synthetic drop has no file on disk behind it, so
  Reload and in-place Save of a dropped file cannot run against a real file.
- Real printing and the print preview.
- Clipboard reads that need a user gesture or permission in Firefox / WebKit.
- Branded Chrome / Edge / Safari builds (these are Playwright's own builds).

## Known issue

On one Windows 11 build 26200 machine, Playwright's Firefox does not start (seen with
Firefox 153 / `firefox-1538` from 1.62.1 and Firefox 157 / `firefox-1555` from 1.64.1):
`spawn UNKNOWN`, with a SideBySide event "Dependent Assembly mozglue ... could not be found".
Chromium and WebKit pass there.
