# Saved third-party license texts

The build's third-party notices (`tools/notices.mjs`, spec appendix A.2) take
license texts from `node_modules`. The code listed here is in the bundle, but
its own package is not in `node_modules`: another package's dist already
carries it (for example `@mermaid-js/parser` bundles `langium`), or the text
is a standard one no installed package ships in full (the SIL Open Font
License for the KaTeX fonts).

Each folder holds the license files of one npm package, copied unchanged
from its published tarball (`npm pack <name>@<version>`, with the owner's
approval: 2026-10-24, and 2026-10-25 for fmin, gl-matrix, webpack,
browser-pack and @rollup/plugin-commonjs). The build reads them offline;
nothing is fetched while building. `tools/third-party-extras.mjs` says which
entry uses which file.

| Folder | Used for |
| --- | --- |
| `langium-4.2.1`, `chevrotain-11.1.2`, `chevrotain-gast-11.1.2`, `chevrotain-utils-11.1.2`, `chevrotain-regexp-to-ast-11.1.2`, `chevrotain-allstar-0.3.1`, `vscode-jsonrpc-8.2.0`, `vscode-languageserver-protocol-3.17.5`, `vscode-languageserver-types-3.17.5`, `vscode-languageserver-textdocument-1.0.12`, `vscode-uri-3.1.0` | code inside `@mermaid-js/parser`'s dist |
| `js-yaml-4.3.0` | code inside `mermaid`'s dist |
| `pako-1.0.10` | code inside `plantuml-encoder`'s dist (its Zlib notice is in that code) |
| `heap-0.2.7` | code inside `cytoscape`'s dist (the version cytoscape's package.json asks for) |
| `jquery-3.7.1` | the jQuery event object adapted in `cytoscape`'s dist; the jQuery version it was adapted from is not known |
| `babel-helpers-7.29.10` | Babel's helpers inside the dists of `dompurify`, `cytoscape`, `cytoscape-fcose` and `layout-base` |
| `fmin-0.0.4` | fmin inside `@upsetjs/venn.js`'s dist (venn.js bundles 0.0.4 with a patch of its own) |
| `webpack-2.7.0`, `webpack-5.112.2` | the webpack runtime in the dists of `layout-base`, `cose-base`, `cytoscape-cose-bilkent` and `cytoscape-fcose` (built with webpack 2 and 5; the exact versions are not known). The two files differ only in line endings |
| `browser-pack-6.1.0` | the browserify prelude in `plantuml-encoder`'s dist (browserify ^16.x uses browser-pack ^6.0.1; the exact version is not known) |
| `rollup-plugin-commonjs-28.0.9`, `rollup-plugin-commonjs-29.0.3` | the @rollup/plugin-commonjs helpers (`getDefaultExportFromCjs`) in `cytoscape`'s dist (devDependency ^28.0.2; the exact version is not known) and in the js-yaml dist inside `mermaid` (29.0.3). The two files are the same bytes |
| `gl-matrix-3.4.4` | gl-matrix inside `cytoscape`'s dist; the version cytoscape bundled is not known (its devDependency is `^3.4.3`), so the entry has no version and the text is 3.4.4's |
| `fontsource-inter-5.3.0` | the SIL Open Font License 1.1 text only (from the line `SIL OPEN FONT LICENSE Version 1.1`), for the KaTeX fonts; nothing of Inter is bundled |

When a dependency update changes one of these versions, the build's checks
point at the entry; replace the folder with the new version's files the same
way.
