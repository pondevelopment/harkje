/**
 * Pluggable layout-algorithm contract + registry.
 *
 * A "layout algorithm" turns a D3 hierarchy into a {@link LayoutResult} and
 * knows how to draw the connector between two linked nodes from the routes
 * produced by that result. Algorithms register themselves in
 * {@link LAYOUT_ALGORITHMS}; the renderer selects one by id via a signal.
 *
 * To plug in a new algorithm:
 *   1. Implement {@link OrgLayoutAlgorithm} (a class decorated with
 *      `@Injectable({ providedIn: 'root' })` or a plain object literal).
 *   2. Add a {@link LayoutAlgorithmDescriptor} entry to {@link LAYOUT_ALGORITHMS}.
 * That's it — the toolbar dropdown and renderer pick it up automatically.
 */

import * as d3 from 'd3';
import {
  LayoutAlgorithmId,
  LayoutDirection,
  LayoutPoint,
  LayoutResult,
  OrgNode,
} from '../models/org.types';

/** A node with physical layout coordinates written by an algorithm. */
export type PositionedNode = d3.HierarchyNode<OrgNode> & {
  x: number;
  y: number;
};

/**
 * Contract every layout algorithm must satisfy.
 *
 * Implementations MUST mutate `node.x` / `node.y` on every descendant of
 * `root` (D3's `HierarchyNode` allows arbitrary properties). The returned
 * {@link LayoutResult.routes} map is keyed by the algorithm's link key and
 * consumed by {@link buildLinkRoute} / {@link buildLinkPath}.
 */
export interface OrgLayoutAlgorithm {
  /** Stable id used by the registry, signal, and toolbar dropdown. */
  readonly id: LayoutAlgorithmId;

  /**
   * Compute the layout for the given (possibly collapse-pruned) hierarchy.
   *
   * @param root            D3 hierarchy root; descendants' `x`/`y` are written.
   * @param direction       TopDown or LeftRight.
   * @param targetAspectRatio Desired content aspect ratio; algorithms that
   *   don't optimize for ratio may clamp/ignore it.
   * @returns The layout result (bounds, routes, rowsByParent, signature, ...).
   */
  computeLayout(
    root: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
    targetAspectRatio: number,
  ): LayoutResult;

  /**
   * Resolve the route points for a single link from the routes map produced
   * by {@link computeLayout}. Defaults delegate to the shared helper.
   */
  buildLinkRoute(
    link: d3.HierarchyLink<OrgNode>,
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): LayoutPoint[];

  /**
   * Resolve a connector path ('d' attribute) for a single link. Defaults
   * delegate to the shared helper.
   */
  buildLinkPath(
    link: d3.HierarchyLink<OrgNode>,
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): string;
}

/** Registry entry describing a selectable layout algorithm. */
export interface LayoutAlgorithmDescriptor {
  readonly id: LayoutAlgorithmId;
  /** Human-readable label shown in the toolbar dropdown. */
  readonly label: string;
  readonly algorithm: OrgLayoutAlgorithm;
}

/**
 * Ordered list of all available layout algorithms. The first entry is the
 * default. Add new algorithms here to make them selectable in the UI.
 *
 * NOTE: The registrations themselves live in
 * `src/app/core/org-layout-algorithms.registry.ts` (split out to avoid a
 * circular import). Until that registry module has been imported, this array
 * is empty; callers should use {@link getLayoutAlgorithm} (which falls back to
 * the first registered entry) rather than indexing directly.
 */
export const LAYOUT_ALGORITHMS: LayoutAlgorithmDescriptor[] = [];

/**
 * Register a layout algorithm. Called once per algorithm at module load.
 * Throws if a duplicate id is registered.
 */
export function registerLayoutAlgorithm(descriptor: LayoutAlgorithmDescriptor): void {
  if (LAYOUT_ALGORITHMS.some((entry) => entry.id === descriptor.id)) {
    throw new Error(`Duplicate layout algorithm id: ${descriptor.id}`);
  }
  LAYOUT_ALGORITHMS.push(descriptor);
}

/** Look up a registered algorithm by id, falling back to the first entry. */
export function getLayoutAlgorithm(id: string): OrgLayoutAlgorithm {
  return (
    LAYOUT_ALGORITHMS.find((entry) => entry.id === id)?.algorithm ??
    LAYOUT_ALGORITHMS[0]!.algorithm
  );
}

/** Default algorithm id (first registered entry). Safe to call after registration. */
export function defaultLayoutAlgorithmId(): LayoutAlgorithmId {
  return LAYOUT_ALGORITHMS[0]!.id;
}

/** Descriptors for the toolbar dropdown (id + label). Safe to call after registration. */
export function layoutAlgorithmOptions(): readonly {
  id: LayoutAlgorithmId;
  label: string;
}[] {
  return LAYOUT_ALGORITHMS.map(({ id, label }) => ({ id, label }));
}
