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
  bounds: LayoutBounds;
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
export const GAP_H = 20;
export const GAP_V = 48;
export const MIN_TARGET_ASPECT_RATIO = 0.25;
export const MAX_TARGET_ASPECT_RATIO = 4;
export const DEFAULT_TARGET_ASPECT_RATIO = 1;
export const LINK_CARD_PADDING = 4;
export const EXPORT_PADDING = 40;

const LINK_CHANNEL_WIDTH = GAP_H;
const MAX_VARIANTS_PER_NODE = 32;
const EXHAUSTIVE_PARTITION_CHILD_LIMIT = 8;
const RATIO_TOLERANCE = 0.08;
const ASPECT_PROFILES = [
  0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 4 / 3,
  1.5, 16 / 9, 2, 2.5, 3, 4,
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
  maxPeerBandOffset: number;
  rankInversionCount: number;
  singletonTailCount: number;
  rowImbalance: number;
  signature: string;
}

/**
 * Bounded aspect-ratio-aware layout solver. It selects fixed-gap ordered row
 * variants; target ratio never scales cards, coordinates, or gaps.
 */
@Injectable({ providedIn: 'root' })
export class AdaptiveOrgLayoutService {
  private readonly frontierCache = new WeakMap<
    HierarchyNode,
    Map<LayoutDirection, LayoutVariant[]>
  >();

