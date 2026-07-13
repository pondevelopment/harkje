import { Injectable } from '@angular/core';
import * as d3 from 'd3';
import { LayoutDirection, OrgNode } from '../models/org.types';

/**
 * Layout engine interface: rectangle bounds used for link routing.
 */
export interface LayoutRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  treeWidth: number;
  treeHeight: number;
}

/** Layout configuration constants (compact mode). */
export const CARD_WIDTH = 180;
export const CARD_HEIGHT = 74;
export const GAP_H = 20;
export const GAP_V = 48;
export const GRID_GAP = 12;
export const CHANNEL_WIDTH = 30;

const COMPACTION_MIN_GAP = 2;
const PHYSICS_EPSILON = 0.25;

const LINK_CARD_PADDING = 4;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pure layout engine. Extracted verbatim from the React `OrgChart.tsx`
 * component so it has no DOM or Angular dependencies. All functions operate
 * on `d3.HierarchyNode<OrgNode>` instances mutated in place (x/y positions).
 */
@Injectable({ providedIn: 'root' })
export class OrgLayoutService {
  segmentIntersectsRect(
    rect: { left: number; right: number; top: number; bottom: number },
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    pad: number,
  ): boolean {
    const left = rect.left - pad;
    const right = rect.right + pad;
    const top = rect.top - pad;
    const bottom = rect.bottom + pad;

    // Horizontal segment
    if (y1 === y2) {
      const y = y1;
      const segLeft = Math.min(x1, x2);
      const segRight = Math.max(x1, x2);
      if (y < top || y > bottom) return false;
      return !(segRight < left || segLeft > right);
    }

    // Vertical segment
    if (x1 === x2) {
      const x = x1;
      const segTop = Math.min(y1, y2);
      const segBottom = Math.max(y1, y2);
      if (x < left || x > right) return false;
      return !(segBottom < top || segTop > bottom);
    }

    // Only axis-aligned segments are used.
    return false;
  }

  computeRectsAndBounds(root: d3.HierarchyNode<OrgNode>): {
    rects: LayoutRect[];
    bounds: LayoutBounds;
  } {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const rects: LayoutRect[] = [];

    root.each((d: any) => {
      const left = d.x - CARD_WIDTH / 2;
      const right = d.x + CARD_WIDTH / 2;
      const top = d.y;
      const bottom = d.y + CARD_HEIGHT;
      rects.push({ id: String(d.data.id), left, right, top, bottom });
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });

    const treeWidth = maxX - minX;
    const treeHeight = maxY - minY;
    const bounds: LayoutBounds = { minX, maxX, minY, maxY, treeWidth, treeHeight };
    return { rects, bounds };
  }

  findClearHorizontalY(
    baseY: number,
    sx: number,
    tx: number,
    sy: number,
    ty: number,
    rects: LayoutRect[],
    excludeIds: Set<string>,
  ): number | null {
    const minY = Math.min(sy, ty) + 2;
    const maxY = Math.max(sy, ty) - 2;
    const clampedBase = Math.max(minY, Math.min(baseY, maxY));
    const step = 6;
    const maxSteps = 40;

    const isClear = (y: number): boolean => {
      for (const r of rects) {
        if (excludeIds.has(r.id)) continue;
        if (this.segmentIntersectsRect(r, sx, y, tx, y, LINK_CARD_PADDING)) return false;
        if (this.segmentIntersectsRect(r, sx, sy, sx, y, LINK_CARD_PADDING)) return false;
        if (this.segmentIntersectsRect(r, tx, y, tx, ty, LINK_CARD_PADDING)) return false;
      }
      return true;
    };

    if (isClear(clampedBase)) return clampedBase;
    for (let k = 1; k <= maxSteps; k++) {
      const yUp = clampedBase - k * step;
      if (yUp >= minY && isClear(yUp)) return yUp;
      const yDown = clampedBase + k * step;
      if (yDown <= maxY && isClear(yDown)) return yDown;
    }
    return null;
  }

