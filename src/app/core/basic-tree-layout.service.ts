/**
 * "Basic" layout algorithm — a simple deterministic subtree layout that proves
 * the {@link OrgLayoutAlgorithm} plug-in contract.
 *
 * Strategy: each level of the hierarchy is placed on its own horizontal band
 * (TopDown) or vertical column (LeftRight). Siblings are laid out
 * breadth-first from left to right, each subtree allocated the width it needs.
 * This produces a readable, predictable tree without the ratio-aware
 * optimization of the adaptive solver — useful as a baseline and a fallback.
 */

import * as d3 from 'd3';
import {
  LayoutAlgorithmId,
  LayoutBounds,
  LayoutDirection,
  LayoutPoint,
  LayoutResult,
  OrgNode,
} from '../models/org.types';
import { OrgLayoutAlgorithm } from './org-layout-algorithm';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_TARGET_ASPECT_RATIO,
  EXPORT_PADDING,
  GAP_H,
  GAP_V,
} from './adaptive-org-layout.service';

type HierarchyNode = d3.HierarchyNode<OrgNode>;
type PositionedNode = HierarchyNode & { x: number; y: number };

const DEFAULT_ID: LayoutAlgorithmId = 'basic';

/** Shared link key for routes (source->target). */
function linkKey(source: HierarchyNode, target: HierarchyNode): string {
  return `${source.data.id}->${target.data.id}`;
}

/**
 * Basic deterministic subtree layout.
 *
 * Siblings wrap into rows of at most {@link MAX_SIBLINGS_PER_ROW} to keep
 * wide trees from exceeding the viewport; wrapped rows advance by one
 * card-height + gap. The layout ignores `targetAspectRatio` (clamped to 1
 * for the frame) — it is intentionally not ratio-aware.
 */
export class BasicTreeLayoutService implements OrgLayoutAlgorithm {
  readonly id: LayoutAlgorithmId = DEFAULT_ID;

  /** Maximum siblings placed on a single row before wrapping to the next row. */
  static readonly MAX_SIBLINGS_PER_ROW = 4;

  computeLayout(
    root: HierarchyNode,
    direction: LayoutDirection,
    targetAspectRatio: number = DEFAULT_TARGET_ASPECT_RATIO,
  ): LayoutResult {
    // Assign absolute logical coordinates: _breadth (center along the
    // sibling axis) and _depth (level index). The root is centered at 0.
    this.layoutSubtree(root, 0, 0);

    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    root.eachAfter((node) => {
      const positioned = node as PositionedNode;
      const breadth = (positioned as PositionedNode & { _breadth?: number })._breadth ?? 0;
      const level = (positioned as PositionedNode & { _depth?: number })._depth ?? 0;
      const depth = level * (cardDepth + GAP_V);
      if (direction === LayoutDirection.LeftRight) {
        positioned.x = depth;
        positioned.y = breadth;
      } else {
        positioned.x = breadth;
        positioned.y = depth;
      }
    });

    const { bounds } = this.computeBounds(root);
    const routes = this.buildRoutes(root, direction);
    const rowsByParent = this.collectRowsByParent(root);
    const target = this.clampTargetRatio(targetAspectRatio);

    return {
      bounds,
      frameBounds: this.computeFrameBounds(bounds, target),
      routes,
      rowsByParent,
      targetAspectRatio: target,
      achievedAspectRatio: bounds.treeWidth / bounds.treeHeight,
      signature: this.signature(root, direction),
      candidateCount: 1,
    };
  }

  buildLinkRoute(
    link: d3.HierarchyLink<OrgNode>,
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): LayoutPoint[] {
    const route = routes.get(linkKey(link.source, link.target));
    return route ? route.map((point) => ({ ...point })) : [];
  }

  buildLinkPath(
    link: d3.HierarchyLink<OrgNode>,
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): string {
    return this.buildLinkRoute(link, routes)
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }

  // --- core solver ---------------------------------------------------------

  /**
   * Recursively assign absolute logical coordinates to every node.
   *
   * @param node        current node.
   * @param breadthCenter center of this node along the sibling axis.
   * @param level       depth level (root = 0); physical y/x = level * (cardDepth + GAP_V).
   * @returns total breadth (width) consumed by this subtree.
   */
  private layoutSubtree(
    node: HierarchyNode,
    breadthCenter: number,
    level: number,
  ): number {
    const positioned = node as PositionedNode & { _breadth?: number; _depth?: number };
    positioned._breadth = breadthCenter;
    positioned._depth = level;

    const children = node.children ?? [];
    if (children.length === 0) {
      return CARD_WIDTH;
    }

    const maxPerRow = BasicTreeLayoutService.MAX_SIBLINGS_PER_ROW;
    const rows: HierarchyNode[][] = [];
    for (let i = 0; i < children.length; i += maxPerRow) {
      rows.push(children.slice(i, i + maxPerRow));
    }

    // First pass: measure each child subtree's breadth (centered at 0 for now).
    // We need the widths before we can place rows relative to the parent.
    const childWidths = children.map(
      (child) => this.layoutSubtree(child, 0, level + 1),
    );

    // Place rows. Wrapped rows stack downward (each adds one extra level), so
    // a child in row r sits at level (level + 1 + r). The parent's siblings see
    // only the bounding breadth of this node's subtree.
    let maxRowBreadth = 0;
    for (const row of rows) {
      const rowWidth =
        row.reduce((sum, child) => sum + childWidths[children.indexOf(child)]!, 0) +
        (row.length - 1) * GAP_H;
      if (rowWidth > maxRowBreadth) maxRowBreadth = rowWidth;
      // Lay out this row left-to-right, centered on breadthCenter.
      let cursor = breadthCenter - rowWidth / 2;
      for (const child of row) {
        const childWidth = childWidths[children.indexOf(child)]!;
        const childCenter = cursor + childWidth / 2;
        const rowOffset = rows.indexOf(row);
        this.placeChild(child, childCenter, level + 1 + rowOffset);
        cursor += childWidth + GAP_H;
      }
    }

    return Math.max(CARD_WIDTH, maxRowBreadth);
  }

