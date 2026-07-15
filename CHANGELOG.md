# Changelog

All notable changes to Harkje are documented here.

This project tries to follow the principles of [Keep a Changelog](https://keepachangelog.com/),
and adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **ESLint**: ESLint (v9 flat config) with `angular-eslint` and
  `typescript-eslint` is now set up. Run `npm run lint` (alias for `ng lint`)
  to check the full project. The config extends `eslint.configs.recommended`,
  `tseslint.configs.recommended`, `tseslint.configs.stylistic`, and the
  Angular template + accessibility recommended sets. A few stylistic/template
  rules are relaxed to match existing conventions (e.g. `no-explicit-any`,
  `prefer-output-readonly`).

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
  variants and selects the topology closest to the requested aspect ratio.
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
  Manager-owned connector buses remain distinct across wrapped rows, and export
  adds an exact-ratio outer frame. The former one-shot compaction control is no
  longer needed.
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
