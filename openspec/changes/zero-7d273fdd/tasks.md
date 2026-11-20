# Tasks

## 1. Implementación

- [x] 1.1 Create the OpenSpec change openspec/changes/zero-7d273fdd/ (proposal.md, tasks.md, specs/project-site/spec.md with ADDED requirements matching this spec) and check it with `npx openspec validate --all`.
- [x] 1.2 Write site/brand/zero-logo.svg and site/brand/zero-logo-light.svg: the favicon without the rect, ring stroke #111111 (dark) or #fbfbf9 (light), dot #ff8a5c. Keep the two files identical except for the ring color. Before editing anything, record the SHA-256 of the current site/brand/zero-logo.png and zero-symbol.png for the test.
- [x] 1.3 Add scripts/brand-png.mjs, which uses only Node built-ins (zlib, fs) and renders each symbol SVG's geometry at 16 px per unit into a 512×512 RGBA PNG with antialiased edges (coverage by supersampling or distance to the circle) and alpha 0 everywhere else. Run it to write site/brand/zero-logo-transparent.png and site/brand/zero-logo-transparent-light.png. Do not overwrite site/brand/zero-logo.png.
- [x] 1.4 Write site/brand/zero-logo-horizontal.svg and site/brand/zero-logo-horizontal-light.svg: the symbol on the left and the word "zero" on the right, drawn as lowercase monospace-style paths (stroked or filled) in #111111 or #fbfbf9, with no <text>, fonts, rect or external references and a viewBox wider than it is tall. Keep the two files identical except for the color.
- [x] 1.5 Add test/brand.test.ts with a small PNG decoder (parse chunks, inflate the concatenated IDAT with zlib, undo filters 0–4) and tests for every scenario: the SVG contents, light/dark equivalence, IHDR size and color type, the transparent pixels and the ring and dot colors, the horizontal SVG rules, the unchanged hashes of zero-logo.png and zero-symbol.png, the favicon's rect, and no "brand/" in index.html, styles.css or main.js.
- [x] 1.6 Run `npm run typecheck` and `npx vitest run test/brand.test.ts test/site.test.ts`.
