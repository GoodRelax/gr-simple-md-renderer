# Changelog

All notable changes to GRSMD are recorded here.
Format is loosely based on Keep a Changelog (https://keepachangelog.com/).

As of 2026-07-16 all rendering libraries are bundled into the build (see that
entry), so there are no runtime CDN resources or SRI hashes to maintain. Library
versions live in `package.json`. The earlier entries below record the previous
CDN + SRI era, in which each upstream `/+esm` rebuild required a documented
re-hash.

---

## [Unreleased] - 2026-10-10

### Changed

- Update bundled dependencies to the latest release within the same major
  version (plantuml-encoder unchanged at 1.4.0, already the latest):

  | Library | Version |
  |---------|---------|
  | marked | 18.0.5 -> 18.1.0 |
  | mermaid | 11.16.0 -> 11.17.2 |
  | highlight.js | 11.11.1 -> 11.12.0 |
  | katex | 0.17.0 -> 0.18.11 |
  | marked-katex-extension | 5.1.10 -> 5.1.13 |
  | dompurify | 3.4.12 -> 3.4.16 (still deduped with mermaid's copy) |

  - katex stays on 0.18.x: 0.19.0 is out, but marked-katex-extension 5.1.13
    declares `katex >=0.16 <0.19` as its peer range.
  - katex 0.18.0 prefixes its internal CSS classes (for example `base` ->
    `katex-base`). GRSMD only styles `.katex`, which is unchanged. The font set
    (20 faces) is unchanged, and the build still embeds woff2 only.
  - katex 0.18.2 fixes GHSA-238p-pmpm-9mq7 (prototype pollution gadget) for the
    top-level copy.
  - highlight.js 11.12.0 keeps the same 36 languages in `lib/common`; the new
    `freedesktop` grammar is not in the common build.
  - Dev tooling (same major only): vite 7.3.6 -> 7.3.7,
    vite-plugin-singlefile 2.3.0 -> 2.3.3, vitest 4.1.10 -> 4.1.11
    (jsdom stays on 28.1.0, the latest 28.x).
  - Single file: ~4.37 MB (gzip ~1.38 MB), about +10 KB.

- Dev tooling major updates (bundled libraries unchanged):

  | Package | Version |
  |---------|---------|
  | vite | 7.3.7 -> 8.3.4 |
  | vitest | 4.1.11 -> 5.0.3 |

  - vite 8 replaces Rollup/esbuild with Rolldown/Oxc. `vite.config.js` needs
    no option changes: the inline PostCSS plugin (`katexWoff2Only`),
    `assetsInlineLimit` and both `generateBundle` plugins still run, and the CSP
    hash still matches the final inlined script. The Oxc minifier writes
    `import(...)` specifiers as template literals, so the `no-external-imports`
    check now also matches `` import(`https://...`) ``.
  - Single file: ~4.38 MB -> ~4.33 MB (gzip ~1.39 MB -> ~1.37 MB).
  - jsdom stays on 28.1.0: jsdom 30 requires Node `^22.22.2 || ^24.15.0 ||
    >=26.0.0`, and the current dev environment runs Node 24.12.0. Tests pass on
    jsdom 30.1.2 too, so it can be bumped after a Node update.
  - npm audit: the postcss, nanoid, source-map-js and undici findings are gone.
    The 3 high findings left (braces via micromatch via vite-plugin-singlefile)
    are build-time only and have no fixed braces release yet.
  - mermaid 12.1.0 was evaluated and deferred: it bundles the ELK layout engine
    (about +0.5 MB gzip) and makes it the default, which changes the layout of
    flowchart, state, class and requirement diagrams.

### Known issues

- mermaid 11.17.2 still pins its own nested `katex ^0.16.47` (used only for
  `$$...$$` math inside diagram labels, rendered as sanitized MathML). No
  0.16.x release fixes GHSA-238p-pmpm-9mq7 (low severity), so
  `npm audit --omit=dev` reports 2 low findings (katex, mermaid). mermaid 12.1.0
  pins the same range.

---

## [Unreleased] - 2026-07-16

### Changed

- Bundle all rendering libraries into the build instead of loading them from a
  CDN at runtime. marked, mermaid, highlight.js, katex, marked-katex-extension
  and plantuml-encoder are now npm dependencies, inlined into `docs/index.html`
  by vite-plugin-singlefile. The only remaining external call is the optional
  PlantUML rendering server (unchanged, still consent-gated).
  - Permanently ends the recurring jsdelivr `/+esm` SRI breakage: those bundles
    are no longer fetched at runtime, so there are no more SRI hashes to chase.
  - Zero external CDN requests; the app works fully offline after load.
  - katex fonts are embedded as data URIs in woff2 only. All glyph coverage is
    retained; the woff/ttf fallbacks are dropped because every browser that can
    run this app supports woff2.
  - Single file grows from ~54 KB to ~4.37 MB (gzip ~1.38 MB).
  - Published as `docs/index.html`. The previous CDN-based build is kept as
    `docs/bak-index.html` for rollback.

### Removed

- All CDN `<script>` / `<link>` tags and their SRI `integrity` attributes from
  `src/index.html`.

---

## 2026-07-13

jsdelivr rebuilt the marked-katex-extension `/+esm` bundle again (about 11
days after the 2026-07-02 update), changing its bytes and breaking SRI once
more. Version unchanged; integrity refreshed to the value the browser now
computes. This is the second `/+esm` breakage - a permanent fix (bundle into
the build, or drop SRI on `/+esm`) is still pending.

### Fixed

- Refresh SRI after upstream `/+esm` rebuild (version unchanged):

  | Library | Version | integrity |
  |---------|---------|-----------|
  | marked-katex-extension | 5.1.10 | sha384-x9xvDHWk3lUv72Gr7xAxUj8r8t+tOPNMJgXRCqZo5w6YwLKb0+rIPoRo548HIel9 |

---

## 2026-07-02

Update CDN libraries to latest stable, refresh the SRI hashes for the
jsdelivr `/+esm` bundles that had drifted upstream, and add Markdown table
borders.

### Changed

- Update CDN libraries to latest stable (highlight.js unchanged at 11.11.1):

  | Library | Version | integrity |
  |---------|---------|-----------|
  | marked | 17.0.1 -> 18.0.5 | sha384-MU0bL51BF1u980ujv+Pk0Z0qCjhzfBIEHIFPkUq81289nkiAr+q1jSxEkdlIeHLJ |
  | mermaid | 11.12.2 -> 11.16.0 | sha384-H3I/GBuI2vR7qAVY20j3ATk7IbKGz5cjGE6Yu5r32ybgMxbG6WBs1dWh+nVIJzxW |
  | katex (css) | 0.16.28 -> 0.17.0 | sha384-vlBdW0r3AcZO/HboRPznQNowvexd3fY8qHOWkBi5q7KGgqJ+F48+DceybYmrVbmB |
  | marked-katex-extension | 5.1.6 -> 5.1.10 | sha384-4ilMNG5L/wzW3TbP7r/nxwO0/MqiurTlUVcNURb6DX670dmjbF+J58dsIp/O2tTL |

### Fixed

- plantuml-encoder: refreshed SRI only (version stays 1.4.0). Its jsdelivr
  `/+esm` bytes were rebuilt upstream and broke the integrity check.
  New integrity: `sha384-d/kiW+3z12HCqBMXLEwBmEa5t1QxA6p9Ba6Q148eFIuMvF+vakXndEOPSNWz12ud`

### Added

- Light-gray borders for Markdown tables (light and dark themes).

---

## [Baseline] - 2026-03-07

Snapshot of the current production state, recorded before the first
documented CDN update. Values reflect what is embedded in `src/index.html`
at this point.

### CDN dependencies

| Library                          | Version | integrity                                                                                       | Embed (src/index.html) |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| marked                           | 17.0.1  | sha384-AkwdwVgEdZpqPMfydlmViIGgV90b6sHb/NoxnNdlecRKY3puoyKdw/pi64E32c+6                         | line 84                |
| mermaid                          | 11.12.2 | sha384-bBdf+Hx1qc+N2a4poQjInyeO803gqSNqanHQiQ3DgvXaz/aeQz4mQLhIXpK9MP83                         | line 91                |
| highlight.js (es module)         | 11.11.1 | sha512-818kY2uYH1PRlHNZZL17hgbHng9LBOgA4k8TQVsXYTaKwgg5pMxBahxeHDUdAMTPUJ82CXLQmJZOl3OQUKZ18Q== | line 105               |
| highlight.js (css theme, vs2015) | 11.11.1 | sha512-mtXspRdOWHCYp+f4c7CkWGYPPRAhq9X+xCvJMUBVAb6pqA4U8pxhT3RWT3LP3bKbiolYL2CkL1bSKZZO4eeTew== | line 98                |
| katex (css)                      | 0.16.28 | sha384-Wsr4Nh3yrvMf2KCebJchRJoVo1gTU6kcP05uRSh5NV3sj9+a8IomuJoQzf3sMq4T                         | line 120               |
| plantuml-encoder                 | 1.4.0   | sha384-0soUzyKltgTFXRsH4USkmq6FPG3emb/n2JkcG7etR4fIXjKFFJkCLqTl6sM7boxe                         | line 113               |
| marked-katex-extension           | 5.1.6   | sha384-sXM6dT1KwUCU7buT3pldq9hy6hhfkoUXunVhnhf+ISmpQh3ofLks2w7oMwyG24Ex                         | line 126               |

Known issue at baseline: the `plantuml-encoder` and `marked-katex-extension`
entries use jsdelivr `/+esm` bundles. Their upstream bytes were rebuilt, so
the SRI hashes above no longer match and the browser blocks these resources.
This is the defect addressed by the next entry.

### Coupling rules (must stay consistent)

- marked and marked-katex-extension: the extension's peer range must include
  the chosen marked version.
- katex: the JS (pulled in by marked-katex-extension) and the CSS (loaded
  separately) must be the same version.
- highlight.js: the ES module and the CSS theme must be the same version.
- Version strings appear in both `src/index.html` and `src/js/main.js`;
  update both.

### Re-hash procedure

Paste the resource URL into https://srihash.org/, copy the generated
`integrity` value into `src/index.html`, then run `npm run build` to
regenerate `docs/index.html`.
