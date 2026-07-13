import { Injectable } from '@angular/core';
import * as d3 from 'd3';
import { LayoutDirection, OrgNode } from '../models/org.types';

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

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutResult {
  /** Actual bounds of all cards. */
  bounds: LayoutBounds;
  /** Exact target-ratio frame, including at least EXPORT_PADDING on every side. */
  frameBounds: LayoutBounds;
  routes: ReadonlyMap<string, readonly LayoutPoint[]>;
  rowsByParent: ReadonlyMap<string, readonly (readonly string[])[]>;
  targetAspectRatio: number;
  achievedAspectRatio: number;
  signature: string;
  candidateCount: number;
}

export const CARD_WIDTH = 180;
export const CARD_HEIGHT = 74;
export const LEVEL_GAP = 48;
export const MIN_BRANCH_GAP = 12;
export const MAX_BRANCH_GAP = 80;
export const DEFAULT_BRANCH_GAP = 20;
export const MIN_TARGET_ASPECT_RATIO = 0.25;
export const MAX_TARGET_ASPECT_RATIO = 4;
export const DEFAULT_TARGET_ASPECT_RATIO = 1;
export const LINK_CARD_PADDING = 4;
export const EXPORT_PADDING = 40;

const LINK_CHANNEL_WIDTH = 24;
const MAX_VARIANTS_PER_NODE = 32;
const EXHAUSTIVE_PARTITION_CHILD_LIMIT = 8;
const RATIO_TOLERANCE = 0.025;
const ASPECT_PROFILES = [
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  1,
  1.25,
  4 / 3,
  1.5,
  16 / 9,
  2,
  2.5,
  3,
  4,
] as const;

type HierarchyNode = d3.HierarchyNode<OrgNode>;
type PositionedNode = HierarchyNode & { x: number; y: number };

interface LogicalPoint {
  breadth: number;
  depth: number;
}

interface LogicalRect {
  id: string;
  minBreadth: number;
  maxBreadth: number;
  minDepth: number;
  maxDepth: number;
}

interface LayoutVariant {
  placements: Map<HierarchyNode, LogicalPoint>;
  rects: LogicalRect[];
  routes: Map<string, LogicalPoint[]>;
  rowsByParent: Map<string, string[][]>;
  minBreadth: number;
  maxBreadth: number;
  minDepth: number;
  maxDepth: number;
  logicalWidth: number;
  logicalHeight: number;
  physicalWidth: number;
  physicalHeight: number;
  connectorLength: number;
  rowCount: number;
  signature: string;
}

/**
 * Aspect-ratio-aware org-chart layout.
 *
 * The engine generates a bounded frontier of discrete, fixed-gap layouts for
 * every subtree. Target aspect ratio only selects row partitions and child
 * layout variants; it never scales coordinates or changes card/gap constants.
 * Child order is preserved row-major, and every selected child subtree is
 * translated as one rigid block using its real card contours.
 */
@Injectable({ providedIn: 'root' })
export class OrgLayoutService {
  computeTidyLayout(
    root: HierarchyNode,
    direction: LayoutDirection,
    branchGap: number = DEFAULT_BRANCH_GAP,
    targetAspectRatio: number = DEFAULT_TARGET_ASPECT_RATIO,
  ): LayoutResult {
    const safeGap = this.clampBranchGap(branchGap);
    const target = this.clampTargetRatio(targetAspectRatio);
    const variants = this.buildVariants(root, direction, safeGap, new Map());
    const selected = this.selectVariant(variants, target);

    for (const [node, point] of selected.placements) {
      const positioned = node as PositionedNode;
      if (direction === LayoutDirection.LeftRight) {
        positioned.x = point.depth;
        positioned.y = point.breadth;
      } else {
        positioned.x = point.breadth;
        positioned.y = point.depth;
      }
    }

    const routes = new Map<string, LayoutPoint[]>();
    for (const [key, route] of selected.routes) {
      routes.set(
        key,
        route.map((point) => this.toPhysicalPoint(point, direction)),
      );
    }

    const { bounds } = this.computeRectsAndBounds(root);
    return {
      bounds,
      frameBounds: this.computeFrameBounds(bounds, target),
      routes,
      rowsByParent: selected.rowsByParent,
      targetAspectRatio: target,
      achievedAspectRatio: bounds.treeWidth / bounds.treeHeight,
      signature: selected.signature,
      candidateCount: variants.length,
    };
  }