  computeAdaptiveLayout(
    root: HierarchyNode,
    direction: LayoutDirection,
    targetAspectRatio: number = DEFAULT_TARGET_ASPECT_RATIO,
  ): LayoutResult {
    const target = this.clampTargetRatio(targetAspectRatio);
    let byDirection = this.frontierCache.get(root);
    if (!byDirection) {
      byDirection = new Map();
      this.frontierCache.set(root, byDirection);
    }
    let variants = byDirection.get(direction);
    if (!variants) {
      variants = this.buildVariants(root, direction, new Map());
      byDirection.set(direction, variants);
    }
    const selected = this.selectValidVariant(variants, target);

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
      routes.set(key, route.map((point) => this.toPhysicalPoint(point, direction)));
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
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): LayoutPoint[] {
    const route = routes.get(this.linkKey(link.source, link.target));
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

  private buildVariants(
    node: HierarchyNode,
    direction: LayoutDirection,
    memo: Map<HierarchyNode, LayoutVariant[]>,
  ): LayoutVariant[] {
    const cached = memo.get(node);
    if (cached) return cached;

    const cardBreadth = direction === LayoutDirection.LeftRight ? CARD_HEIGHT : CARD_WIDTH;
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    const children = node.children ?? [];
    if (children.length === 0) {
      const leaf = this.finalizeVariant({
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
          maxPeerBandOffset: 0,
          rankInversionCount: 0,
          singletonTailCount: 0,
          rowImbalance: 0,
        signature: `L:${node.data.id}`,
      }, direction);
      memo.set(node, [leaf]);
      return [leaf];
    }

    const childFrontiers = children.map((child) => this.buildVariants(child, direction, memo));
    const generated: LayoutVariant[] = [];
    for (const selectedChildren of this.buildChildSelections(childFrontiers)) {
      for (const partition of this.generatePartitions(selectedChildren, direction)) {
        const variant = this.composeVariant(node, selectedChildren, partition, direction);
        if (variant) generated.push(variant);
      }
    }

    if (generated.length === 0) {
      throw new Error(`No valid layout candidates for node ${String(node.data.id)}.`);
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
    add(frontiers.map((frontier) => this.minVariant(
      frontier,
      (variant) => variant.physicalWidth * variant.physicalHeight,
    )));
    add(frontiers.map((frontier) => this.minVariant(frontier, (variant) => variant.physicalWidth)));
    add(frontiers.map((frontier) => this.minVariant(frontier, (variant) => variant.physicalHeight)));
    return Array.from(selections.values());
  }

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
      for (let mask = 0; mask < 2 ** (count - 1); mask++) {
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
    for (let rowCount = 2; rowCount <= Math.min(8, count - 1); rowCount++) {
      add(this.partitionByCount(count, rowCount));
      add(this.partitionByBreadth(variants, rowCount, direction));
    }
    return Array.from(partitions.values());
  }

  private partitionByCount(count: number, rowCount: number): number[][] {
    const rows: number[][] = [];
    let start = 0;
    for (let row = 0; row < rowCount; row++) {
      const size = Math.ceil((count - start) / (rowCount - row));
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
    const breadths = variants.map((variant) =>
      direction === LayoutDirection.LeftRight ? variant.physicalHeight : variant.physicalWidth,
    );
    const target = breadths.reduce((sum, breadth) => sum + breadth, 0) / rowCount;
    const rows: number[][] = [];
    let current: number[] = [];
    let currentBreadth = 0;

    for (let index = 0; index < variants.length; index++) {
      const rowsLeftAfterThis = rowCount - rows.length - 1;
      const childrenAfterThis = variants.length - index - 1;
      const breadth = breadths[index]!;
      if (
        current.length > 0 &&
        rows.length < rowCount - 1 &&
        currentBreadth + breadth > target &&
        childrenAfterThis >= rowsLeftAfterThis
      ) {
        rows.push(current);
        current = [];
        currentBreadth = 0;
      }
      current.push(index);
      currentBreadth += breadth;
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
  ): LayoutVariant | null {
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
    rowsByParent.set(
      String(node.data.id),
      rowIndexes.map((row) => row.map((index) => String((node.children ?? [])[index]!.data.id))),
    );

    const rowStep = cardDepth + GAP_V;
    let connectorLength = 0;
    let nestedRowCount = 0;
    let earlierDescendantMaxDepth = -Infinity;
    let ownRankInversions = 0;
    for (let rowIndex = 0; rowIndex < rowIndexes.length; rowIndex++) {
      const rowTop = rowStep + rowIndex * rowStep;
      const indexes = rowIndexes[rowIndex]!;
      const rowVariants = indexes.map((index) => children[index]!);
      const offsets = this.packRowAgainstObstacles(
        rowVariants,
        rowTop,
        rects,
        rowIndex < rowIndexes.length - 1,
        rowIndex,
      );
      if (!offsets) return null;
      let currentRowDescendantMaxDepth = -Infinity;

      for (let localIndex = 0; localIndex < indexes.length; localIndex++) {
        const childIndex = indexes[localIndex]!;
        const childNode = (node.children ?? [])[childIndex]!;
        const child = children[childIndex]!;
        const breadthOffset = offsets[localIndex]!;
        nestedRowCount += child.rowCount;
        connectorLength += child.connectorLength;

        if (
          rowIndex > 0 &&
          Number.isFinite(earlierDescendantMaxDepth) &&
          rowTop >= earlierDescendantMaxDepth - 0.001
        ) {
          ownRankInversions++;
        }

        for (const [placedNode, point] of child.placements) {
          if (placedNode !== childNode) {
            currentRowDescendantMaxDepth = Math.max(
              currentRowDescendantMaxDepth,
              point.depth + rowTop,
            );
          }
        }

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
      earlierDescendantMaxDepth = Math.max(
        earlierDescendantMaxDepth,
        currentRowDescendantMaxDepth,
      );
    }

    const rowLengths = rowIndexes.map((row) => row.length);
    return this.finalizeVariant({
      placements,
      rects,
      routes,
      rowsByParent,
      connectorLength,
      rowCount: rowIndexes.length + nestedRowCount,
      maxPeerBandOffset: Math.max(
        (rowIndexes.length - 1) * rowStep,
        ...children.map((child) => child.maxPeerBandOffset),
      ),
      rankInversionCount:
        ownRankInversions +
        children.reduce((sum, child) => sum + child.rankInversionCount, 0),
      singletonTailCount:
        (rowIndexes.length > 1 && rowIndexes[rowIndexes.length - 1]!.length === 1 ? 1 : 0) +
        children.reduce((sum, child) => sum + child.singletonTailCount, 0),
      rowImbalance:
        Math.max(...rowLengths) - Math.min(...rowLengths) +
        children.reduce((sum, child) => sum + child.rowImbalance, 0),
      signature: `N:${node.data.id}[${rowIndexes.map((row) => row.length).join('.')}](${children
        .map((child) => child.signature)
        .join('|')})`,
    }, direction);
  }

  private packRow(
    variants: LayoutVariant[],
    requiresThroughChannel: boolean,
    rowIndex: number,
  ): number[] {
    if (!requiresThroughChannel) {
      return this.centerOffsetsByBounds(variants, this.packSequentially(variants));
    }
    if (variants.length === 1) {
      const variant = variants[0]!;
      const channelHalf = Math.max(LINK_CHANNEL_WIDTH, GAP_H) / 2;
      return [
        rowIndex % 2 === 0
          ? -channelHalf - variant.maxBreadth
          : channelHalf - variant.minBreadth,
      ];
    }

    const channelHalf = Math.max(LINK_CHANNEL_WIDTH, GAP_H) / 2;
    let best: { offsets: number[]; score: number; split: number } | null = null;
    for (let split = 1; split < variants.length; split++) {
      const left = variants.slice(0, split);
      const right = variants.slice(split);
      const leftOffsets = this.packSequentially(left);
      const rightOffsets = this.packSequentially(right);
      const leftMax = Math.max(...left.map((variant, index) =>
        leftOffsets[index]! + variant.maxBreadth,
      ));
      const rightMin = Math.min(...right.map((variant, index) =>
        rightOffsets[index]! + variant.minBreadth,
      ));
      const leftShift = -channelHalf - leftMax;
      const rightShift = channelHalf - rightMin;
      const offsets = [
        ...leftOffsets.map((offset) => offset + leftShift),
        ...rightOffsets.map((offset) => offset + rightShift),
      ];
      const min = Math.min(...variants.map((variant, index) =>
        offsets[index]! + variant.minBreadth,
      ));
      const max = Math.max(...variants.map((variant, index) =>
        offsets[index]! + variant.maxBreadth,
      ));
      const score = (max - min) + Math.abs((min + max) / 2) * 0.25;
      if (
        !best ||
        score < best.score - 0.001 ||
        (Math.abs(score - best.score) < 0.001 && split < best.split)
      ) {
        best = { offsets, score, split };
      }
    }
    return best!.offsets;
  }

  /**
   * Fit a fixed-baseline peer row around card contours from earlier rows. The
   * row may move complete child subtrees horizontally, but never vertically.
   */
  private packRowAgainstObstacles(
    variants: LayoutVariant[],
    rowTop: number,
    obstacles: LogicalRect[],
    requiresThroughChannel: boolean,
    rowIndex: number,
  ): number[] | null {
    const candidates = new Map<string, number[]>();
    const add = (offsets: number[]) => {
      if (this.isRowPlacementValid(
        variants,
        offsets,
        rowTop,
        obstacles,
        requiresThroughChannel,
      )) {
        candidates.set(offsets.map((offset) => offset.toFixed(3)).join(','), offsets);
      }
    };

    add(this.packRow(variants, requiresThroughChannel, rowIndex));
    for (let split = 0; split <= variants.length; split++) {
      add(this.packAroundObstacles(
        variants,
        split,
        rowTop,
        obstacles,
        requiresThroughChannel,
      ));
    }

    const ranked = Array.from(candidates.values()).sort((a, b) =>
      this.rowPlacementScore(variants, a, rowTop, obstacles) -
        this.rowPlacementScore(variants, b, rowTop, obstacles) ||
      a.join(',').localeCompare(b.join(',')),
    );
    return ranked[0] ?? null;
  }

  private packAroundObstacles(
    variants: LayoutVariant[],
    split: number,
    rowTop: number,
    obstacles: LogicalRect[],
    requiresThroughChannel: boolean,
  ): number[] {
    const offsets = new Array<number>(variants.length);
    const placed = obstacles.map((rect) => ({ ...rect }));
    const channelHalf = requiresThroughChannel ? LINK_CHANNEL_WIDTH / 2 : 0;
    let leftBoundary = -channelHalf;
    let rightBoundary = channelHalf;

    for (let index = split - 1; index >= 0; index--) {
      const variant = variants[index]!;
      const initial = leftBoundary - variant.maxBreadth;
      const offset = this.findNearestClearOffset(
        variant,
        rowTop,
        placed,
        initial,
        'left',
      );
      offsets[index] = offset;
      placed.push(...this.translateRects(variant.rects, offset, rowTop));
      leftBoundary = offset + variant.minBreadth - GAP_H;
    }

    for (let index = split; index < variants.length; index++) {
      const variant = variants[index]!;
      const initial = rightBoundary - variant.minBreadth;
      const offset = this.findNearestClearOffset(
        variant,
        rowTop,
        placed,
        initial,
        'right',
      );
      offsets[index] = offset;
      placed.push(...this.translateRects(variant.rects, offset, rowTop));
      rightBoundary = offset + variant.maxBreadth + GAP_H;
    }
    return offsets;
  }

  private findNearestClearOffset(
    variant: LayoutVariant,
    rowTop: number,
    obstacles: LogicalRect[],
    initial: number,
    direction: 'left' | 'right',
  ): number {
    const forbidden: Array<{ min: number; max: number }> = [];
    for (const ownRect of variant.rects) {
      const ownTop = ownRect.minDepth + rowTop;
      const ownBottom = ownRect.maxDepth + rowTop;
      for (const obstacle of obstacles) {
        if (
          ownTop < obstacle.maxDepth - 0.001 &&
          ownBottom > obstacle.minDepth + 0.001
        ) {
          forbidden.push({
            min: obstacle.minBreadth - GAP_H - ownRect.maxBreadth,
            max: obstacle.maxBreadth + GAP_H - ownRect.minBreadth,
          });
        }
      }
    }

    let offset = initial;
    for (let attempt = 0; attempt <= forbidden.length; attempt++) {
      const containing = forbidden.filter(
        (interval) => offset > interval.min + 0.001 && offset < interval.max - 0.001,
      );
      if (containing.length === 0) return offset;
      offset = direction === 'left'
        ? Math.min(...containing.map((interval) => interval.min))
        : Math.max(...containing.map((interval) => interval.max));
    }
    return offset;
  }

  private isRowPlacementValid(
    variants: LayoutVariant[],
    offsets: number[],
    rowTop: number,
    obstacles: LogicalRect[],
    requiresThroughChannel: boolean,
  ): boolean {
    if (offsets.length !== variants.length || offsets.some((offset) => !Number.isFinite(offset))) {
      return false;
    }
    const translated = variants.flatMap((variant, index) =>
      this.translateRects(variant.rects, offsets[index]!, rowTop),
    );
    if (requiresThroughChannel) {
      const channelHalf = LINK_CHANNEL_WIDTH / 2;
      if (translated.some(
        (rect) => rect.minBreadth < channelHalf && rect.maxBreadth > -channelHalf,
      )) {
        return false;
      }
    }
    for (let first = 0; first < translated.length; first++) {
      for (let second = first + 1; second < translated.length; second++) {
        if (!this.rectsHaveClearance(translated[first]!, translated[second]!)) return false;
      }
      for (const obstacle of obstacles) {
        if (!this.rectsHaveClearance(translated[first]!, obstacle)) return false;
      }
    }
    return true;
  }

  private rowPlacementScore(
    variants: LayoutVariant[],
    offsets: number[],
    rowTop: number,
    obstacles: LogicalRect[],
  ): number {
    const all = [
      ...obstacles,
      ...variants.flatMap((variant, index) =>
        this.translateRects(variant.rects, offsets[index]!, rowTop),
      ),
    ];
    const min = Math.min(...all.map((rect) => rect.minBreadth));
    const max = Math.max(...all.map((rect) => rect.maxBreadth));
    return max - min + Math.abs(min + max) * 0.1 +
      offsets.reduce((sum, offset) => sum + Math.abs(offset), 0) * 0.001;
  }

  private translateRects(
    rects: LogicalRect[],
    breadthOffset: number,
    depthOffset: number,
  ): LogicalRect[] {
    return rects.map((rect) => ({
      ...rect,
      minBreadth: rect.minBreadth + breadthOffset,
      maxBreadth: rect.maxBreadth + breadthOffset,
      minDepth: rect.minDepth + depthOffset,
      maxDepth: rect.maxDepth + depthOffset,
    }));
  }

  private rectsHaveClearance(first: LogicalRect, second: LogicalRect): boolean {
    if (
      first.minDepth >= second.maxDepth - 0.001 ||
      first.maxDepth <= second.minDepth + 0.001
    ) {
      return true;
    }
    if (first.maxBreadth <= second.minBreadth) {
      return second.minBreadth - first.maxBreadth >= GAP_H - 0.001;
    }
    if (second.maxBreadth <= first.minBreadth) {
      return first.minBreadth - second.maxBreadth >= GAP_H - 0.001;
    }
    return false;
  }

  private centerOffsetsByBounds(variants: LayoutVariant[], offsets: number[]): number[] {
    if (variants.length === 0) return [];
    const min = Math.min(...variants.map((variant, index) => offsets[index]! + variant.minBreadth));
    const max = Math.max(...variants.map((variant, index) => offsets[index]! + variant.maxBreadth));
    const shift = -(min + max) / 2;
    return offsets.map((offset) => offset + shift);
  }

  private packSequentially(variants: LayoutVariant[]): number[] {
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
              leftRect.maxBreadth + GAP_H - rightRect.minBreadth,
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

  private parentChildRoute(source: LogicalPoint, target: LogicalPoint): LogicalPoint[] {
    if (Math.abs(source.breadth - target.breadth) < 0.001) return [source, target];
    const channelDepth = target.depth - GAP_V / 2;
    return [
      source,
      { breadth: source.breadth, depth: channelDepth },
      { breadth: target.breadth, depth: channelDepth },
      target,
    ];
  }

  private isVariantValid(variant: LayoutVariant): boolean {
    for (let first = 0; first < variant.rects.length; first++) {
      for (let second = first + 1; second < variant.rects.length; second++) {
        if (!this.rectsHaveClearance(variant.rects[first]!, variant.rects[second]!)) {
          return false;
        }
      }
    }

    for (const [key, route] of variant.routes) {
      const [sourceId, targetId] = key.split('\u0000');
      for (let index = 1; index < route.length; index++) {
        const start = route[index - 1]!;
        const end = route[index]!;
        if (start.breadth !== end.breadth && start.depth !== end.depth) return false;
        for (const rect of variant.rects) {
          if (rect.id === sourceId || rect.id === targetId) continue;
          if (this.segmentIntersectsLogicalRect(start, end, rect, LINK_CARD_PADDING)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private segmentIntersectsLogicalRect(
    start: LogicalPoint,
    end: LogicalPoint,
    rect: LogicalRect,
    padding: number,
  ): boolean {
    const minBreadth = rect.minBreadth - padding;
    const maxBreadth = rect.maxBreadth + padding;
    const minDepth = rect.minDepth - padding;
    const maxDepth = rect.maxDepth + padding;
    if (start.depth === end.depth) {
      return start.depth >= minDepth && start.depth <= maxDepth &&
        Math.max(start.breadth, end.breadth) >= minBreadth &&
        Math.min(start.breadth, end.breadth) <= maxBreadth;
    }
    return start.breadth >= minBreadth && start.breadth <= maxBreadth &&
      Math.max(start.depth, end.depth) >= minDepth &&
      Math.min(start.depth, end.depth) <= maxDepth;
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
      const ranked = [...unique].sort((a, b) => this.compareForTarget(a, b, profile));
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

  private selectValidVariant(variants: LayoutVariant[], target: number): LayoutVariant {
    const ranked = [...variants].sort((a, b) => this.compareForTarget(a, b, target));
    const selected = ranked.find((variant) => this.isVariantValid(variant));
    if (!selected) throw new Error('No valid complete layout candidate.');
    return selected;
  }

  private compareForTarget(a: LayoutVariant, b: LayoutVariant, target: number): number {
    if (a.rankInversionCount !== b.rankInversionCount) {
      return a.rankInversionCount - b.rankInversionCount;
    }
    const aError = this.ratioError(a, target);
    const bError = this.ratioError(b, target);
    const aWithinTolerance = aError <= RATIO_TOLERANCE;
    const bWithinTolerance = bError <= RATIO_TOLERANCE;
    if (aWithinTolerance !== bWithinTolerance) return aWithinTolerance ? -1 : 1;
    if (!aWithinTolerance && Math.abs(aError - bError) > 1e-9) return aError - bError;
    return a.physicalWidth * a.physicalHeight - b.physicalWidth * b.physicalHeight ||
      a.maxPeerBandOffset - b.maxPeerBandOffset ||
      a.connectorLength - b.connectorLength ||
      a.singletonTailCount - b.singletonTailCount ||
      a.rowImbalance - b.rowImbalance ||
      a.rowCount - b.rowCount ||
      a.signature.localeCompare(b.signature);
  }

  private ratioError(variant: LayoutVariant, target: number): number {
    return Math.abs(Math.log((variant.physicalWidth / variant.physicalHeight) / target));
  }

  private minVariant(
    variants: LayoutVariant[],
    metric: (variant: LayoutVariant) => number,
  ): LayoutVariant {
    return [...variants].sort((a, b) =>
      metric(a) - metric(b) || a.signature.localeCompare(b.signature),
    )[0]!;
  }

  private toPhysicalPoint(point: LogicalPoint, direction: LayoutDirection): LayoutPoint {
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

  private clampTargetRatio(targetAspectRatio: number): number {
    if (!Number.isFinite(targetAspectRatio)) return DEFAULT_TARGET_ASPECT_RATIO;
    return Math.max(
      MIN_TARGET_ASPECT_RATIO,
      Math.min(MAX_TARGET_ASPECT_RATIO, targetAspectRatio),
    );
  }
}
