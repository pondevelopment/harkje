# Copilot instructions for this repo (harkje)

You are working in **Harkje**, a small **Angular + TypeScript** app that generates and renders organizational charts.

## Golden rules

- **Preserve the data model invariants** (see "Data model" below). Most bugs come from invalid trees.
- **No external AI / no API keys**. The generator is deterministic and local. Do not introduce network calls for generation.
- **Do not edit build outputs** (`dist/`) or vendored content (`node_modules/`, `.angular/`).
- Keep changes **small, surgical**, and consistent with existing patterns.

## How to run

- Install: `npm install`
- Dev server: `npm run dev` (Angular CLI `ng serve`; default http://localhost:4200)
- Production build: `npm run build` (Angular CLI `ng build`, outputs to `dist/harkje/`)
- Watch build: `npm run watch`

GitHub Pages deploy (workflow): build is executed as `npm run build -- --base-href=/<repo>/`.
A `prebuild` step (`scripts/generate-build-info.mjs`) writes `src/environments/build-info.ts`
from git sha + time before every build; in dev `fileReplacements` swaps in a placeholder.

## Tech stack & constraints

- Angular 19.2 (standalone components, signals, **zoneless** change detection via
  `provideExperimentalZonelessChangeDetection`, `OnPush`)
- TypeScript (strict, `noPropertyAccessFromIndexSignature`)
- D3 (`d3`) for layout + zoom/pan
- Native SVG serialization + canvas rasterization for PNG export
- `lucide-angular` for icons (see "Icons" section — icons are data, not components)
- Styling: component-scoped SCSS + global CSS variables in `src/styles.scss`.
  Do **not** add Tailwind (the old React app used Tailwind via CDN; that has been removed).

## Icons (lucide-angular@0.475)

In this version of `lucide-angular`, icon exports (`Wand`, `Loader`, `Dices`, `X`,
`Menu`, `Ratio`, `Download`, `FileJson`, `Sheet`, `Layers`, ...) are **data objects**
(`LucideIconData`), **not** standalone Angular components.

Usage pattern in a standalone component:

1. `imports: [LucideAngularModule]` — import the NgModule that declares/exports the
   `<lucide-icon>` component. Do **not** put the icon-data constants in `imports`.
2. In the component class, expose the icon as a readonly field so the template can bind it:
   `readonly Wand = Wand;`
3. In the template: `<lucide-icon [img]="Wand" [size]="16" />`

Icon-name differences vs. lucide-react: `Loader` (no `Loader2`), `Wand` (no `Wand2`).

## Project map (where to change things)

- App shell (layout + state wiring + toolbar + resize handle):
  `src/app/app.component.ts`
- Sidebar / generator / editor UI: `src/app/components/input-panel/`
  - `input-panel.component.ts` — tab container
  - `generator-tab.component.ts` — one-click random org by size
  - `json-editor-tab.component.ts` — flat JSON list editor
  - `csv-editor-tab.component.ts` — CSV editor
- Renderer + export: `src/app/components/org-chart/org-chart.component.ts`
  - D3 SVG render, zoom/pan, click-to-collapse, PNG export
- Layout engine (pure logic, no Angular): `src/app/core/adaptive-org-layout.service.ts`
  - `computeAdaptiveLayout()`, `buildLinkRoute()`, `buildLinkPath()`, ...
- Tree <-> flat conversion: `src/app/core/org-tree.service.ts`
  - `flattenTree()` converts `OrgNode` -> `FlatNode[]`
  - `buildTree()` converts `FlatNode[]` -> `OrgNode`
- CSV import/export + validation: `src/app/core/csv-parser.service.ts`
- Deterministic org generator: `src/app/core/org-generator.service.ts`
  (renamed from `geminiService`; old name kept nowhere)
- Theme service (site + chart themes, localStorage): `src/app/core/theme.service.ts`
- Types: `src/app/models/org.types.ts`
- Initial demo org: `src/app/constants/initial-data.ts`
- Global styles / CSS variables: `src/styles.scss`
- Bootstrap (zoneless): `src/main.ts`

## Data model (must keep valid)

There are **two representations**:

1) **Tree** for rendering (`OrgNode`)
- Nested via `children?: OrgNode[]`

