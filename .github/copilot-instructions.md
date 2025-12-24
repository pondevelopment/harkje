# Copilot instructions for this repo (harkje)

You are working in **Harkje**, a small **Vite + React + TypeScript** app that generates and renders organizational charts.

## Golden rules

- **Preserve the data model invariants** (see “Data model” below). Most bugs come from invalid trees.
- **No external AI / no API keys**. The generator is deterministic and local. Do not introduce network calls for generation.
- **Do not edit build outputs** (`dist/`) or vendored content (`node_modules/`).
- Keep changes **small, surgical**, and consistent with existing patterns.

## How to run

- Install: `npm install`
- Dev server: `npm run dev` (Vite; default http://localhost:3000)
- Production build: `npm run build`
- Preview build: `npm run preview`

GitHub Pages deploy (workflow): build is executed as `npm run build -- --base=/<repo>/`.

## Tech stack & constraints

- React 19 + TypeScript (ESM, `type: module`)
- Vite 6
- D3 (`d3`) for layout + zoom/pan
- `html-to-image` for PNG export
- Styling uses **Tailwind via CDN** in `index.html` (no Tailwind config). Do not add Tailwind build tooling unless explicitly requested.

## Project map (where to change things)

- App layout + state wiring: `App.tsx`
- Generator/editor UI: `components/InputPanel.tsx`
  - `flattenTree()` converts `OrgNode` → `FlatNode[]`
  - `buildTree()` converts `FlatNode[]` → `OrgNode`
- Renderer + layout engine + export: `components/OrgChart.tsx`
  - Layout: `computeBalancedLayout()`
  - Export: `OrgChartRef.exportImage()`
- Deterministic org generator: `services/geminiService.ts` (name kept intentionally)
- Types: `types.ts`
- Initial demo org: `constants.ts`

## Data model (must keep valid)

There are **two representations**:

1) **Tree** for rendering (`OrgNode`)
- Nested via `children?: OrgNode[]`

2) **Flat list** for editing/generation (`FlatNode[]`)
- Each node has `id: string` and `parentId: string | null`
- The root is represented by `parentId: null` or the string `"null"`.

Invariants to maintain:

- Exactly **one logical root**.
- Every non-root node’s `parentId` should resolve to an existing node id.
- Avoid cycles.
- Keep ids as **strings** everywhere.

When adding fields to nodes:

- Update `types.ts` (`OrgNode` and `FlatNode`).
- Update `flattenTree()` and `buildTree()` in `components/InputPanel.tsx`.
- Update any generator output in `services/geminiService.ts`.
- Update card rendering in `components/OrgChart.tsx` if the new field should display.

## UI/styling conventions

- Prefer existing Tailwind utility patterns used in `App.tsx` and `components/InputPanel.tsx`.
- Do not introduce new design systems or hard-coded CSS unless necessary.
- Keep responsive behavior: sidebar toggles on mobile; chart area fills remaining space.

## OrgChart renderer conventions (D3 + html-to-image)

- The chart uses an SVG `<foreignObject>` with an HTML card template.
- Export is sensitive to browser rendering; keep export options conservative (pixelRatio, skipFonts, warmup run).
- Collapse behavior is tracked by `collapsedIds: Set<string>`; clicking a node toggles collapse only if it had children in the original data.
- Zoom transform is preserved across re-renders unless the `data` object identity changes.

## Dependency guidance

- Avoid adding dependencies unless explicitly requested.
- If you must add one, justify it and update `package.json` accordingly.

## Code style & TypeScript

- Match the surrounding file’s formatting and conventions.
- Prefer explicit types for public props/refs (`OrgChartRef`, component props).
- Keep functions pure where practical, especially conversion helpers and generators.

## Documentation updates

When behavior changes (data format, generator rules, export behavior), also update `README.md` to match.