  /**
   * Re-assign a child subtree's center breadth and base level, recomputing its
   * descendants' coordinates relative to the new placement. Called when a row
   * is positioned, after the initial measurement pass.
   *
   * Because {@link layoutSubtree} already wrote coordinates for the child's
   * subtree (centered at 0), we translate every descendant by the delta from
   * the child's old center (0) to `newCenter`, and shift levels by
   * `levelDelta`.
   */
  private placeChild(
    child: HierarchyNode,
    newCenter: number,
    newLevel: number,
  ): void {
    const positionedChild = child as PositionedNode & {
      _breadth?: number;
      _depth?: number;
    };
    const oldCenter = positionedChild._breadth ?? 0;
    const oldLevel = positionedChild._depth ?? 0;
    const breadthDelta = newCenter - oldCenter;
    const levelDelta = newLevel - oldLevel;
    child.eachAfter((node) => {
      const positioned = node as PositionedNode & {
        _breadth?: number;
        _depth?: number;
      };
      positioned._breadth = (positioned._breadth ?? 0) + breadthDelta;
      positioned._depth = (positioned._depth ?? 0) + levelDelta;
    });
  }

  // --- helpers -------------------------------------------------------------

  private computeBounds(root: HierarchyNode): { bounds: LayoutBounds } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    root.each((node) => {
      const positioned = node as PositionedNode;
      const left = positioned.x - CARD_WIDTH / 2;
      const right = positioned.x + CARD_WIDTH / 2;
      const top = positioned.y;
      const bottom = positioned.y + CARD_HEIGHT;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
    });
    return {
      bounds: {
        minX,
        maxX,
        minY,
        maxY,
        treeWidth: maxX - minX,
        treeHeight: maxY - minY,
      },
    };
  }

  private buildRoutes(
    root: HierarchyNode,
    direction: LayoutDirection,
  ): Map<string, LayoutPoint[]> {
    const routes = new Map<string, LayoutPoint[]>();
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    for (const link of root.links()) {
      const source = link.source as PositionedNode;
      const target = link.target as PositionedNode;
      // Orthogonal bus route: parent bottom -> bus -> child top.
      const sourcePort: LayoutPoint = { x: source.x, y: source.y };
      const targetPort: LayoutPoint = { x: target.x, y: target.y };
      const isTopDown = direction === LayoutDirection.TopDown;
      const busCoord = isTopDown
        ? source.y + cardDepth + GAP_V / 2
        : source.x + cardDepth + GAP_V / 2;
      const bus: LayoutPoint = isTopDown
        ? { x: source.x, y: busCoord }
        : { x: busCoord, y: source.y };
      const turn: LayoutPoint = isTopDown
        ? { x: target.x, y: busCoord }
        : { x: busCoord, y: target.y };
      routes.set(linkKey(link.source, link.target), [
        sourcePort,
        bus,
        turn,
        targetPort,
      ]);
    }
    return routes;
  }

  private collectRowsByParent(
    root: HierarchyNode,
  ): Map<string, string[][]> {
    const rowsByParent = new Map<string, string[][]>();
    const maxPerRow = BasicTreeLayoutService.MAX_SIBLINGS_PER_ROW;
    root.each((node) => {
      const children = node.children ?? [];
      if (children.length === 0) return;
      const rows: string[][] = [];
      for (let i = 0; i < children.length; i += maxPerRow) {
        rows.push(children.slice(i, i + maxPerRow).map((child) => String(child.data.id)));
      }
      rowsByParent.set(String(node.data.id), rows);
    });
    return rowsByParent;
  }

  private computeFrameBounds(bounds: LayoutBounds, target: number): LayoutBounds {
    let minX = bounds.minX - EXPORT_PADDING;
    let maxX = bounds.maxX + EXPORT_PADDING;
    let minY = bounds.minY - EXPORT_PADDING;
    let maxY = bounds.maxY + EXPORT_PADDING;
    const width = maxX - minX;
    const height = maxY - minY;
    const current = width / height;
    if (current < target) {
      const extra = (target * height - width) / 2;
      minX -= extra;
      maxX += extra;
    } else if (current > target) {
      const extra = (width / target - height) / 2;
      minY -= extra;
      maxY += extra;
    }
    return { minX, maxX, minY, maxY, treeWidth: maxX - minX, treeHeight: maxY - minY };
  }

  private clampTargetRatio(target: number): number {
    return Math.min(4, Math.max(0.25, target));
  }

  private signature(root: HierarchyNode, direction: LayoutDirection): string {
    const counts: number[] = [];
    root.eachAfter((node) => counts.push((node.children ?? []).length));
    return `B:${direction}[${counts.join('.')}]`;
  }
}
