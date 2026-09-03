# Changelog

All notable changes to Harkje are documented here.

This project tries to follow the principles of [Keep a Changelog](https://keepachangelog.com/),
and adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

## 2.0.2 — 2026-09-03

### Added

- **Layout strategies**: added a layout algorithm contract, registry, and basic
  tree fallback alongside the adaptive overlap-free solver.
- **Computation feedback**: CSV and JSON updates now show phased progress in a
  blocking modal until the requested chart has finished rendering.
- **Import diagnostics**: automatic CSV corrections are listed as warnings.

### Changed

- **Adaptive layout performance**: large generated-manager imports use validated
  bounded row packing and cached candidate checks. The 201-node regression case
  now completes in about five seconds instead of roughly eighteen seconds.
- **CSV resilience**: comma and semicolon delimiters are detected automatically;
  missing manager rows are synthesized; multiple top-level groups are connected
  below an `Organization` root; self-manager links and multi-person manager cycles
  are repaired deterministically with explicit warnings.
- **Deployment**: GitHub Pages now uploads the Angular output from `dist/harkje`.

### Removed

- **ESLint configuration**: removed the incompatible Angular lint target and its
  development dependencies.

## 2.0.1 — 2026-07-14

### Fixed

- **GitHub Pages deployment** now uploads the Angular browser output from
  `dist/harkje/browser`, placing `index.html` at the artifact root.

## 2.0.0 — 2026-07-14

### Changed

- **Rewritten from Vite + React to Angular 19.2.** The entire application was
  ported to Angular using standalone components, signals, and **zoneless**
  change detection (`provideExperimentalZonelessChangeDetection`, `OnPush`
  everywhere). D3 and the local deterministic generator behaviour are
  preserved; no AI / API keys are used.
- **Tech stack updated**: TypeScript (strict) replaces the React/Vite toolchain;
  `lucide-react` → `lucide-angular` (icons are now data objects bound via
  `<lucide-icon [img]="…">`, see README "Extending the app"); Tailwind-via-CDN
  was **removed** in favour of component-scoped SCSS + global CSS variables
  (`src/styles.scss`, `--ui-*` / `--chart-*` tokens).
- **Dev server** is now `ng serve` (default `http://localhost:4200`, was 3000).
  Scripts in `package.json`: `dev` → `ng serve`, `build` → `ng build`,
  `watch` → `ng build --watch`, `test` → `vitest run`; the old `preview` script
  was dropped.
- **GitHub Pages deploy workflow** (`.github/workflows/deploy-pages.yml`)
  now builds with `npm run build -- --base-href=/<repo>/` and uploads
  `dist/harkje/browser` (was `dist/` with Vite `--base`).
- A new `prebuild` step (`scripts/generate-build-info.mjs`) writes
  `src/environments/build-info.ts` from the current git sha + timestamp before
  every build; in dev an `angular.json` `fileReplacements` swap-in a placeholder.
  The old `VITE_BUILD_SHA` / `VITE_BUILD_TIME` env vars are no longer used.

### Added

- **CSV editor**: a new `csv-editor-tab.component.ts` + `csv-parser.service.ts`
  provide import/export of the org as CSV with validation. The sidebar now has
  three editor tabs — Generator, JSON, and CSV.
- **Adaptive contour layout**: the engine generates fixed-gap ordered row
  topologies and selects the complete valid block closest to the requested aspect ratio.
  Aspect ratio now recomputes the arrangement instead of stretching distances;
  card and layout gaps stay fixed. Complete subtrees move rigidly, connectors
  use reserved channels, and wrapped peer bands advance by a fixed step instead
  of inheriting the deepest subtree height. Candidate frontiers are cached for
  fast ratio changes. Adaptive ratio-suitability tiers stay strict at extreme
  targets but favor fewer, balanced early peer bands near square, eliminating
  sparse staircases such as `1 / 2 / 1`. Route checks now consistently accept a
  connector exactly at the required card-clearance boundary. Extreme portrait
  layouts now align visible leaf peers in a single-column roster connected by
  one manager-owned side bus instead of horizontally staggering singleton rows.
  The solver now works bottom-up from leaves into bounded frontiers of immutable
  subtree blocks. Cards, owned connector segments, entry ports, route-clearance
  corridors, and bounds move together during recursive parent composition.
  Perpendicular crossings, collinear overlaps, endpoint touches, and T-junctions
  between different managers are hard-invalid, so ratio scoring can never select
  an ambiguous chart. Mixed child frontiers allow one parent to combine differently
  shaped child blocks without an unbounded Cartesian search. Export includes route
  extents and adds an exact-ratio outer frame. The former one-shot compaction
  control is no longer needed.
- **Ratio-safe recursive optimization**: every bounded subtree frontier retains
  hierarchy, ratio, area, width, height, and connector extremes, while the
  16-state child beam preserves hierarchy plus explicit narrow/wide aspect
  anchors. Final selection
  first applies hard geometry constraints and a strict `0.08` logarithmic
  content-ratio envelope, then minimizes recursive hierarchy inversions, peer
  bands, tails, and delay. This restores meaningful slider-driven topology
  changes and prevents export padding from hiding an over-wide chart.
- **Global hierarchy-dominance frontier**: the former greedy adjacent-row merge
  is replaced by one target-independent Pareto pass over all safe composed
  candidates, including different child-subtree variants. A layout with extra
  parent peer bands is removed when a no-worse hierarchy fits within a `0.20`
  sibling-breadth growth envelope. Parents above eight reports use a bounded
  32-state ordered-partition beam rather than sampled row counts.
- **User-owned collapse state**: generated, JSON-edited, and CSV-imported trees
  now start fully expanded; collapse choices apply only to the current chart and
  are cleared when replacement data reuses node ids.
- **Sidebar resize / collapse**: the sidebar can be dragged to resize,
  collapsed/expanded via a grip toggle, and toggled on/off with the menu button
  on mobile.
- **Unit tests**: Vitest specs for the pure services — `org-tree.service`,
  `adaptive-org-layout.service`, `org-generator.service`, and `csv-parser.service`
  (under `src/app/core/*.spec.ts`).
- **Copilot instructions** for the Angular codebase, including the
  `lucide-angular@0.475` icon-usage pattern and data-model invariants.

### Removed

- **React/Vite sources** deleted: `App.tsx`, `components/InputPanel.tsx`,
  `components/OrgChart.tsx`, `services/geminiService.ts`, `theme.tsx`,
  `types.ts`, `constants.ts`, `index.tsx`, `index.html` (root), `metadata.json`,
  and `vite.config.ts`. The historical `geminiService` was renamed to
  `org-generator.service.ts` (the old name is kept nowhere).
- **Tailwind via CDN** is no longer used; the styling system moved to SCSS +
  CSS variables.
