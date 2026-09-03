/**
 * Core Harkje data models.
 *
 * Ported from the original React app's types.ts. The org chart has two
 * representations: a nested `OrgNode` tree for rendering, and a flat
 * `FlatNode[]` list for editing/generation.
 */

/** Nested tree node used by the renderer. */
export interface OrgNode {
  id: string;
  name: string;
  title: string;
  department?: string;
  details?: string;
  children?: OrgNode[];
  /** Visual properties populated by the layout engine (D3). */
  x?: number;
  y?: number;
  collapsed?: boolean;
}

/** Flat list node used for editing and generation. */
export interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  title: string;
  department: string;
  details: string;
}

/** Layout direction for the org chart. */
export enum LayoutDirection {
  TopDown = 'TB',
  LeftRight = 'LR',
}

/** Stable identifiers for selectable layout algorithms. */
export type LayoutAlgorithmId = 'adaptive' | 'basic';

/** Physical point used by orthogonal connector routes. */
export interface LayoutPoint {
  x: number;
  y: number;
}

/** Physical content or export-frame bounds. */
export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  treeWidth: number;
  treeHeight: number;
}

/** Complete output returned by every layout algorithm. */
export interface LayoutResult {
  bounds: LayoutBounds;
  frameBounds: LayoutBounds;
  routes: ReadonlyMap<string, readonly LayoutPoint[]>;
  rowsByParent: ReadonlyMap<string, readonly (readonly string[])[]>;
  targetAspectRatio: number;
  achievedAspectRatio: number;
  signature: string;
  candidateCount: number;
}

/**
 * PrimeNG-style collapsed/selection key map.
 * A key present with `true` is collapsed/selected; absent keys are expanded.
 */
export type OrgChartNodeKeys = { [key: string]: boolean };

/** Chart theme identifiers (applies to the org chart renderer only). */
export type ChartThemeId =
  | 'light'
  | 'soft'
  | 'warm'
  | 'pencil'
  | 'classic'
  | 'dark'
  | 'highContrast';

/** Site (UI) theme identifiers (sidebar + toolbar). */
export type SiteThemeId = 'light' | 'dark';