2) **Flat list** for editing/generation (`FlatNode[]`)
- Each node has `id: string` and `parentId: string | null`
- The root is represented by `parentId: null` or the string `"null"`.

Invariants to maintain:

- Exactly **one logical root**.
- Every non-root node's `parentId` should resolve to an existing node id.
- Avoid cycles.
- Keep ids as **strings** everywhere.

When adding fields to nodes:

- Update `src/app/models/org.types.ts` (`OrgNode` and `FlatNode`).
- Update `flattenTree()` and `buildTree()` in `src/app/core/org-tree.service.ts`.
- Update any generator output in `src/app/core/org-generator.service.ts`.
- Update card rendering in `src/app/components/org-chart/org-chart.component.ts` if the
  new field should display.
- Update the editors (JSON / CSV) if the field should be editable.

## Angular conventions

- **Standalone components + signals**. Use `input()`, `input.required()`, `model()`,
  `signal()`, `computed()`, `effect()` rather than `@Input`/`@Output` where practical.
- `ChangeDetectionStrategy.OnPush` on every component; the app is zoneless
  (`provideExperimentalZonelessChangeDetection` in `src/main.ts`). Side effects that
  need Angular to re-check must run inside `effect()` / update a signal.
- Services are `@Injectable({ providedIn: 'root' })` and injected via `inject(...)`.
- Keep templates inline (the `template` field) unless a template grows large; styles
  live in co-located `.scss` files referenced via `styleUrls`.

## UI/styling conventions

- Use the existing CSS variables (`--ui-*`, `--chart-*`) from `src/styles.scss`.
- Do not introduce new design systems or hard-coded colors unless necessary.
- Keep responsive behavior: sidebar toggles on mobile; chart area fills remaining space.
- Component styles are scoped (Angular view encapsulation) — don't reach into another
  component's DOM.

## OrgChart renderer conventions (D3 + native PNG export)

- The chart uses an SVG `<foreignObject>` with an HTML card template.
- Export serializes a detached SVG clone, replaces HTML cards with native themed
  SVG primitives, rasterizes through a browser canvas, and keeps the exact frame.
- Collapse behavior is tracked by `collapsedKeys: OrgChartNodeKeys` (PrimeNG-style:
  key present + truthy = collapsed); clicking a node toggles collapse only if it had
  children in the original data.
- Zoom transform is preserved across collapse/theme re-renders. Data identity,
  direction, or target-aspect-ratio changes trigger auto-fit.
- Preserve source child order row-major. Compact by translating complete subtrees
  against their real contours; never add person-specific offsets.
- Target aspect ratio selects a fixed-gap layout topology. Never scale coordinates,
  card dimensions, or layout gaps to meet a ratio.
- Wrapped peer rows advance exactly one card-height + gap step. Never let one
  child's subtree height push later direct reports down by extra levels.
- Pack later rows horizontally against existing contours, reserve connector
  channels, and require every route to clear unrelated cards.
- Cache target-independent candidate frontiers per visible hierarchy/direction;
  rebuild only when data, collapse state, or direction changes.
- `OrgChartComponent` exposes imperative `exportImage()` via `@ViewChild`.

## Dependency guidance

- Avoid adding dependencies unless explicitly requested.
- If you must add one, justify it and update `package.json` accordingly.

## Code style & TypeScript

- Match the surrounding file's formatting and conventions.
- Prefer explicit types for public inputs/outputs and refs.
- Keep functions pure where practical, especially conversion helpers and generators.
- Files under `src/app/components/<dir>/` import siblings via `../`, models/core via
  `../../models/...` and `../../core/...` (one `../` to `<dir>`, two to `src/app`).

## Documentation updates

When behavior changes (data format, generator rules, export behavior), also update
`README.md` to match.
