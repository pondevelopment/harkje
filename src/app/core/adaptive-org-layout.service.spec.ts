import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';
import {
  AdaptiveOrgLayoutService,
  CARD_HEIGHT,
  CARD_WIDTH,
  EXPORT_PADDING,
  GAP_H,
  GAP_V,
  LayoutPoint,
  LayoutRect,
  LayoutResult,
  LINK_CARD_PADDING,
} from './adaptive-org-layout.service';
import { ORG_SIZES, OrgGeneratorService } from './org-generator.service';
import { OrgTreeService } from './org-tree.service';
import { LayoutDirection, OrgNode } from '../models/org.types';

type PositionedNode = d3.HierarchyNode<OrgNode> & { x: number; y: number };

describe('AdaptiveOrgLayoutService', () => {
  const service = new AdaptiveOrgLayoutService();
  const leaf = (id: string): OrgNode => ({
    id,
    name: id,
    title: 'Role',
    department: 'Department',
  });
  const makeStar = (count = 6): OrgNode => ({
    ...leaf('root'),
    title: 'CEO',
    children: Array.from({ length: count }, (_, index) => leaf(`child-${index + 1}`)),
  });
  const makeAsymmetricTree = (): OrgNode => ({
    ...leaf('root'),
    title: 'CEO',
    children: [
      {
        ...leaf('engineering'),
        children: [
          leaf('engineer-1'),
          { ...leaf('engineering-manager'), children: [leaf('engineer-2'), leaf('engineer-3')] },
          leaf('engineer-4'),
        ],
      },
      { ...leaf('product'), children: [leaf('product-1'), leaf('product-2'), leaf('product-3')] },
      {
        ...leaf('sales'),
        children: [
          { ...leaf('sales-manager'), children: [leaf('sales-1'), leaf('sales-2')] },
          leaf('sales-3'),
        ],
      },
      { ...leaf('operations'), children: [{ ...leaf('ops-manager'), children: [leaf('ops-1')] }] },
    ],
  });
  const makePeerBandRegressionTree = (): OrgNode => ({
    ...leaf('cameron'),
    title: 'CEO',
    children: [
      { ...leaf('rowan'), children: [leaf('rowan-a'), leaf('rowan-b'), leaf('rowan-c')] },
      { ...leaf('kai-product'), children: [leaf('product-a'), leaf('product-b'), leaf('product-c')] },
      { ...leaf('kai-sales'), children: [leaf('sales-a')] },
      {
        ...leaf('jamie'),
        children: [
          {
            ...leaf('alex'),
            children: [
              leaf('jamie-marketing'),
              {
                ...leaf('jordan'),
                children: [leaf('morgan-grandchild')],
              },
            ],
          },
          leaf('casey'),
          leaf('morgan'),
          leaf('reese'),
        ],
      },
    ],
  });
  const positioned = (node: d3.HierarchyNode<OrgNode>): PositionedNode => node as PositionedNode;
  const overlaps = (a: LayoutRect, b: LayoutRect): boolean =>
    a.left < b.right - 0.001 && a.right > b.left + 0.001 &&
    a.top < b.bottom - 0.001 && a.bottom > b.top + 0.001;
  const segmentHits = (a: LayoutPoint, b: LayoutPoint, rect: LayoutRect): boolean => {
    const left = rect.left - LINK_CARD_PADDING;
    const right = rect.right + LINK_CARD_PADDING;
    const top = rect.top - LINK_CARD_PADDING;
    const bottom = rect.bottom + LINK_CARD_PADDING;
    if (Math.abs(a.y - b.y) < 0.001) {
      return a.y >= top && a.y <= bottom &&
        Math.max(a.x, b.x) >= left && Math.min(a.x, b.x) <= right;
    }
    if (Math.abs(a.x - b.x) < 0.001) {
      return a.x >= left && a.x <= right &&
        Math.max(a.y, b.y) >= top && Math.min(a.y, b.y) <= bottom;
    }
    return true;
  };
  const assertGeometry = (
    root: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
    result: LayoutResult,
  ): void => {
    const { rects } = service.computeRectsAndBounds(root);
    for (const rect of rects) {
      expect(rect.right - rect.left).toBeCloseTo(CARD_WIDTH, 8);
      expect(rect.bottom - rect.top).toBeCloseTo(CARD_HEIGHT, 8);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
    for (const link of root.links()) {
      const route = service.buildLinkRoute(link, result.routes);
      expect(route.length).toBeGreaterThanOrEqual(2);
      expect(service.buildLinkPath(link, result.routes).startsWith('M')).toBe(true);
      for (let index = 1; index < route.length; index++) {
        const start = route[index - 1]!;
        const end = route[index]!;
        expect(start.x === end.x || start.y === end.y).toBe(true);
        for (const rect of rects) {
          if (rect.id === link.source.data.id || rect.id === link.target.data.id) continue;
          expect(segmentHits(start, end, rect)).toBe(false);
        }
      }
    }
    expect(result.candidateCount).toBeLessThanOrEqual(32);
    expect(direction === LayoutDirection.TopDown || direction === LayoutDirection.LeftRight).toBe(true);
  };
  const layout = (
    data: OrgNode,
    target: number,
    direction = LayoutDirection.TopDown,
  ) => {
    const root = d3.hierarchy(data);
    const result = service.computeAdaptiveLayout(root, direction, target);
    assertGeometry(root, direction, result);
    return { root, result };
  };
  const rootRows = (result: LayoutResult) => result.rowsByParent.get('root') ?? [];

  it('changes ordered row topology rather than scaling one layout', () => {
    const portrait = layout(makeStar(), 0.25);
    const landscape = layout(makeStar(), 4);
    expect(portrait.result.signature).not.toBe(landscape.result.signature);
    expect(rootRows(portrait.result).length).toBeGreaterThan(rootRows(landscape.result).length);
    expect(rootRows(portrait.result).flat()).toEqual(rootRows(landscape.result).flat());
  });

  it('reuses one hierarchy frontier across ratio changes without stale positions', () => {
    const root = d3.hierarchy(makeStar());
    const portrait = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.25);
    const portraitPositions = root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]);
    const landscape = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 4);
    expect(landscape.signature).not.toBe(portrait.signature);
    const portraitAgain = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.25);
    expect(portraitAgain.signature).toBe(portrait.signature);
    expect(root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ])).toEqual(portraitPositions);
  });

  it('keeps fixed card gaps in every selected row', () => {
    for (const target of [0.25, 0.5, 1, 2, 4]) {
      const { root, result } = layout(makeStar(), target);
      const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));
      for (const row of rootRows(result)) {
        const ordered = row.map((id) => byId.get(id)!);
        for (let index = 1; index < ordered.length; index++) {
          expect(ordered[index]!.x - ordered[index - 1]!.x - CARD_WIDTH).toBeCloseTo(GAP_H, 8);
        }
      }
    }
  });

  it('selects monotonically wider layouts and exact-ratio frames', () => {
    const achieved = [0.25, 0.5, 1, 2, 4].map((target) => {
      const { result } = layout(makeAsymmetricTree(), target);
      expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight).toBeCloseTo(target, 8);
      expect(result.bounds.minX - result.frameBounds.minX).toBeGreaterThanOrEqual(EXPORT_PADDING - 0.001);
      expect(result.bounds.minY - result.frameBounds.minY).toBeGreaterThanOrEqual(EXPORT_PADDING - 0.001);
      return result.achievedAspectRatio;
    });
    for (let index = 1; index < achieved.length; index++) {
      expect(achieved[index]!).toBeGreaterThanOrEqual(achieved[index - 1]! - 0.001);
    }
  });

  it('contour-packs asymmetric sibling subtrees', () => {
    const { root, result } = layout(makeAsymmetricTree(), 4);
    expect(rootRows(result)).toHaveLength(1);
    const rects = new Map(service.computeRectsAndBounds(root).rects.map((rect) => [rect.id, rect]));
    let contacts = 0;
    for (let index = 1; index < root.children!.length; index++) {
      const left = root.children![index - 1]!.descendants().map((node) => rects.get(node.data.id)!);
      const right = root.children![index]!.descendants().map((node) => rects.get(node.data.id)!);
      let gap = Infinity;
      for (const a of left) for (const b of right) {
        if (a.top < b.bottom && a.bottom > b.top) gap = Math.min(gap, b.left - a.right);
      }
      expect(gap).toBeGreaterThanOrEqual(GAP_H - 0.001);
      if (Math.abs(gap - GAP_H) < 0.001) contacts++;
    }
    expect(contacts).toBeGreaterThan(0);
  });

  it('does not push a shallow peer below an earlier sibling subtree', () => {
    const { root, result } = layout(makePeerBandRegressionTree(), 2.45);
    const byId = new Map(root.descendants().map((node) => [node.data.id, node]));
    const jamie = positioned(byId.get('jamie')!);
    const alex = byId.get('alex')!;
    const reese = positioned(byId.get('reese')!);
    const deepestAlexDescendant = Math.max(
      ...alex.descendants().slice(1).map((node) => positioned(node).y),
    );
    const rows = result.rowsByParent.get('jamie')!;

    expect(rows.flat()).toEqual(['alex', 'casey', 'morgan', 'reese']);
    expect(reese.y).toBeLessThanOrEqual(deepestAlexDescendant);
    expect(reese.y - jamie.y).toBeLessThanOrEqual(2 * (CARD_HEIGHT + GAP_V));

    const rowBaselines = rows.map((row) => positioned(byId.get(row[0]!)!).y);
    for (let index = 1; index < rowBaselines.length; index++) {
      expect(rowBaselines[index]! - rowBaselines[index - 1]!)
        .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
    }
  });

  it('is deterministic and recomputes collapsed hierarchies', () => {
    const first = layout(makeAsymmetricTree(), 0.75);
    const second = layout(makeAsymmetricTree(), 0.75);
    expect(second.result.signature).toBe(first.result.signature);
    expect(second.result.routes).toEqual(first.result.routes);
    expect(second.root.descendants().map((node) => [node.data.id, positioned(node).x, positioned(node).y]))
      .toEqual(first.root.descendants().map((node) => [node.data.id, positioned(node).x, positioned(node).y]));

    const collapsed = d3.hierarchy(makeAsymmetricTree());
    collapsed.children![0]!.children = undefined;
    const collapsedResult = service.computeAdaptiveLayout(collapsed, LayoutDirection.TopDown, 0.75);
    assertGeometry(collapsed, LayoutDirection.TopDown, collapsedResult);
    expect(collapsed.descendants().some((node) => node.data.id === 'engineer-1')).toBe(false);
  });

  it('supports adaptive LeftRight layout and routing', () => {
    const portrait = layout(makeAsymmetricTree(), 0.5, LayoutDirection.LeftRight);
    const landscape = layout(makeAsymmetricTree(), 3, LayoutDirection.LeftRight);
    expect(portrait.result.signature).not.toBe(landscape.result.signature);
    expect(portrait.result.frameBounds.treeWidth / portrait.result.frameBounds.treeHeight).toBeCloseTo(0.5, 8);
    expect(landscape.result.frameBounds.treeWidth / landscape.result.frameBounds.treeHeight).toBeCloseTo(3, 8);
  });

  it('passes XXS–XXL generated organizations at ratio extremes', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    for (const size of ORG_SIZES) {
      const data = trees.buildTree(await generator.generateRandomOrgStructure(size, 'stress', `adaptive-${size}`));
      expect(data).not.toBeNull();
      for (const target of [0.25, 1, 4]) {
        const { result } = layout(data!, target);
        expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight).toBeCloseTo(target, 8);
      }
    }
  });
});
