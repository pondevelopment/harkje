# Harkje

Harkje is a small Vite + React app for generating and visualizing organizational charts.

It includes:

- A **sidebar** for generating or editing the org structure as a flat list.
- A **D3-based org chart renderer** with pan/zoom, click-to-collapse, and PNG export.
- A **local, deterministic random generator** (no API keys, no external services).

## Tech stack

- Vite + React + TypeScript
- D3 (`d3`) for layout rendering and zoom/pan
- `html-to-image` for exporting the chart as PNG
- Tailwind via CDN (see `index.html`)

## Themes

Harkje supports a small built-in **chart theme** system (Light / Dark / High Contrast) that works with the org chart renderer and PNG export.

- Theme tokens are defined as **CSS variables** in `index.html` (using `[data-chart-theme="..."]`).
- The active theme is applied to the chart by setting `data-chart-theme="..."` on the chart container element.
- The selection is persisted in `localStorage` under `harkje.chartTheme`.

Adding a new theme:

1. Add a new `[data-chart-theme="yourThemeId"] { ... }` block in `index.html` with the same token names.
2. Add the theme id + label to `CHART_THEMES` in `theme.tsx`.

Note: for SVG link lines the app resolves `--chart-link` to a concrete color at runtime (more reliable for export).

## Project structure

Key files:

- `index.tsx`: React entrypoint
- `App.tsx`: top-level state + layout (sidebar + chart)
- `components/InputPanel.tsx`: generator/editor UI; converts between flat list and tree
- `components/OrgChart.tsx`: custom layout engine + SVG rendering + export
- `services/geminiService.ts`: local org generator (keeps historical name)
- `types.ts`: `OrgNode`, `FlatNode`, `LayoutDirection`

## Data model

There are two representations of the org:

- **Tree** (`OrgNode`) used by the chart renderer (nested via `children`).
- **Flat list** (`FlatNode[]`) used by the editor/generator (`parentId` points to a manager id; the root uses `parentId: "null"` or `null`).

`InputPanel` keeps these in sync:

- `flattenTree()` converts `OrgNode` → `FlatNode[]` for the editor.
- `buildTree()` converts `FlatNode[]` → `OrgNode` for rendering.


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

Then open the dev server URL (default: `http://localhost:3000`).

Note: don’t run the source with VS Code “Live Server”. The app entry is `index.tsx`, which needs Vite to bundle/transpile.

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Build to dist/
npm run preview  # Preview the production build locally
```

## How generation works (no AI)

The generator lives in `services/geminiService.ts` (name kept to avoid churn). It exports:

- `generateOrgStructure(description: string)`: produces a deterministic randomized org seeded by the description.
- `generateRandomOrgStructure(size, theme)`: produces a deterministic randomized org based on size/theme.

Both return a `FlatNode[]` that forms a valid tree with exactly one root.

## Exporting the chart

The chart component exposes an imperative ref API:

- `exportImage()`: exports the current chart viewport to a PNG using `html-to-image`.

Export details:

- The exported PNG is **cropped to the chart bounds**.
- The PNG background is **transparent** (good for presentations).
- The export reflects the current theme for node cards and link lines.

The download button in `App.tsx` calls this method.

## Chart controls

The floating toolbar in the top-right provides:

- Theme selector (Light / Dark / High Contrast)
- Target aspect ratio slider: influences how the layout engine wraps/grids large child groups
- Download image: exports a PNG

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys `dist/` to GitHub Pages:

- `.github/workflows/deploy-pages.yml`

Setup:

1. Push to `main`.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

Your site will be published at:

- `https://<owner>.github.io/<repo>/`

## Extending the app

Common extension points:

- Node card UI: update the HTML template in `components/OrgChart.tsx`.
- Layout behavior: update `computeBalancedLayout()` in `components/OrgChart.tsx`.
- Input fields: extend `FlatNode`/`OrgNode` in `types.ts`, then update `flattenTree()` + `buildTree()`.
