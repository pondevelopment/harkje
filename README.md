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

## CSV input (non-technical friendly)

The sidebar also supports a CSV-style input for quick editing.

Format:

- One person per line
- Columns: `user, manager, title, department, details`
- Leave `manager` empty (or set it to `null`) for the single root

Example:

```csv
user,manager,title,department,details
Jane Doe,,CEO,Executive,"Leads the company"
John Smith,Jane Doe,Engineering Manager,Engineering,"Runs the platform team"
```

Notes:

- Managers must exist as users somewhere in the CSV.
- User names must be unique (or you can add an explicit `id` column).

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

The download button in `App.tsx` calls this method.

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

