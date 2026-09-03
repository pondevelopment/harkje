import { Injectable } from '@angular/core';
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
import { classifyOrthogonalSegments } from './org-layout-geometry';

export type { LayoutBounds, LayoutPoint, LayoutResult } from '../models/org.types';

export interface LayoutRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
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
const MAX_CHILD_BLOCK_COMBINATIONS = 16;
const MAX_PARTITION_STATES = 32;
const EXHAUSTIVE_PARTITION_CHILD_LIMIT = 8;
const FAST_ROW_PACKING_CHILD_LIMIT = 12;
const FAST_ROW_PACKING_RECT_LIMIT = 24;
const RATIO_TOLERANCE = 0.08;
const FINAL_RATIO_TOLERANCE = 0.08;
// A better parent hierarchy may trade at most ~22% sibling breadth; beyond
// that point both candidates remain on the Pareto frontier for ratio selection.
const HIERARCHY_BREADTH_TOLERANCE = 0.20;
const MAX_RATIO_TIER_WIDTH = Math.log(5 / 3);
const RATIO_EXTREMENESS_WEIGHT = 2;
const ASPECT_PROFILES = [
  0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 4 / 3,
  1.5, 16 / 9, 2, 2.5, 3, 4,
] as const;
const CHILD_BLOCK_ASPECT_PROFILES = [
  0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4,
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

interface OwnedRouteSegment {
  ownerId: string;
  sourceId: string;
  targetId: string;
  start: LogicalPoint;
  end: LogicalPoint;
}

/** Complete recursive block: cards, internal routes, topology, and metrics. */
interface SubtreeBlock {
  placements: Map<HierarchyNode, LogicalPoint>;
  rects: LogicalRect[];
  routes: Map<string, LogicalPoint[]>;
  routeSegments: OwnedRouteSegment[];
  entryPort: LogicalPoint;
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
  peerBandCount: number;
  peerBandImbalance: number;
  peerItemCount: number;
  rowCount: number;
  maxPeerBandOffset: number;
  peerBandDelay: number;
  rankInversionCount: number;
  routeOverlapCount: number;
  singletonTailCount: number;
  rowImbalance: number;
  signature: string;
}

/**
 * Bottom-up aspect-ratio-aware solver. Each node returns a bounded frontier of
 * routed subtree blocks; target ratio never scales cards, coordinates, or gaps.
 */
@Injectable({ providedIn: 'root' })
export class AdaptiveOrgLayoutService implements OrgLayoutAlgorithm {
  readonly id: LayoutAlgorithmId = 'adaptive';

  private readonly variantValidityCache = new WeakMap<SubtreeBlock, boolean>();
  private readonly frontierCache = new WeakMap<
    HierarchyNode,
    Map<LayoutDirection, SubtreeBlock[]>
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
    const selected = this.selectValidBlock(variants, target);

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

    const { bounds: cardBounds } = this.computeRectsAndBounds(root);
    const bounds = this.extendBoundsWithRoutes(cardBounds, routes);
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

  computeLayout(
    root: HierarchyNode,
    direction: LayoutDirection,
    targetAspectRatio: number = DEFAULT_TARGET_ASPECT_RATIO,
  ): LayoutResult {
    return this.computeAdaptiveLayout(root, direction, targetAspectRatio);
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
    memo: Map<HierarchyNode, SubtreeBlock[]>,
  ): SubtreeBlock[] {
    const cached = memo.get(node);
    if (cached) return cached;

    const cardBreadth = direction === LayoutDirection.LeftRight ? CARD_HEIGHT : CARD_WIDTH;
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    const children = node.children ?? [];
    if (children.length === 0) {
      const leaf = this.finalizeBlock({
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
        peerBandCount: 0,
        peerBandImbalance: 0,
        peerItemCount: 0,
        rowCount: 0,
        maxPeerBandOffset: 0,
        peerBandDelay: 0,
        rankInversionCount: 0,
        routeOverlapCount: 0,
        singletonTailCount: 0,
        rowImbalance: 0,
        signature: `L:${node.data.id}`,
      }, direction);
      memo.set(node, [leaf]);
      return [leaf];
    }

    const childFrontiers = children.map((child) => this.buildVariants(child, direction, memo));
    const generated: SubtreeBlock[] = [];
    for (const selectedChildren of this.buildChildSelections(childFrontiers)) {
      for (const partition of this.generatePartitions(selectedChildren, direction)) {
        const variant = this.composeVariantRaw(
          node,
          selectedChildren,
          partition,
          direction,
        );
        if (variant) generated.push(variant);
        const roster = this.composeRosterVariant(
          node,
          selectedChildren,
          partition,
          direction,
        );
        if (roster) generated.push(roster);
      }
    }

    if (generated.length === 0) {
      throw new Error(`No valid layout candidates for node ${String(node.data.id)}.`);
    }

    const variants = this.pruneBlocks(generated);
    memo.set(node, variants);
    return variants;
  }

  private buildChildSelections(frontiers: SubtreeBlock[][]): SubtreeBlock[][] {
    let combinations: SubtreeBlock[][] = [[]];
    for (const frontier of frontiers) {
      const options = this.childBlockOptions(frontier);
      const expanded = new Map<string, SubtreeBlock[]>();
      for (const combination of combinations) {
        for (const option of options) {
          const next = [...combination, option];
          expanded.set(next.map((block) => block.signature).join('\u0001'), next);
        }
      }
      combinations = this.pruneChildBlockCombinations(
        Array.from(expanded.values()),
      );
    }
    return combinations;
  }

  private childBlockOptions(frontier: SubtreeBlock[]): SubtreeBlock[] {
    const options = new Map<string, SubtreeBlock>();
    const add = (block: SubtreeBlock) => options.set(block.signature, block);
    for (const profile of CHILD_BLOCK_ASPECT_PROFILES) {
      add(this.selectBlock(frontier, profile));
    }
    add(this.minVariant(frontier, (block) => block.physicalWidth * block.physicalHeight));
    add(this.minVariant(frontier, (block) => block.physicalWidth));
    add(this.minVariant(frontier, (block) => block.physicalHeight));
    add(this.minVariant(frontier, (block) => block.connectorLength));
    add(this.minVariant(frontier, (block) => block.physicalWidth / block.physicalHeight));
    add(this.minVariant(frontier, (block) => -block.physicalWidth / block.physicalHeight));
    add(this.minHierarchyVariant(frontier));
    return Array.from(options.values()).sort((a, b) => a.signature.localeCompare(b.signature));
  }

  private pruneChildBlockCombinations(
    combinations: SubtreeBlock[][],
  ): SubtreeBlock[][] {
    if (combinations.length <= MAX_CHILD_BLOCK_COMBINATIONS) {
      return combinations.sort((a, b) => this.childCombinationKey(a)
        .localeCompare(this.childCombinationKey(b)));
    }

    const kept = new Map<string, SubtreeBlock[]>();
    const add = (combination: SubtreeBlock[]) =>
      kept.set(this.childCombinationKey(combination), combination);
    const minimumBy = (metric: (combination: SubtreeBlock[]) => number) =>
      [...combinations].sort((a, b) =>
        metric(a) - metric(b) ||
        this.childCombinationKey(a).localeCompare(this.childCombinationKey(b)),
      )[0]!;

    add(minimumBy((blocks) => blocks.reduce(
      (sum, block) => sum + block.physicalWidth * block.physicalHeight,
      0,
    )));
    add(minimumBy((blocks) => blocks.reduce((sum, block) => sum + block.physicalWidth, 0)));
    add(minimumBy((blocks) => blocks.reduce((sum, block) => sum + block.physicalHeight, 0)));
    add(minimumBy((blocks) => blocks.reduce((sum, block) => sum + block.connectorLength, 0)));
    add(minimumBy((blocks) => this.estimatedChildCombinationRatioRange(blocks).min));
    add(minimumBy((blocks) => -this.estimatedChildCombinationRatioRange(blocks).max));
    let hierarchyMinimum = combinations[0]!;
    for (const combination of combinations.slice(1)) {
      const hierarchyOrder = this.compareChildCombinationHierarchy(
        combination,
        hierarchyMinimum,
      );
      if (
        hierarchyOrder < 0 ||
        (
          hierarchyOrder === 0 &&
          this.childCombinationKey(combination)
            .localeCompare(this.childCombinationKey(hierarchyMinimum)) < 0
        )
      ) {
        hierarchyMinimum = combination;
      }
    }
    add(hierarchyMinimum);
    for (const profile of CHILD_BLOCK_ASPECT_PROFILES) {
      add(minimumBy((blocks) => this.estimatedChildCombinationRatioError(blocks, profile)));
    }

    if (kept.size < MAX_CHILD_BLOCK_COMBINATIONS) {
      const remaining = [...combinations].sort((a, b) =>
        this.estimatedChildCombinationRatioError(a, 1) -
          this.estimatedChildCombinationRatioError(b, 1) ||
        this.childCombinationKey(a).localeCompare(this.childCombinationKey(b)),
      );
      for (const combination of remaining) {
        add(combination);
        if (kept.size >= MAX_CHILD_BLOCK_COMBINATIONS) break;
      }
    }
    return Array.from(kept.values()).sort((a, b) =>
      this.childCombinationKey(a).localeCompare(this.childCombinationKey(b)),
    );
  }

  private estimatedChildCombinationRatioError(
    blocks: SubtreeBlock[],
    target: number,
  ): number {
    const rowWidth = blocks.reduce((sum, block) => sum + block.physicalWidth, 0) +
      Math.max(0, blocks.length - 1) * GAP_H;
    const rowHeight = Math.max(...blocks.map((block) => block.physicalHeight));
    const columnWidth = Math.max(...blocks.map((block) => block.physicalWidth));
    const columnHeight = blocks.reduce((sum, block) => sum + block.physicalHeight, 0) +
      Math.max(0, blocks.length - 1) * GAP_V;
    return Math.min(
      Math.abs(Math.log((rowWidth / rowHeight) / target)),
      Math.abs(Math.log((columnWidth / columnHeight) / target)),
    );
  }

  private estimatedChildCombinationRatioRange(
    blocks: SubtreeBlock[],
  ): { min: number; max: number } {
    const rowWidth = blocks.reduce((sum, block) => sum + block.physicalWidth, 0) +
      Math.max(0, blocks.length - 1) * GAP_H;
    const rowHeight = Math.max(...blocks.map((block) => block.physicalHeight));
    const columnWidth = Math.max(...blocks.map((block) => block.physicalWidth));
    const columnHeight = blocks.reduce((sum, block) => sum + block.physicalHeight, 0) +
      Math.max(0, blocks.length - 1) * GAP_V;
    const rowRatio = rowWidth / rowHeight;
    const columnRatio = columnWidth / columnHeight;
    return {
      min: Math.min(rowRatio, columnRatio),
      max: Math.max(rowRatio, columnRatio),
    };
  }

  private childCombinationKey(blocks: SubtreeBlock[]): string {
    return blocks.map((block) => block.signature).join('\u0001');
  }

  private compareChildCombinationHierarchy(
    a: SubtreeBlock[],
    b: SubtreeBlock[],
  ): number {
    const sum = (blocks: SubtreeBlock[], metric: (block: SubtreeBlock) => number) =>
      blocks.reduce((total, block) => total + metric(block), 0);
    return sum(a, (block) => block.rankInversionCount) -
      sum(b, (block) => block.rankInversionCount) ||
      sum(a, (block) => block.routeOverlapCount) -
      sum(b, (block) => block.routeOverlapCount) ||
      sum(a, (block) => block.rowCount) - sum(b, (block) => block.rowCount) ||
      sum(a, (block) => block.peerBandDelay) -
      sum(b, (block) => block.peerBandDelay) ||
      Math.max(...a.map((block) => block.maxPeerBandOffset)) -
      Math.max(...b.map((block) => block.maxPeerBandOffset));
  }

  private generatePartitions(
    variants: SubtreeBlock[],
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
    let states: number[][][] = [[[0]]];
    for (let childIndex = 1; childIndex < count; childIndex++) {
      const expanded: number[][][] = [];
      for (const state of states) {
        const appended = state.map((row) => [...row]);
        appended[appended.length - 1]!.push(childIndex);
        expanded.push(appended);
        expanded.push([...state.map((row) => [...row]), [childIndex]]);
      }
      states = this.prunePartitionStates(
        expanded,
        variants.slice(0, childIndex + 1),
        direction,
      );
    }
    return states;
  }

  private prunePartitionStates(
    states: number[][][],
    variants: SubtreeBlock[],
    direction: LayoutDirection,
  ): number[][][] {
    const unique = new Map<string, number[][]>();
    for (const state of states) unique.set(this.partitionKey(state), state);
    const candidates = Array.from(unique.values());
    if (candidates.length <= MAX_PARTITION_STATES) {
      return candidates.sort((a, b) => this.partitionKey(a).localeCompare(this.partitionKey(b)));
    }

    const kept = new Map<string, number[][]>();
    const add = (state: number[][]) => kept.set(this.partitionKey(state), state);
    const minimumBy = (metric: (state: number[][]) => number): number[][] =>
      [...candidates].sort((a, b) =>
        metric(a) - metric(b) || this.partitionKey(a).localeCompare(this.partitionKey(b)),
      )[0]!;
    add(minimumBy((state) => state.length));
    add(minimumBy((state) => -state.length));
    add(minimumBy((state) => this.partitionSingletonTail(state)));
    add(minimumBy((state) => this.partitionImbalance(state)));
    add(minimumBy((state) => this.estimatePartitionGeometry(state, variants, direction).area));
    for (const profile of ASPECT_PROFILES) {
      add(minimumBy((state) => Math.abs(Math.log(
        this.estimatePartitionGeometry(state, variants, direction).ratio / profile,
      ))));
    }
    const remaining = [...candidates].sort((a, b) =>
      this.partitionDelay(a) - this.partitionDelay(b) ||
      this.partitionImbalance(a) - this.partitionImbalance(b) ||
      this.partitionKey(a).localeCompare(this.partitionKey(b)),
    );
    for (const state of remaining) {
      add(state);
      if (kept.size >= MAX_PARTITION_STATES) break;
    }
    return Array.from(kept.values()).sort((a, b) =>
      this.partitionKey(a).localeCompare(this.partitionKey(b)),
    );
  }

  private estimatePartitionGeometry(
    rows: number[][],
    variants: SubtreeBlock[],
    direction: LayoutDirection,
  ): { ratio: number; area: number } {
    const cardBreadth = direction === LayoutDirection.LeftRight ? CARD_HEIGHT : CARD_WIDTH;
    const cardDepth = direction === LayoutDirection.LeftRight ? CARD_WIDTH : CARD_HEIGHT;
    const rowStep = cardDepth + GAP_V;
    const logicalWidth = Math.max(
      cardBreadth,
      ...rows.map((row) => row.reduce(
        (sum, index) => sum + variants[index]!.logicalWidth,
        Math.max(0, row.length - 1) * GAP_H,
      )),
    );
    const logicalHeight = Math.max(
      cardDepth,
      ...rows.map((row, rowIndex) =>
        rowStep * (rowIndex + 1) + Math.max(...row.map((index) =>
          variants[index]!.logicalHeight,
        )),
      ),
    );
    const physicalWidth = direction === LayoutDirection.LeftRight
      ? logicalHeight
      : logicalWidth;
    const physicalHeight = direction === LayoutDirection.LeftRight
      ? logicalWidth
      : logicalHeight;
    return {
      ratio: physicalWidth / physicalHeight,
      area: physicalWidth * physicalHeight,
    };
  }

  private partitionKey(rows: readonly (readonly number[])[]): string {
    return rows.map((row) => row.length).join('.');
  }

  private partitionDelay(rows: readonly (readonly number[])[]): number {
    return rows.reduce((sum, row, index) => sum + row.length * index, 0);
  }

  private partitionImbalance(rows: readonly (readonly number[])[]): number {
    const lengths = rows.map((row) => row.length);
    return Math.max(...lengths) - Math.min(...lengths);
  }

  private partitionSingletonTail(rows: readonly (readonly number[])[]): number {
    return rows.length > 1 && rows[rows.length - 1]!.length === 1 ? 1 : 0;
  }

  private composeVariantRaw(
    node: HierarchyNode,
    children: SubtreeBlock[],
    rowIndexes: number[][],
    direction: LayoutDirection,
  ): SubtreeBlock | null {
    if (!this.isCompleteOrderedPartition(rowIndexes, children.length)) return null;
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
      rowIndexes.map((row) => row.map((index) =>
        String((node.children ?? [])[index]!.data.id),
      )),
    );

    const rowStep = cardDepth + GAP_V;
    const commonChannelDepth = cardDepth + GAP_V / 2;
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
        commonChannelDepth,
        rects,
        routes,
        node,
        indexes.map((index) => (node.children ?? [])[index]!),
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
        const target = {
          breadth: breadthOffset + child.entryPort.breadth,
          depth: rowTop + child.entryPort.depth,
        };
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
    const peerBandDelay = rowIndexes.reduce(
      (sum, row, rowIndex) => sum + row.length * rowIndex,
      0,
    );
    return this.finalizeBlock({
      placements,
      rects,
      routes,
      rowsByParent,
      connectorLength,
      peerBandCount: rowIndexes.length,
      peerBandImbalance: Math.max(...rowLengths) - Math.min(...rowLengths),
      peerItemCount: children.length,
      rowCount: rowIndexes.length + nestedRowCount,
      maxPeerBandOffset: Math.max(
        (rowIndexes.length - 1) * rowStep,
        ...children.map((child) => child.maxPeerBandOffset),
      ),
      peerBandDelay:
        peerBandDelay +
        children.reduce((sum, child) => sum + child.peerBandDelay, 0),
      rankInversionCount:
        ownRankInversions +
        children.reduce((sum, child) => sum + child.rankInversionCount, 0),
      routeOverlapCount: this.countAmbiguousRouteOverlaps(routes),
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

  /**
   * Portrait alternative for a list of visible leaf peers. Cards remain in one
   * breadth column while a manager-owned side bus makes their equal rank clear.
   * Managers with visible subtrees continue to use contour-packed candidates.
   */
  private composeRosterVariant(
    node: HierarchyNode,
    children: SubtreeBlock[],
    rowIndexes: number[][],
    direction: LayoutDirection,
  ): SubtreeBlock | null {
    if (
      !this.isCompleteOrderedPartition(rowIndexes, children.length) ||
      direction !== LayoutDirection.TopDown ||
      rowIndexes.length < 2 ||
      !rowIndexes.every((row) => row.length === 1) ||
      !children.every((child) =>
        child.placements.size === 1 &&
        child.rects.length === 1 &&
        child.routes.size === 0
      )
    ) {
      return null;
    }

    const cardBreadth = CARD_WIDTH;
    const cardDepth = CARD_HEIGHT;
    const rowStep = cardDepth + GAP_V;
    const commonChannelDepth = cardDepth + GAP_V / 2;
    const targetEdgeBreadth = -cardBreadth / 2;
    const busBreadth = targetEdgeBreadth - GAP_H;
    const placements = new Map<HierarchyNode, LogicalPoint>([[
      node,
      { breadth: 0, depth: 0 },
    ]]);
    const rects: LogicalRect[] = [{
      id: String(node.data.id),
      minBreadth: -cardBreadth / 2,
      maxBreadth: cardBreadth / 2,
      minDepth: 0,
      maxDepth: cardDepth,
    }];
    const routes = new Map<string, LogicalPoint[]>();
    const rowsByParent = new Map<string, string[][]>([[
      String(node.data.id),
      rowIndexes.map((row) => [String((node.children ?? [])[row[0]!]!.data.id)]),
    ]]);
    let connectorLength = 0;

    for (let rowIndex = 0; rowIndex < rowIndexes.length; rowIndex++) {
      const childIndex = rowIndexes[rowIndex]![0]!;
      const childNode = (node.children ?? [])[childIndex]!;
      const child = children[childIndex]!;
      const rowTop = rowStep * (rowIndex + 1);

      for (const [placedNode, point] of child.placements) {
        placements.set(placedNode, {
          breadth: point.breadth,
          depth: point.depth + rowTop,
        });
      }
      for (const rect of child.rects) {
        rects.push({
          ...rect,
          minDepth: rect.minDepth + rowTop,
          maxDepth: rect.maxDepth + rowTop,
        });
      }

      const source = { breadth: 0, depth: cardDepth };
      const targetDepth = rowTop + cardDepth / 2;
      const route = [
        source,
        { breadth: 0, depth: commonChannelDepth },
        { breadth: busBreadth, depth: commonChannelDepth },
        { breadth: busBreadth, depth: targetDepth },
        { breadth: targetEdgeBreadth, depth: targetDepth },
      ];
      routes.set(this.linkKey(node, childNode), route);
      connectorLength += this.routeLength(route);
    }

    const variant = this.finalizeBlock({
      placements,
      rects,
      routes,
      rowsByParent,
      connectorLength,
      peerBandCount: rowIndexes.length,
      peerBandImbalance: 0,
      peerItemCount: children.length,
      rowCount: rowIndexes.length,
      maxPeerBandOffset: (rowIndexes.length - 1) * rowStep,
      peerBandDelay: rowIndexes.reduce((sum, _row, index) => sum + index, 0),
      rankInversionCount: 0,
      routeOverlapCount: this.countAmbiguousRouteOverlaps(routes),
      singletonTailCount: 1,
      rowImbalance: 0,
      signature: `R:${node.data.id}[${rowIndexes.map((row) => row.length).join('.')}](${children
        .map((child) => child.signature)
        .join('|')})`,
    }, direction);
    return this.isVariantValid(variant) ? variant : null;
  }

  private isCompleteOrderedPartition(
    rows: readonly (readonly number[])[],
    childCount: number,
  ): boolean {
    const flattened = rows.flat();
    return flattened.length === childCount &&
      flattened.every((childIndex, index) => childIndex === index);
  }

  private packRow(
    variants: SubtreeBlock[],
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
    variants: SubtreeBlock[],
    rowTop: number,
    channelDepth: number,
    obstacles: LogicalRect[],
    existingRoutes: ReadonlyMap<string, LogicalPoint[]>,
    parentNode: HierarchyNode,
    childNodes: HierarchyNode[],
    requiresThroughChannel: boolean,
    rowIndex: number,
  ): number[] | null {
    const baseline = this.packRow(variants, requiresThroughChannel, rowIndex);
    const placedRectCount = obstacles.length + variants.reduce(
      (count, variant) => count + variant.rects.length,
      0,
    );
    if (
      (
        variants.length > FAST_ROW_PACKING_CHILD_LIMIT ||
        placedRectCount > FAST_ROW_PACKING_RECT_LIMIT
      ) &&
      this.isRowPlacementValid(
        variants,
        baseline,
        rowTop,
        channelDepth,
        obstacles,
        existingRoutes,
        parentNode,
        childNodes,
        requiresThroughChannel,
      )
    ) {
      return baseline;
    }

    const candidates = new Map<string, number[]>();
    const add = (offsets: number[]) => {
      if (this.isRowPlacementValid(
        variants,
        offsets,
        rowTop,
        channelDepth,
        obstacles,
        existingRoutes,
        parentNode,
        childNodes,
        requiresThroughChannel,
      )) {
        candidates.set(offsets.map((offset) => offset.toFixed(3)).join(','), offsets);
      }
    };
    add(baseline);
    for (let split = 0; split <= variants.length; split++) {
      add(this.packAroundObstacles(
        variants,
        split,
        rowTop,
        channelDepth,
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
    variants: SubtreeBlock[],
    split: number,
    rowTop: number,
    channelDepth: number,
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
        channelDepth,
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
        channelDepth,
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
    variant: SubtreeBlock,
    rowTop: number,
    channelDepth: number,
    obstacles: LogicalRect[],
    initial: number,
    direction: 'left' | 'right',
  ): number {
    const forbidden: { min: number; max: number }[] = [];
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
    for (const obstacle of obstacles) {
      if (
        channelDepth < obstacle.maxDepth - 0.001 &&
        rowTop > obstacle.minDepth + 0.001
      ) {
        forbidden.push({
          min: obstacle.minBreadth - LINK_CARD_PADDING,
          max: obstacle.maxBreadth + LINK_CARD_PADDING,
        });
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
    variants: SubtreeBlock[],
    offsets: number[],
    rowTop: number,
    channelDepth: number,
    obstacles: LogicalRect[],
    existingRoutes: ReadonlyMap<string, LogicalPoint[]>,
    parentNode: HierarchyNode,
    childNodes: HierarchyNode[],
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
    for (const offset of offsets) {
      const start = { breadth: offset, depth: channelDepth };
      const end = { breadth: offset, depth: rowTop };
      if (obstacles.some((rect) =>
        this.segmentIntersectsLogicalRect(start, end, rect, LINK_CARD_PADDING),
      )) return false;
    }
    for (let first = 0; first < translated.length; first++) {
      for (let second = first + 1; second < translated.length; second++) {
        if (!this.rectsHaveClearance(translated[first]!, translated[second]!)) return false;
      }
      for (const obstacle of obstacles) {
        if (!this.rectsHaveClearance(translated[first]!, obstacle)) return false;
      }
    }

    const newRoutes = new Map<string, LogicalPoint[]>();
    for (let index = 0; index < variants.length; index++) {
      const breadthOffset = offsets[index]!;
      for (const [key, route] of variants[index]!.routes) {
        newRoutes.set(key, route.map((point) => ({
          breadth: point.breadth + breadthOffset,
          depth: point.depth + rowTop,
        })));
      }
      const source = {
        breadth: 0,
        depth: channelDepth - GAP_V / 2,
      };
      const target = {
        breadth: breadthOffset + variants[index]!.entryPort.breadth,
        depth: rowTop + variants[index]!.entryPort.depth,
      };
      newRoutes.set(
        this.linkKey(parentNode, childNodes[index]!),
        this.parentChildRoute(source, target),
      );
    }
    return this.routesClearRects(existingRoutes, translated) &&
      this.routesClearRects(newRoutes, [...obstacles, ...translated]) &&
      !this.routeMapsHaveForeignIntersection(existingRoutes, newRoutes) &&
      this.countAmbiguousRouteOverlaps(newRoutes) === 0;
  }

  private rowPlacementScore(
    variants: SubtreeBlock[],
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

  private centerOffsetsByBounds(variants: SubtreeBlock[], offsets: number[]): number[] {
    if (variants.length === 0) return [];
    const min = Math.min(...variants.map((variant, index) => offsets[index]! + variant.minBreadth));
    const max = Math.max(...variants.map((variant, index) => offsets[index]! + variant.maxBreadth));
    const shift = -(min + max) / 2;
    return offsets.map((offset) => offset + shift);
  }

  private packSequentially(variants: SubtreeBlock[]): number[] {
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
    const channelDepth = source.depth + GAP_V / 2;
    return [
      source,
      { breadth: source.breadth, depth: channelDepth },
      { breadth: target.breadth, depth: channelDepth },
      target,
    ];
  }

  private isVariantValid(variant: SubtreeBlock): boolean {
    const cached = this.variantValidityCache.get(variant);
    if (cached !== undefined) return cached;

    for (let first = 0; first < variant.rects.length; first++) {
      for (let second = first + 1; second < variant.rects.length; second++) {
        if (!this.rectsHaveClearance(variant.rects[first]!, variant.rects[second]!)) {
          this.variantValidityCache.set(variant, false);
          return false;
        }
      }
    }

    const valid = this.routesClearRects(variant.routes, variant.rects) &&
      variant.routeOverlapCount === 0;
    this.variantValidityCache.set(variant, valid);
    return valid;
  }

  private routesClearRects(
    routes: ReadonlyMap<string, LogicalPoint[]>,
    rects: readonly LogicalRect[],
  ): boolean {
    for (const [key, route] of routes) {
      const [sourceId, targetId] = key.split('\u0000');
      for (let index = 1; index < route.length; index++) {
        const start = route[index - 1]!;
        const end = route[index]!;
        if (start.breadth !== end.breadth && start.depth !== end.depth) return false;
        for (const rect of rects) {
          if (rect.id === sourceId || rect.id === targetId) continue;
          if (this.segmentIntersectsLogicalRect(start, end, rect, LINK_CARD_PADDING)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private countAmbiguousRouteOverlaps(routes: Map<string, LogicalPoint[]>): number {
    const segments = this.buildOwnedRouteSegments(routes);
    let count = 0;
    for (let first = 0; first < segments.length; first++) {
      for (let second = first + 1; second < segments.length; second++) {
        const a = segments[first]!;
        const b = segments[second]!;
        if (a.ownerId === b.ownerId) continue;
        if (classifyOrthogonalSegments(a.start, a.end, b.start, b.end) !== 'none') {
          count++;
        }
      }
    }
    return count;
  }

  private buildOwnedRouteSegments(
    routes: ReadonlyMap<string, readonly LogicalPoint[]>,
  ): OwnedRouteSegment[] {
    const segments: OwnedRouteSegment[] = [];
    for (const [key, route] of routes) {
      const [sourceId = '', targetId = ''] = key.split('\u0000');
      for (let index = 1; index < route.length; index++) {
        segments.push({
          ownerId: sourceId,
          sourceId,
          targetId,
          start: { ...route[index - 1]! },
          end: { ...route[index]! },
        });
      }
    }
    return segments;
  }

  private routeMapsHaveForeignIntersection(
    firstRoutes: ReadonlyMap<string, LogicalPoint[]>,
    secondRoutes: ReadonlyMap<string, LogicalPoint[]>,
  ): boolean {
    const firstEntries = Array.from(firstRoutes.entries()).map(([key, route]) => ({
      ownerId: key.split('\u0000')[0]!,
      route,
    }));
    const secondEntries = Array.from(secondRoutes.entries()).map(([key, route]) => ({
      ownerId: key.split('\u0000')[0]!,
      route,
    }));
    for (const first of firstEntries) {
      for (const second of secondEntries) {
        if (first.ownerId === second.ownerId) continue;
        for (let firstIndex = 1; firstIndex < first.route.length; firstIndex++) {
          for (let secondIndex = 1; secondIndex < second.route.length; secondIndex++) {
            if (classifyOrthogonalSegments(
              first.route[firstIndex - 1]!,
              first.route[firstIndex]!,
              second.route[secondIndex - 1]!,
              second.route[secondIndex]!,
            ) !== 'none') {
              return true;
            }
          }
        }
      }
    }
    return false;
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
      return start.depth > minDepth + 0.001 && start.depth < maxDepth - 0.001 &&
        Math.max(start.breadth, end.breadth) > minBreadth + 0.001 &&
        Math.min(start.breadth, end.breadth) < maxBreadth - 0.001;
    }
    return start.breadth > minBreadth + 0.001 && start.breadth < maxBreadth - 0.001 &&
      Math.max(start.depth, end.depth) > minDepth + 0.001 &&
      Math.min(start.depth, end.depth) < maxDepth - 0.001;
  }

  private finalizeBlock(
    partial: Omit<SubtreeBlock,
      | 'routeSegments'
      | 'entryPort'
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
  ): SubtreeBlock {
    const minBreadth = Math.min(...partial.rects.map((rect) => rect.minBreadth));
    const maxBreadth = Math.max(...partial.rects.map((rect) => rect.maxBreadth));
    const minDepth = Math.min(...partial.rects.map((rect) => rect.minDepth));
    const maxDepth = Math.max(...partial.rects.map((rect) => rect.maxDepth));
    const routeSegments = this.buildOwnedRouteSegments(partial.routes);
    const routePoints = routeSegments.flatMap((segment) => [segment.start, segment.end]);
    const occupiedMinBreadth = Math.min(
      minBreadth,
      ...routePoints.map((point) => point.breadth - LINK_CARD_PADDING),
    );
    const occupiedMaxBreadth = Math.max(
      maxBreadth,
      ...routePoints.map((point) => point.breadth + LINK_CARD_PADDING),
    );
    const occupiedMinDepth = Math.min(
      minDepth,
      ...routePoints.map((point) => point.depth - LINK_CARD_PADDING),
    );
    const occupiedMaxDepth = Math.max(
      maxDepth,
      ...routePoints.map((point) => point.depth + LINK_CARD_PADDING),
    );
    const logicalWidth = occupiedMaxBreadth - occupiedMinBreadth;
    const logicalHeight = occupiedMaxDepth - occupiedMinDepth;
    return {
      ...partial,
      routeSegments,
      entryPort: { breadth: 0, depth: 0 },
      minBreadth: occupiedMinBreadth,
      maxBreadth: occupiedMaxBreadth,
      minDepth: occupiedMinDepth,
      maxDepth: occupiedMaxDepth,
      logicalWidth,
      logicalHeight,
      physicalWidth: direction === LayoutDirection.LeftRight ? logicalHeight : logicalWidth,
      physicalHeight: direction === LayoutDirection.LeftRight ? logicalWidth : logicalHeight,
    };
  }

  private extendBoundsWithRoutes(
    bounds: LayoutBounds,
    routes: ReadonlyMap<string, readonly LayoutPoint[]>,
  ): LayoutBounds {
    const points = Array.from(routes.values()).flat();
    if (points.length === 0) return bounds;
    const minX = Math.min(bounds.minX, ...points.map((point) => point.x));
    const maxX = Math.max(bounds.maxX, ...points.map((point) => point.x));
    const minY = Math.min(bounds.minY, ...points.map((point) => point.y));
    const maxY = Math.max(bounds.maxY, ...points.map((point) => point.y));
    return {
      minX,
      maxX,
      minY,
      maxY,
      treeWidth: maxX - minX,
      treeHeight: maxY - minY,
    };
  }

  private pruneBlocks(variants: SubtreeBlock[]): SubtreeBlock[] {
    const bySignature = new Map<string, SubtreeBlock>();
    for (const variant of variants) {
      if (this.isVariantValid(variant)) bySignature.set(variant.signature, variant);
    }
    const unique = Array.from(bySignature.values());
    if (unique.length === 0) {
      throw new Error('No valid layout candidates remain after pruning.');
    }
    const nondominated = unique.filter((candidate) => !unique.some((other) =>
      other !== candidate && this.hierarchyDominates(other, candidate),
    ));
    if (nondominated.length <= MAX_VARIANTS_PER_NODE) {
      return nondominated.sort((a, b) => a.signature.localeCompare(b.signature));
    }

    const kept = new Map<string, SubtreeBlock>();
    const add = (variant: SubtreeBlock) => kept.set(variant.signature, variant);
    add(this.minVariant(nondominated, (variant) => variant.physicalWidth * variant.physicalHeight));
    add(this.minVariant(nondominated, (variant) => variant.physicalWidth));
    add(this.minVariant(nondominated, (variant) => variant.physicalHeight));
    add(this.minVariant(nondominated, (variant) => variant.connectorLength));
    add(this.minVariant(nondominated, (variant) => variant.physicalWidth / variant.physicalHeight));
    add(this.minVariant(nondominated, (variant) => -variant.physicalWidth / variant.physicalHeight));
    // This anchor makes hierarchy quality part of every bounded Pareto frontier,
    // rather than hoping a ratio/area extreme happens to retain it.
    add(this.minHierarchyVariant(nondominated));

    const profileRankings = ASPECT_PROFILES.map((profile) => ({
      profile,
      ranked: this.rankVariantsForTarget(nondominated, profile),
    }));
    // Preserve the full ratio range before spending remaining slots on local
    // diversity. Extreme profiles receive their runner-up first because broad
    // near-square tiers are already represented by the hierarchy/size anchors.
    for (const { ranked } of profileRankings) add(ranked[0]!);
    const secondaryRankings = [...profileRankings].sort((a, b) =>
      Math.abs(Math.log2(b.profile)) - Math.abs(Math.log2(a.profile)) ||
      a.profile - b.profile,
    );
    for (const { ranked } of secondaryRankings) {
      if (kept.size >= MAX_VARIANTS_PER_NODE) break;
      const secondary = ranked[1];
      if (secondary) add(secondary);
    }
    if (kept.size < MAX_VARIANTS_PER_NODE) {
      const remaining = [...nondominated].sort((a, b) =>
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

  private hierarchyDominates(
    better: SubtreeBlock,
    worse: SubtreeBlock,
  ): boolean {
    return better.routeOverlapCount <= worse.routeOverlapCount &&
      better.rankInversionCount <= worse.rankInversionCount &&
      better.peerBandCount < worse.peerBandCount &&
      better.peerBandDelay <= worse.peerBandDelay &&
      better.maxPeerBandOffset <= worse.maxPeerBandOffset + 0.001 &&
      better.logicalWidth <=
        worse.logicalWidth * Math.exp(HIERARCHY_BREADTH_TOLERANCE) + 0.001;
  }

  private selectBlock(variants: SubtreeBlock[], target: number): SubtreeBlock {
    return this.rankVariantsForTarget(variants, target)[0]!;
  }

  private selectValidBlock(variants: SubtreeBlock[], target: number): SubtreeBlock {
    const valid = variants.filter((variant) => this.isVariantValid(variant));
    const selected = this.rankFinalVariantsForTarget(valid, target)[0];
    if (!selected) throw new Error('No valid complete layout candidate.');
    return selected;
  }

  private rankFinalVariantsForTarget(
    variants: SubtreeBlock[],
    target: number,
  ): SubtreeBlock[] {
    const minimumRouteOverlaps = Math.min(
      ...variants.map((variant) => variant.routeOverlapCount),
    );
    const safetyGroup = variants.filter((variant) =>
      variant.routeOverlapCount === minimumRouteOverlaps,
    );
    const minimumRatioError = Math.min(
      ...safetyGroup.map((variant) => this.ratioError(variant, target)),
    );
    const ratioSuitable = safetyGroup.filter((variant) =>
      this.ratioError(variant, target) <=
        minimumRatioError + this.finalRatioTolerance(),
    );

    return [...ratioSuitable].sort((a, b) =>
      a.rankInversionCount - b.rankInversionCount ||
      a.peerBandCount - b.peerBandCount ||
      a.peerBandImbalance - b.peerBandImbalance ||
      a.rowCount - b.rowCount ||
      a.singletonTailCount - b.singletonTailCount ||
      a.peerBandDelay - b.peerBandDelay ||
      a.physicalWidth * a.physicalHeight - b.physicalWidth * b.physicalHeight ||
      a.maxPeerBandOffset - b.maxPeerBandOffset ||
      a.connectorLength - b.connectorLength ||
      a.rowImbalance - b.rowImbalance ||
      this.ratioError(a, target) - this.ratioError(b, target) ||
      a.signature.localeCompare(b.signature)
    );
  }

  private finalRatioTolerance(): number {
    return FINAL_RATIO_TOLERANCE;
  }

  private rankVariantsForTarget(
    variants: SubtreeBlock[],
    target: number,
  ): SubtreeBlock[] {
    const entries = variants.map((variant) => ({
      variant,
      ratioError: this.ratioError(variant, target),
      ratioTier: 0,
    }));
    const minimumErrors = new Map<string, number>();
    const ratioTierWidth = this.ratioTierWidth(target);

    for (const entry of entries) {
      const key = this.safetyGroupKey(entry.variant);
      minimumErrors.set(
        key,
        Math.min(minimumErrors.get(key) ?? Infinity, entry.ratioError),
      );
    }
    for (const entry of entries) {
      const minimumError = minimumErrors.get(this.safetyGroupKey(entry.variant))!;
      entry.ratioTier = Math.floor(
        Math.max(0, entry.ratioError - minimumError - 0.000001) / ratioTierWidth,
      );
    }

    return entries.sort((a, b) =>
      a.variant.routeOverlapCount - b.variant.routeOverlapCount ||
      a.ratioTier - b.ratioTier ||
      a.variant.rankInversionCount - b.variant.rankInversionCount ||
      a.variant.peerBandCount - b.variant.peerBandCount ||
      a.variant.peerBandImbalance - b.variant.peerBandImbalance ||
      a.variant.rowCount - b.variant.rowCount ||
      a.variant.singletonTailCount - b.variant.singletonTailCount ||
      a.variant.peerBandDelay - b.variant.peerBandDelay ||
      a.variant.physicalWidth * a.variant.physicalHeight -
        b.variant.physicalWidth * b.variant.physicalHeight ||
      a.variant.maxPeerBandOffset - b.variant.maxPeerBandOffset ||
      a.variant.connectorLength - b.variant.connectorLength ||
      a.variant.rowImbalance - b.variant.rowImbalance ||
      a.ratioError - b.ratioError ||
      a.variant.signature.localeCompare(b.variant.signature)
    ).map((entry) => entry.variant);
  }

  private safetyGroupKey(variant: SubtreeBlock): string {
    return String(variant.routeOverlapCount);
  }

  private ratioTierWidth(target: number): number {
    const distanceFromSquare = Math.abs(Math.log2(target));
    return Math.max(
      RATIO_TOLERANCE,
      MAX_RATIO_TIER_WIDTH / (1 + RATIO_EXTREMENESS_WEIGHT * distanceFromSquare),
    );
  }

  private ratioError(variant: SubtreeBlock, target: number): number {
    return Math.abs(Math.log((variant.physicalWidth / variant.physicalHeight) / target));
  }

  private minVariant(
    variants: SubtreeBlock[],
    metric: (variant: SubtreeBlock) => number,
  ): SubtreeBlock {
    return [...variants].sort((a, b) =>
      metric(a) - metric(b) || a.signature.localeCompare(b.signature),
    )[0]!;
  }

  private minHierarchyVariant(variants: SubtreeBlock[]): SubtreeBlock {
    return [...variants].sort((a, b) =>
      a.rankInversionCount - b.rankInversionCount ||
      a.routeOverlapCount - b.routeOverlapCount ||
      a.peerBandCount - b.peerBandCount ||
      a.rowCount - b.rowCount ||
      a.peerBandDelay - b.peerBandDelay ||
      a.maxPeerBandOffset - b.maxPeerBandOffset ||
      a.singletonTailCount - b.singletonTailCount ||
      a.rowImbalance - b.rowImbalance ||
      a.physicalWidth * a.physicalHeight - b.physicalWidth * b.physicalHeight ||
      a.connectorLength - b.connectorLength ||
      a.signature.localeCompare(b.signature)
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
