# Harkje

Harkje is a small **Angular + TypeScript** app for generating and visualizing
organizational charts.

It includes:

- A **sidebar** for generating or editing the org structure as a flat list (Generator / JSON / CSV).
- A **D3-based org chart renderer** with pan/zoom, click-to-collapse, and PNG export.
- A **local, deterministic random generator** (no API keys, no external services).

## Source code

Public repository (PRs welcome):

- <https://github.com/pondevelopment/harkje/>

## Live app

- <https://pondevelopment.github.io/harkje/>

## Tech stack

- Angular 19.2 (standalone components, signals, **zoneless** change detection)
- TypeScript (strict)
- D3 (`d3`) for layout rendering and zoom/pan
- Native SVG serialization + canvas rasterization for PNG export
- `lucide-angular` for icons
- Component-scoped SCSS + global CSS variables (no Tailwind)

## Themes

Harkje has two separate theme systems:

- **Site theme** (Light / Dark): affects the app UI (sidebar + toolbar).
- **Chart theme** (Light / Soft / Warm / Pencil / Classic / Dark / High Contrast): affects the org chart renderer and PNG export.

### Site theme

- UI theme tokens are defined as **CSS variables** in `src/styles.scss` (the `--ui-*` tokens).
- The active site theme is applied by setting `data-site-theme="..."` on the `<html>` element.
- The selection is persisted in `localStorage` under `harkje.siteTheme`.

### Chart theme

Harkje supports a small built-in **chart theme** system (Light / Soft / Warm / Pencil / Classic / Dark / High Contrast) that works with the org chart renderer and PNG export.

- Theme tokens are defined as **CSS variables** in `src/styles.scss` (using `[data-chart-theme="..."]`).
- The active theme is applied to the chart by setting `data-chart-theme="..."` on the chart container element.
- The selection is persisted in `localStorage` under `harkje.chartTheme`.

Adding a new theme:

1. Add a new `[data-chart-theme="yourThemeId"] { ... }` block in `src/styles.scss` with the same token names.
2. Add the theme id + label to `CHART_THEMES` in `src/app/core/theme.service.ts`.

Note: for SVG link lines the app resolves `--chart-link` to a concrete color at runtime (more reliable for export).

## Project structure

Key files:

- `src/main.ts`: bootstrap (zoneless)
- `src/app/app.component.ts`: top-level state + layout (sidebar + chart + toolbar + resize handle)
- `src/app/components/input-panel/`: generator/editor UI
  - `input-panel.component.ts` — tab container
  - `generator-tab.component.ts` — one-click random org by size
  - `json-editor-tab.component.ts` — flat JSON list editor
  - `csv-editor-tab.component.ts` — CSV editor
- `src/app/components/org-chart/org-chart.component.ts`: D3 renderer + SVG rendering + export
- `src/app/core/adaptive-org-layout.service.ts`: pure layout engine
  - `computeAdaptiveLayout()` solves bottom-up from leaves into bounded
    frontiers of routing-aware subtree blocks, then selects the complete valid
    topology closest to the requested aspect ratio.
  - Each subtree block owns cards, connector segments, entry ports, clearance
    corridors, bounds, and topology metrics; parent composition translates the
    complete block rigidly.
  - `buildLinkRoute()` / `buildLinkPath()` expose the selected reserved-channel routes.
- `src/app/core/org-layout-geometry.ts`: pure orthogonal-segment relationship
  classifier used to reject foreign connector crossings, overlaps, and junctions.
- `src/app/core/org-tree.service.ts`: tree <-> flat conversion
  - `flattenTree()` converts `OrgNode` → `FlatNode[]` for the editor.
  - `buildTree()` converts `FlatNode[]` → `OrgNode` for rendering.
- `src/app/core/csv-parser.service.ts`: CSV import/export + validation
- `src/app/core/org-generator.service.ts`: local org generator
- `src/app/core/theme.service.ts`: site + chart themes (localStorage)
- `src/app/models/org.types.ts`: `OrgNode`, `FlatNode`, `LayoutDirection`
- `src/app/constants/initial-data.ts`: initial demo org

## Data model

There are two representations of the org:

- **Tree** (`OrgNode`) used by the chart renderer (nested via `children`).
- **Flat list** (`FlatNode[]`) used by the editor/generator (`parentId` points to a manager id; the root uses `parentId: "null"` or `null`).

`InputPanel` keeps these in sync:

- `flattenTree()` converts `OrgNode` → `FlatNode[]` for the editor.
- `buildTree()` converts `FlatNode[]` → `OrgNode` for rendering.

(Both live in `src/app/core/org-tree.service.ts` and are consumed by the editor tabs.)


## List editor input (JSON)

The sidebar includes a **List Editor** that edits the org as a JSON array of `FlatNode` objects.

- Use `"parentId": "null"` (string) or `"parentId": null` for the root.
- Keep `id` values as strings.

Example:

```json
[
  {"id":"1","parentId":"null","name":"Jane Doe","title":"CEO","department":"Executive","details":"Leads the company"},
  {"id":"2","parentId":"1","name":"John Smith","title":"Engineering Manager","department":"Engineering","details":"Runs the platform team"}
]
```

Note: if the input implies multiple roots (e.g. missing/unknown managers), the app will pick a best-effort root (heuristic prefers titles like "CEO").


## Running locally

Prerequisites:

- Node.js 20+ (recommended)

Install and run:

```bash
npm install
npm run dev
```

Then open the dev server URL (default: `http://localhost:4200`).

## Scripts

```bash
npm run dev      # Start dev server (ng serve, default http://localhost:4200)
npm run build    # Production build to dist/harkje/ (ng build)
npm run watch    # Watch build (development)
npm test         # Run the Vitest test suite once
```