  buildLinkPath(
    d: any,
    rects: LayoutRect[],
    bounds: { minX: number; maxX: number },
  ): string {
    const source = d.source;
    const target = d.target;
    const sx = source.x;
    const sy = source.y + CARD_HEIGHT;
    const tx = target.x;
    const ty = target.y;

    if (Math.abs(sx - tx) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`;

    const baseY = ty - Math.max(LINK_CARD_PADDING + 2, Math.min(GRID_GAP, GAP_V) / 2);
    const exclude = new Set<string>([String(source.data.id), String(target.data.id)]);
    const y = this.findClearHorizontalY(baseY, sx, tx, sy, ty, rects, exclude);
    if (y !== null) {
      return `M ${sx} ${sy} L ${sx} ${y} L ${tx} ${y} L ${tx} ${ty}`;
    }

    // Guaranteed fallback: route outside the layout bounds (left gutter).
    const gutterX = bounds.minX - 24;
    const y1 = sy + 2;
    const y2 = ty - 2;
    return `M ${sx} ${sy} L ${sx} ${y1} L ${gutterX} ${y1} L ${gutterX} ${y2} L ${tx} ${y2} L ${tx} ${ty}`;
  }

  /**
   * One pass of constrained compaction (PAVA / isotonic regression per depth
   * band). Mutates node positions in place. Caller runs multiple frames.
   */
  compactLayoutOneShot(
    root: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
  ): void {
    const axisKey: 'x' | 'y' = direction === LayoutDirection.LeftRight ? 'y' : 'x';
    const minDistWithinGroup =
      (axisKey === 'x' ? CARD_WIDTH : CARD_HEIGHT) + COMPACTION_MIN_GAP;

    const extentMin = (pos: number) => (axisKey === 'x' ? pos - CARD_WIDTH / 2 : pos);
    const extentMax = (pos: number) =>
      axisKey === 'x' ? pos + CARD_WIDTH / 2 : pos + CARD_HEIGHT;

    type HNode = d3.HierarchyNode<OrgNode> & any;
    const descendants = root.descendants() as HNode[];
    const maxDepth = descendants.reduce((m, d) => Math.max(m, d.depth ?? 0), 0);

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nodesAtDepth = descendants.filter((d) => (d.depth ?? 0) === depth);
      if (nodesAtDepth.length === 0) continue;

      const groupsByParent = new Map<string, HNode[]>();
      nodesAtDepth.forEach((d) => {
        const pid = d.parent?.data?.id ? String(d.parent.data.id) : '__no_parent__';
        const arr = groupsByParent.get(pid) ?? [];
        arr.push(d);
        groupsByParent.set(pid, arr);
      });

      const groupIds = Array.from(groupsByParent.keys());
      groupIds.sort((a, b) => {
        const aNodes = groupsByParent.get(a)!;
        const bNodes = groupsByParent.get(b)!;
        const ax = (aNodes[0]?.parent?.[axisKey] ?? 0) as number;
        const bx = (bNodes[0]?.parent?.[axisKey] ?? 0) as number;
        if (ax !== bx) return ax - bx;
        return a.localeCompare(b);
      });

      const ordered: HNode[] = [];
      for (const pid of groupIds) {
        const group = groupsByParent.get(pid)!;
        group.sort((a: any, b: any) => {
          const da = (a[axisKey] ?? 0) as number;
          const db = (b[axisKey] ?? 0) as number;
          if (da !== db) return da - db;
          return String(a.data.id).localeCompare(String(b.data.id));
        });
        ordered.push(...group);
      }

      if (ordered.length <= 1) {
        const n = ordered[0];
        if (n) {
          const parentAxis = (n.parent?.[axisKey] ?? (n[axisKey] ?? 0)) as number;
          n[axisKey] = (n[axisKey] ?? 0) * 0.15 + parentAxis * 0.85;
        }
        continue;
      }

      const minDist = minDistWithinGroup;
      const desired = ordered.map((n) => {
        const cur = (n[axisKey] ?? 0) as number;
        const parentAxis = (n.parent?.[axisKey] ?? cur) as number;
        let childrenMean: number | null = null;
        if (n.children && n.children.length > 0) {
          const childAxes = n.children
            .map((c: any) => (c?.[axisKey] ?? null) as number | null)
            .filter((v: number | null): v is number => v !== null && Number.isFinite(v));
          if (childAxes.length > 0) {
            childrenMean = childAxes.reduce((a: number, b: number) => a + b, 0) / childAxes.length;
          }
        }
        const childTarget = childrenMean ?? parentAxis;
        return parentAxis * 0.65 + childTarget * 0.3 + cur * 0.05;
      });

      const t = desired.map((d, i) => d - i * minDist);
      const w = ordered.map(() => 1);

      type Block = { start: number; end: number; wSum: number; mean: number };
      const blocks: Block[] = [];

      for (let i = 0; i < t.length; i++) {
        let block: Block = { start: i, end: i, wSum: w[i]!, mean: t[i]! };
        blocks.push(block);
        while (blocks.length >= 2) {
          const b2 = blocks[blocks.length - 1]!;
          const b1 = blocks[blocks.length - 2]!;
          if (b1.mean <= b2.mean) break;
          const wSum = b1.wSum + b2.wSum;
          const mean = (b1.mean * b1.wSum + b2.mean * b2.wSum) / wSum;
          blocks.splice(blocks.length - 2, 2, { start: b1.start, end: b2.end, wSum, mean });
        }
      }

      const q: number[] = new Array(t.length);
      for (const b of blocks) {
        for (let i = b.start; i <= b.end; i++) q[i] = b.mean;
      }

      const x = q.map((qi, i) => qi + i * minDist);

      for (let i = 0; i < ordered.length; i++) {
        ordered[i]![axisKey] = x[i]!;
      }

      const depthCenter =
        (Math.min(...x.map(extentMin)) + Math.max(...x.map(extentMax))) / 2;
      const parents = ordered.map((n) => (n.parent?.[axisKey] ?? 0) as number);
      const parentCenter =
        parents.length > 0
          ? (Math.min(...parents) + Math.max(...parents)) / 2
          : depthCenter;
      const shift = (parentCenter - depthCenter) * 0.8;
      if (Number.isFinite(shift) && Math.abs(shift) > 0.01) {
        for (const n of ordered) {
          n[axisKey] = (n[axisKey] ?? 0) + shift;
        }
      }
    }
  }

  /** Epsilon used to detect compaction convergence. */
  readonly physicsEpsilon = PHYSICS_EPSILON;

  /**
   * Hybrid layout engine: computes subtree sizes bottom-up (choosing row/grid/
   * wrap layout by aspect ratio + leaf count), then positions top-down with
   * symmetric channel splitting for grid/wrap nodes. Mutates node x/y in place.
   */
  computeBalancedLayout(
    root: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
    targetAspectRatio: number,
  ): void {
    // 1. Post-Order Traversal (Bottom-Up): Calculate subtree sizes and configs
    root.eachAfter((node: any) => {
      const children = node.children;
      if (!children || children.length === 0) {
        node._w = CARD_WIDTH;
        node._h = CARD_HEIGHT;
        node._layout = 'leaf';
        return;
      }

      const allChildrenAreLeaves = children.every(
        (c: any) => !c.children || c.children.length === 0,
      );
      let layoutType = 'row';
      let rows: any[][] = [];

      if (allChildrenAreLeaves && children.length > 3) {
        layoutType = 'grid';
        const count = children.length;
        const cols = Math.ceil(Math.sqrt(count * (CARD_WIDTH / CARD_HEIGHT)));
        for (let i = 0; i < count; i += cols) {
          rows.push(children.slice(i, i + cols));
        }
      } else {
        let linearW = 0;
        let maxChildH = 0;
        children.forEach((c: any, i: number) => {
          linearW += c._w;
          if (i < children.length - 1) linearW += GAP_H;
          maxChildH = Math.max(maxChildH, c._h);
        });
        const currentRatio = linearW / (CARD_HEIGHT + GAP_V + maxChildH);
        if (currentRatio > targetAspectRatio * 1.5 && children.length >= 3) {
          layoutType = 'wrap';
          const area = linearW * maxChildH;
          const idealWidth = Math.sqrt(area * targetAspectRatio);
          let currentRow: any[] = [];
          let currentRowWidth = 0;
          children.forEach((child: any) => {
            const childW = child._w;
            if (currentRowWidth + childW > idealWidth && currentRow.length > 0) {
              rows.push(currentRow);
              currentRow = [child];
              currentRowWidth = childW;
            } else {
              currentRow.push(child);
              currentRowWidth += childW + (currentRow.length > 0 ? GAP_H : 0);
            }
          });
          if (currentRow.length > 0) rows.push(currentRow);
        } else {
          layoutType = 'row';
        }
      }

      node._layout = layoutType;
      node._rows = rows;

      // Size calculation
      if (layoutType === 'row') {
        let totalW = 0;
        let maxH = 0;
        children.forEach((c: any, i: number) => {
          totalW += c._w;
          if (i < children.length - 1) totalW += GAP_H;
          maxH = Math.max(maxH, c._h);
        });
        node._w = Math.max(CARD_WIDTH, totalW);
        node._h = CARD_HEIGHT + GAP_V + maxH;
      } else {
        let maxRowW = 0;
        let totalBlockH = 0;
        rows.forEach((row, rowIndex) => {
          const isLastRow = rowIndex === rows.length - 1;
          if (isLastRow && row.length === 1) {
            maxRowW = Math.max(maxRowW, row[0]._w);
          } else {
            const mid = Math.ceil(row.length / 2);
            const left = row.slice(0, mid);
            const right = row.slice(mid);
            const gap = layoutType === 'grid' ? GRID_GAP : GAP_H;
            let wLeft = 0;
            left.forEach((c: any, i: number) => {
              wLeft += c._w;
              if (i < left.length - 1) wLeft += gap;
            });
            let wRight = 0;
            right.forEach((c: any, i: number) => {
              wRight += c._w;
              if (i < right.length - 1) wRight += gap;
            });
            const distToLeftEdge = wLeft + CHANNEL_WIDTH / 2;
            const distToRightEdge = wRight + CHANNEL_WIDTH / 2;
            const symmetricRowWidth = Math.max(distToLeftEdge, distToRightEdge) * 2;
            maxRowW = Math.max(maxRowW, symmetricRowWidth);
          }
          let rowH = 0;
          row.forEach((c: any) => (rowH = Math.max(rowH, c._h)));
          totalBlockH += rowH;
        });
        totalBlockH += (rows.length - 1) * (layoutType === 'grid' ? GRID_GAP : GAP_V);
        node._w = Math.max(CARD_WIDTH, maxRowW);
        node._h = CARD_HEIGHT + GAP_V + totalBlockH;
      }
    });

    // 2. Pre-Order Traversal (Top-Down): Assign absolute coordinates
    const positionNode = (node: any, x: number, y: number) => {
      node.x = x;
      node.y = y;
      if (!node.children || node.children.length === 0) return;

      if (node._layout === 'row') {
        const children = node.children;
        let totalChildrenWidth = 0;
        children.forEach((c: any, i: number) => {
          totalChildrenWidth += c._w;
          if (i < children.length - 1) totalChildrenWidth += GAP_H;
        });
        let currentX = x - totalChildrenWidth / 2;
        const childY = y + CARD_HEIGHT + GAP_V;
        children.forEach((child: any) => {
          const childX = currentX + child._w / 2;
          positionNode(child, childX, childY);
          currentX += child._w + GAP_H;
        });
      } else {
        let currentY = y + CARD_HEIGHT + GAP_V;
        const rows = node._rows;
        const gapType = node._layout === 'grid' ? GRID_GAP : GAP_H;
        const vGap = node._layout === 'grid' ? GRID_GAP : GAP_V;

        rows.forEach((row: any[], rowIndex: number) => {
          let rowH = 0;
          row.forEach((c) => (rowH = Math.max(rowH, c._h)));
          const isLastRow = rowIndex === rows.length - 1;

          if (isLastRow && row.length === 1) {
            const child = row[0];
            positionNode(child, x, currentY);
          } else {
            const mid = Math.ceil(row.length / 2);
            const leftGroup = row.slice(0, mid);
            const rightGroup = row.slice(mid);
            let wLeft = 0;
            leftGroup.forEach((c: any, i: number) => {
              wLeft += c._w;
              if (i < leftGroup.length - 1) wLeft += gapType;
            });
            let leftStartX = x - CHANNEL_WIDTH / 2 - wLeft;
            leftGroup.forEach((child: any) => {
              const childX = leftStartX + child._w / 2;
              positionNode(child, childX, currentY);
              leftStartX += child._w + gapType;
            });
            let rightStartX = x + CHANNEL_WIDTH / 2;
            rightGroup.forEach((child: any) => {
              const childX = rightStartX + child._w / 2;
              positionNode(child, childX, currentY);
              rightStartX += child._w + gapType;
            });
          }
          currentY += rowH + vGap;
        });
      }
    };

    positionNode(root, 0, 0);
  }
}