  computeRectsAndBounds(root: HierarchyNode): {
    rects: LayoutRect[];
    bounds: LayoutBounds;
  } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const rects: LayoutRect[] = [];

    root.each((node) => {
      const positioned = node as PositionedNode;
      const left = positioned.x - CARD_WIDTH / 2;
      const right = positioned.x + CARD_WIDTH / 2;
      const top = positioned.y;
      const bottom = positioned.y + CARD_HEIGHT;
      rects.push({ id: String(node.data.id), left, right, top, bottom });
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
    });

    return {
      rects,
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

  buildLinkRoute(
    link: d3.HierarchyLink<OrgNode>,
    direction: LayoutDirection,
    routes?: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): LayoutPoint[] {
    const stored = routes?.get(this.linkKey(link.source, link.target));
    if (stored) return stored.map((point) => ({ ...point }));

    // Compatibility fallback for callers that position a strict tree manually.
    const source = link.source as PositionedNode;
    const target = link.target as PositionedNode;
    if (direction === LayoutDirection.LeftRight) {
      const sourceX = source.x + CARD_WIDTH / 2;
      const sourceY = source.y + CARD_HEIGHT / 2;
      const targetX = target.x - CARD_WIDTH / 2;
      const targetY = target.y + CARD_HEIGHT / 2;
      if (Math.abs(sourceY - targetY) < 0.001) {
        return [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
      }
      const channelX = (sourceX + targetX) / 2;
      return [
        { x: sourceX, y: sourceY },
        { x: channelX, y: sourceY },
        { x: channelX, y: targetY },
        { x: targetX, y: targetY },
      ];
    }

    const sourceX = source.x;
    const sourceY = source.y + CARD_HEIGHT;
    const targetX = target.x;
    const targetY = target.y;
    if (Math.abs(sourceX - targetX) < 0.001) {
      return [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
    }
    const channelY = (sourceY + targetY) / 2;
    return [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: channelY },
      { x: targetX, y: channelY },
      { x: targetX, y: targetY },
    ];
  }

  buildLinkPath(
    link: d3.HierarchyLink<OrgNode>,
    direction: LayoutDirection,
    routes?: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): string {
    return this.buildLinkRoute(link, direction, routes)
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }

  private buildVariants(
    node: HierarchyNode,
    direction: LayoutDirection,
    branchGap: number,
    memo: Map<HierarchyNode, LayoutVariant[]>,
  ): LayoutVariant[] {
    const cached = memo.get(node);
    if (cached) return cached;

    const cardBreadth = direction === LayoutDirection.LeftRight ? CARD_HEIGHT : CARD_WIDTH;
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    const children = node.children ?? [];
    if (children.length === 0) {
      const leaf = this.finalizeVariant(
        {
          placements: new Map([[node, { breadth: 0, depth: 0 }]]),
          rects: [{
            id: String(node.data.id),
            minBreadth: -cardBreadth / 2,
            maxBreadth: cardBreadth / 2,
            minDepth: 0,
            maxDepth: cardDepth,
          }],
          routes: new Map(),
          rowsByParent: new Map(),
          connectorLength: 0,
          rowCount: 0,
          signature: `L:${node.data.id}`,
        },
        direction,
      );
      memo.set(node, [leaf]);
      return [leaf];
    }

    const childFrontiers = children.map((child) =>
      this.buildVariants(child, direction, branchGap, memo),
    );
    const selections = this.buildChildSelections(childFrontiers);
    const generated: LayoutVariant[] = [];

    for (const selectedChildren of selections) {
      const partitions = this.generatePartitions(selectedChildren, direction);
      for (const partition of partitions) {
        generated.push(
          this.composeVariant(
            node,
            selectedChildren,
            partition,
            direction,
            branchGap,
          ),
        );
      }
    }

    const variants = this.pruneVariants(generated);
    memo.set(node, variants);
    return variants;
  }

  private buildChildSelections(frontiers: LayoutVariant[][]): LayoutVariant[][] {
    const selections = new Map<string, LayoutVariant[]>();
    const add = (variants: LayoutVariant[]) => {
      const key = variants.map((variant) => variant.signature).join('\u0001');
      if (!selections.has(key)) selections.set(key, variants);
    };

    for (const profile of ASPECT_PROFILES) {
      add(frontiers.map((frontier) => this.selectVariant(frontier, profile)));
    }
    add(frontiers.map((frontier) => this.minVariant(frontier, (variant) =>
      variant.physicalWidth * variant.physicalHeight,
    )));
    add(frontiers.map((frontier) => this.minVariant(frontier, (variant) =>
      variant.physicalWidth,
    )));
    add(frontiers.map((frontier) => this.minVariant(frontier, (variant) =>
      variant.physicalHeight,
    )));

    return Array.from(selections.values());
  }

  /** Partition child indexes into contiguous rows; source order is immutable. */
  private generatePartitions(
    variants: LayoutVariant[],
    direction: LayoutDirection,
  ): number[][][] {
    const count = variants.length;
    if (count <= 1) return [[[0]]];

    const partitions = new Map<string, number[][]>();
    const add = (rows: number[][]) => {
      const key = rows.map((row) => row.length).join(',');
      if (!partitions.has(key)) partitions.set(key, rows);
    };

    if (count <= EXHAUSTIVE_PARTITION_CHILD_LIMIT) {
      const breakCount = count - 1;
      for (let mask = 0; mask < 2 ** breakCount; mask++) {
        const rows: number[][] = [[]];
        for (let index = 0; index < count; index++) {
          rows[rows.length - 1]!.push(index);
          if (index < count - 1 && (mask & (1 << index)) !== 0) rows.push([]);
        }
        add(rows);
      }
      return Array.from(partitions.values());
    }

    add([Array.from({ length: count }, (_, index) => index)]);
    add(Array.from({ length: count }, (_, index) => [index]));
    const maxRows = Math.min(8, count - 1);
    for (let rowCount = 2; rowCount <= maxRows; rowCount++) {
      add(this.partitionByCount(count, rowCount));
      add(this.partitionByBreadth(variants, rowCount, direction));
    }
    return Array.from(partitions.values());
  }

  private partitionByCount(count: number, rowCount: number): number[][] {
    const rows: number[][] = [];
    let start = 0;
    for (let row = 0; row < rowCount; row++) {
      const remaining = count - start;
      const rowsLeft = rowCount - row;
      const size = Math.ceil(remaining / rowsLeft);
      rows.push(Array.from({ length: size }, (_, offset) => start + offset));
      start += size;
    }
    return rows;
  }

  private partitionByBreadth(
    variants: LayoutVariant[],
    rowCount: number,
    direction: LayoutDirection,
  ): number[][] {
    const logicalBreadths = variants.map((variant) =>
      direction === LayoutDirection.LeftRight
        ? variant.physicalHeight
        : variant.physicalWidth,
    );
    const target = logicalBreadths.reduce((sum, width) => sum + width, 0) / rowCount;
    const rows: number[][] = [];
    let current: number[] = [];
    let currentWidth = 0;
    for (let index = 0; index < variants.length; index++) {
      const rowsLeftAfterThis = rowCount - rows.length - 1;
      const childrenAfterThis = variants.length - index - 1;
      const width = logicalBreadths[index]!;
      if (
        current.length > 0 &&
        rows.length < rowCount - 1 &&
        currentWidth + width > target &&
        childrenAfterThis >= rowsLeftAfterThis
      ) {
        rows.push(current);
        current = [];
        currentWidth = 0;
      }
      current.push(index);
      currentWidth += width;
    }
    if (current.length > 0) rows.push(current);
    while (rows.length < rowCount) {
      const donor = rows.findIndex((row) => row.length > 1);
      if (donor < 0) break;
      const moved = rows[donor]!.pop()!;
      rows.splice(donor + 1, 0, [moved]);
    }
    return rows;
  }

  private composeVariant(
    node: HierarchyNode,
    children: LayoutVariant[],
    rowIndexes: number[][],
    direction: LayoutDirection,
    branchGap: number,
  ): LayoutVariant {
    const cardBreadth = direction === LayoutDirection.LeftRight ? CARD_HEIGHT : CARD_WIDTH;
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    const placements = new Map<HierarchyNode, LogicalPoint>([[node, { breadth: 0, depth: 0 }]]);
    const rects: LogicalRect[] = [{
      id: String(node.data.id),
      minBreadth: -cardBreadth / 2,
      maxBreadth: cardBreadth / 2,
      minDepth: 0,
      maxDepth: cardDepth,
    }];
    const routes = new Map<string, LogicalPoint[]>();
    const rowsByParent = new Map<string, string[][]>();
    const childRows = rowIndexes.map((row) =>
      row.map((index) => String((node.children ?? [])[index]!.data.id)),
    );
    rowsByParent.set(String(node.data.id), childRows);

    let rowTop = cardDepth + LEVEL_GAP;
    let connectorLength = 0;
    let nestedRowCount = 0;

    for (let rowIndex = 0; rowIndex < rowIndexes.length; rowIndex++) {
      const indexes = rowIndexes[rowIndex]!;
      const rowVariants = indexes.map((index) => children[index]!);
      const requiresThroughChannel = rowIndex < rowIndexes.length - 1;
      const offsets = this.packRow(
        rowVariants,
        branchGap,
        requiresThroughChannel,
      );
      let rowHeight = 0;

      for (let localIndex = 0; localIndex < indexes.length; localIndex++) {
        const childIndex = indexes[localIndex]!;
        const childNode = (node.children ?? [])[childIndex]!;
        const child = children[childIndex]!;
        const breadthOffset = offsets[localIndex]!;
        rowHeight = Math.max(rowHeight, child.logicalHeight);
        nestedRowCount += child.rowCount;
        connectorLength += child.connectorLength;

        for (const [placedNode, point] of child.placements) {
          placements.set(placedNode, {
            breadth: point.breadth + breadthOffset,
            depth: point.depth + rowTop,
          });
        }
        for (const rect of child.rects) {
          rects.push({
            ...rect,
            minBreadth: rect.minBreadth + breadthOffset,
            maxBreadth: rect.maxBreadth + breadthOffset,
            minDepth: rect.minDepth + rowTop,
            maxDepth: rect.maxDepth + rowTop,
          });
        }
        for (const [key, route] of child.routes) {
          routes.set(key, route.map((point) => ({
            breadth: point.breadth + breadthOffset,
            depth: point.depth + rowTop,
          })));
        }
        for (const [parentId, rows] of child.rowsByParent) {
          rowsByParent.set(parentId, rows.map((row) => [...row]));
        }

        const source = { breadth: 0, depth: cardDepth };
        const target = { breadth: breadthOffset, depth: rowTop };
        const route = this.parentChildRoute(source, target);
        routes.set(this.linkKey(node, childNode), route);
        connectorLength += this.routeLength(route);
      }

      rowTop += rowHeight + LEVEL_GAP;
    }

    const signature = `N:${node.data.id}[${rowIndexes
      .map((row) => row.length)
      .join('.')}](${children.map((child) => child.signature).join('|')})`;
    return this.finalizeVariant(
      {
        placements,
        rects,
        routes,
        rowsByParent,
        connectorLength,
        rowCount: rowIndexes.length + nestedRowCount,
        signature,
      },
      direction,
    );
  }

  private packRow(
    variants: LayoutVariant[],
    branchGap: number,
    requiresThroughChannel: boolean,
  ): number[] {
    if (variants.length === 1 && !requiresThroughChannel) return [0];
    if (!requiresThroughChannel) {
      const offsets = this.packSequentially(variants, branchGap);
      const center = (offsets[0]! + offsets[offsets.length - 1]!) / 2;
      return offsets.map((offset) => offset - center);
    }

    const split = Math.ceil(variants.length / 2);
    const left = variants.slice(0, split);
    const right = variants.slice(split);
    const channelHalf = Math.max(LINK_CHANNEL_WIDTH, branchGap) / 2;
    const offsets = new Array<number>(variants.length);

    const leftOffsets = this.packSequentially(left, branchGap);
    const leftMax = Math.max(...left.map((variant, index) =>
      leftOffsets[index]! + variant.maxBreadth,
    ));
    const leftShift = -channelHalf - leftMax;
    for (let index = 0; index < left.length; index++) {
      offsets[index] = leftOffsets[index]! + leftShift;
    }

    if (right.length > 0) {
      const rightOffsets = this.packSequentially(right, branchGap);
      const rightMin = Math.min(...right.map((variant, index) =>
        rightOffsets[index]! + variant.minBreadth,
      ));
      const rightShift = channelHalf - rightMin;
      for (let index = 0; index < right.length; index++) {
        offsets[split + index] = rightOffsets[index]! + rightShift;
      }
    }
    return offsets;
  }

  private packSequentially(
    variants: LayoutVariant[],
    branchGap: number,
  ): number[] {
    if (variants.length === 0) return [];
    const offsets = [0];
    const accumulated: LogicalRect[] = variants[0]!.rects.map((rect) => ({ ...rect }));

    for (let index = 1; index < variants.length; index++) {
      const variant = variants[index]!;
      let required = -Infinity;
      for (const leftRect of accumulated) {
        for (const rightRect of variant.rects) {
          if (
            leftRect.minDepth < rightRect.maxDepth - 0.001 &&
            leftRect.maxDepth > rightRect.minDepth + 0.001
          ) {
            required = Math.max(
              required,
              leftRect.maxBreadth + branchGap - rightRect.minBreadth,
            );
          }
        }
      }
      const offset = Number.isFinite(required) ? required : 0;
      offsets.push(offset);
      accumulated.push(...variant.rects.map((rect) => ({
        ...rect,
        minBreadth: rect.minBreadth + offset,
        maxBreadth: rect.maxBreadth + offset,
      })));
    }
    return offsets;
  }

  private parentChildRoute(
    source: LogicalPoint,
    target: LogicalPoint,
  ): LogicalPoint[] {
    if (Math.abs(source.breadth - target.breadth) < 0.001) {
      return [source, target];
    }
    const channelDepth = target.depth - LEVEL_GAP / 2;
    return [
      source,
      { breadth: source.breadth, depth: channelDepth },
      { breadth: target.breadth, depth: channelDepth },
      target,
    ];
  }

  private finalizeVariant(
    partial: Omit<LayoutVariant,
      | 'minBreadth'
      | 'maxBreadth'
      | 'minDepth'
      | 'maxDepth'
      | 'logicalWidth'
      | 'logicalHeight'
      | 'physicalWidth'
      | 'physicalHeight'
    >,
    direction: LayoutDirection,
  ): LayoutVariant {
    const minBreadth = Math.min(...partial.rects.map((rect) => rect.minBreadth));
    const maxBreadth = Math.max(...partial.rects.map((rect) => rect.maxBreadth));
    const minDepth = Math.min(...partial.rects.map((rect) => rect.minDepth));
    const maxDepth = Math.max(...partial.rects.map((rect) => rect.maxDepth));
    const logicalWidth = maxBreadth - minBreadth;
    const logicalHeight = maxDepth - minDepth;
    return {
      ...partial,
      minBreadth,
      maxBreadth,
      minDepth,
      maxDepth,
      logicalWidth,
      logicalHeight,
      physicalWidth: direction === LayoutDirection.LeftRight ? logicalHeight : logicalWidth,
      physicalHeight: direction === LayoutDirection.LeftRight ? logicalWidth : logicalHeight,
    };
  }

  private pruneVariants(variants: LayoutVariant[]): LayoutVariant[] {
    const bySignature = new Map<string, LayoutVariant>();
    for (const variant of variants) bySignature.set(variant.signature, variant);
    const unique = Array.from(bySignature.values());
    if (unique.length <= MAX_VARIANTS_PER_NODE) {
      return unique.sort((a, b) => a.signature.localeCompare(b.signature));
    }

    const kept = new Map<string, LayoutVariant>();
    const add = (variant: LayoutVariant) => kept.set(variant.signature, variant);
    add(this.minVariant(unique, (variant) => variant.physicalWidth * variant.physicalHeight));
    add(this.minVariant(unique, (variant) => variant.physicalWidth));
    add(this.minVariant(unique, (variant) => variant.physicalHeight));
    add(this.minVariant(unique, (variant) => variant.connectorLength));

    for (const profile of ASPECT_PROFILES) {
      const ranked = [...unique].sort((a, b) =>
        this.compareForTarget(a, b, profile),
      );
      for (const variant of ranked.slice(0, 2)) add(variant);
    }

    if (kept.size < MAX_VARIANTS_PER_NODE) {
      const remaining = [...unique].sort((a, b) =>
        (a.physicalWidth * a.physicalHeight) - (b.physicalWidth * b.physicalHeight) ||
        a.signature.localeCompare(b.signature),
      );
      for (const variant of remaining) {
        add(variant);
        if (kept.size >= MAX_VARIANTS_PER_NODE) break;
      }
    }
    return Array.from(kept.values()).sort((a, b) => a.signature.localeCompare(b.signature));
  }

  private selectVariant(variants: LayoutVariant[], target: number): LayoutVariant {
    return [...variants].sort((a, b) => this.compareForTarget(a, b, target))[0]!;
  }

  private compareForTarget(
    a: LayoutVariant,
    b: LayoutVariant,
    target: number,
  ): number {
    const aError = this.ratioError(a, target);
    const bError = this.ratioError(b, target);
    const aWithinTolerance = aError <= RATIO_TOLERANCE;
    const bWithinTolerance = bError <= RATIO_TOLERANCE;
    if (aWithinTolerance !== bWithinTolerance) return aWithinTolerance ? -1 : 1;
    if (!aWithinTolerance && Math.abs(aError - bError) > 1e-9) return aError - bError;

    const aArea = a.physicalWidth * a.physicalHeight;
    const bArea = b.physicalWidth * b.physicalHeight;
    return aArea - bArea ||
      a.connectorLength - b.connectorLength ||
      a.rowCount - b.rowCount ||
      a.signature.localeCompare(b.signature);
  }

  private ratioError(variant: LayoutVariant, target: number): number {
    const ratio = variant.physicalWidth / variant.physicalHeight;
    return Math.abs(Math.log(ratio / target));
  }

  private minVariant(
    variants: LayoutVariant[],
    metric: (variant: LayoutVariant) => number,
  ): LayoutVariant {
    return [...variants].sort((a, b) =>
      metric(a) - metric(b) || a.signature.localeCompare(b.signature),
    )[0]!;
  }

  private toPhysicalPoint(
    point: LogicalPoint,
    direction: LayoutDirection,
  ): LayoutPoint {
    if (direction === LayoutDirection.LeftRight) {
      return {
        x: point.depth - CARD_WIDTH / 2,
        y: point.breadth + CARD_HEIGHT / 2,
      };
    }
    return { x: point.breadth, y: point.depth };
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
    return {
      minX,
      maxX,
      minY,
      maxY,
      treeWidth: maxX - minX,
      treeHeight: maxY - minY,
    };
  }

  private routeLength(route: readonly LogicalPoint[]): number {
    let length = 0;
    for (let index = 1; index < route.length; index++) {
      length += Math.abs(route[index]!.breadth - route[index - 1]!.breadth);
      length += Math.abs(route[index]!.depth - route[index - 1]!.depth);
    }
    return length;
  }

  private linkKey(source: HierarchyNode, target: HierarchyNode): string {
    return `${String(source.data.id)}\u0000${String(target.data.id)}`;
  }

  private clampBranchGap(branchGap: number): number {
    if (!Number.isFinite(branchGap)) return DEFAULT_BRANCH_GAP;
    return Math.max(MIN_BRANCH_GAP, Math.min(MAX_BRANCH_GAP, branchGap));
  }

  private clampTargetRatio(targetAspectRatio: number): number {
    if (!Number.isFinite(targetAspectRatio)) return DEFAULT_TARGET_ASPECT_RATIO;
    return Math.max(
      MIN_TARGET_ASPECT_RATIO,
      Math.min(MAX_TARGET_ASPECT_RATIO, targetAspectRatio),
    );
  }
}