A `prebuild` step writes `src/environments/build-info.ts` from the current git sha +
timestamp before each build (see `scripts/generate-build-info.mjs`); in dev a
placeholder is swapped in via `angular.json` `fileReplacements`.


## How generation works (no AI)

The generator lives in `src/app/core/org-generator.service.ts`. It exports:

- `generateOrgStructure(description: string)`: produces a deterministic randomized org seeded by the description.
- `generateRandomOrgStructure(size, theme, nonce)`: produces a deterministic randomized org based on size/theme/nonce.

The available size buckets are XXS (~2–4 nodes), XS (~5–8), S (~9–14),
M (~15–20), L (~30–40), XL (~50–60), and XXL (~70–80).

Both return a `FlatNode[]` that forms a valid tree with exactly one root.

## Exporting the chart

The chart component exposes an imperative export method (called via `@ViewChild`):

- `exportImage()`: exports the exact target-ratio communication frame to PNG.

Export details:

- The exported PNG is **cropped to the chart bounds**.
- The PNG background is **transparent** (good for presentations).
- The export reflects the current theme for node cards and link lines.

The download button in `app.component.ts` calls this method (wired to the chart component via `@ViewChild`).

## Chart controls

The toolbar (top of the main area) provides:

- Site theme selector (Light / Dark)
- Chart theme selector (Light / Soft / Warm / Pencil / Classic / Dark / High Contrast)
- Target aspect ratio slider: recomputes and selects the closest fixed-gap row topology
- Download image: exports a PNG

The layout is automatically contour-packed; no manual compaction pass is
required. Changing aspect ratio changes row partitions and subtree arrangements,
not card sizes or gaps. Source child order remains row-major, complete subtrees
move as rigid blocks, and connectors use reserved channels. Wrapped peer rows
advance by one fixed card/gap step; a deep subtree never pushes later peers below
its descendants. Layout is solved recursively from the leaves upward: every
candidate subtree is sealed as one block containing both cards and owned route
segments before its parent packs it. Candidate frontiers are cached so ratio
changes remain fast.
The combinatorial search is bounded: every node retains at most 32 Pareto-style
candidates, including an explicit hierarchy-optimal candidate, and parent nodes
combine child choices through a 16-state beam. This avoids greedy local choices
without attempting an unbounded Cartesian search.
Narrowest and widest aspect candidates are explicit anchors at node, child-option,
and beam levels, so pruning cannot silently discard the slider's extremes.
Parents with up to eight reports enumerate every ordered row cut. Larger parents
use a 32-state incremental ordered-partition beam that preserves hierarchy,
balance, area, and aspect-profile anchors. Every topology is fully packed and
route-validated before one global Pareto pass compares candidates across both
row partitions and child-subtree variants. A candidate is discarded when another
safe candidate uses fewer parent peer bands, has no worse hierarchy delay/offset,
and needs no more than `0.20` logarithmic sibling-breadth growth. There is no
greedy post-hoc row-merging path. Aspect ratio may change recursive subtree
topology, but it cannot retain a hierarchy-dominated peer layout to manufacture
height.
Candidates are grouped into adaptive ratio-suitability tiers—strict for extreme
portrait/landscape targets and broader near square. Within a tier, peer rows are
balanced into the fewest early bands without singleton tails, preventing sparse
staircases while retaining meaningful topology changes across target ratios.
Final selection is stricter than frontier construction: first reject unsafe
geometry, then admit only candidates within `0.08` logarithmic error of the best
safe content ratio. Hierarchy inversions, peer bands, singleton tails, and delay
are minimized only inside that ratio envelope. This prevents a very wide or tall
figure from passing merely because the export frame adds blank padding. The rule
is orientation-independent because candidate ratios are measured in physical
width and height.
At extreme portrait targets, visible leaf peers can use an aligned single-column
roster with one manager-owned side bus, rather than a misleading zigzag of cards.
All reports of one manager share that manager's first connector bus; lower-row
reports descend through reserved columns so unrelated manager lines never merge.
Any crossing, overlap, endpoint touch, or T-junction between connectors owned by
different managers is a hard-invalid candidate, regardless of ratio or density.
PNG export adds a symmetric outer frame so the image matches the requested ratio
exactly, while tests separately verify the unpadded chart remains near the best
safe content ratio available on the hierarchy-nondominated frontier.

Every newly generated, imported, or edited organization starts fully expanded.
Nodes collapse only when the user clicks a manager in the current chart; collapse
choices are never carried over to replacement data with reused ids.

The sidebar (left) can be dragged to resize, collapsed/expanded with the grip
toggle, and toggles on/off via the menu button on mobile.


## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys the static
browser output from `dist/harkje/browser` to GitHub Pages:

- `.github/workflows/deploy-pages.yml`

Setup:

1. Push to `main`.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

Your site will be published at:

- `https://<owner>.github.io/<repo>/`

The workflow builds with `npm run build -- --base-href=/<repo>/` so Angular's
asset URLs resolve under the project subpath.

## Extending the app

Common extension points:

- Node card UI: update the HTML template in `src/app/components/org-chart/org-chart.component.ts`.
- Layout behavior: update `computeAdaptiveLayout()` and its geometry tests in `src/app/core/adaptive-org-layout.service.spec.ts`.
- Input fields: extend `FlatNode`/`OrgNode` in `src/app/models/org.types.ts`, then update `flattenTree()` + `buildTree()` in `src/app/core/org-tree.service.ts`.
- Icons: import the icon data from `lucide-angular`, add `readonly MyIcon = MyIcon;` to the component class, and use `<lucide-icon [img]="MyIcon" />` in the template. `LucideAngularModule` must be in the component's `imports`.
