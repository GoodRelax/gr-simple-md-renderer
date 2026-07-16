# Changelog

All notable changes to GRSMD are recorded here.
Format is loosely based on Keep a Changelog (https://keepachangelog.com/).

As of 2026-07-16 all rendering libraries are bundled into the build (see that
entry), so there are no runtime CDN resources or SRI hashes to maintain. Library
versions live in `package.json`. The earlier entries below record the previous
CDN + SRI era, in which each upstream `/+esm` rebuild required a documented
re-hash.

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
