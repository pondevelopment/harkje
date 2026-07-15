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
  const makeConnectorOwnershipTree = (): OrgNode => ({
    ...leaf('riley-root'),
    children: [
      {
        ...leaf('sam-manager'),
        children: [leaf('noah-report'), leaf('casey-report'), leaf('taylor-report')],
      },
      {
        ...leaf('avery-manager'),
        children: [
          leaf('avery-a'), leaf('avery-b'), leaf('avery-c'), leaf('avery-d'),
          leaf('avery-e'), leaf('avery-f'),
          { ...leaf('avery-g'), children: [leaf('avery-grandchild')] },
        ],
      },
      {
        ...leaf('kai-manager'),
        children: [
          { ...leaf('kai-a'), children: [leaf('kai-a-child')] },
          { ...leaf('kai-b'), children: [leaf('kai-b-child')] },
          leaf('kai-c'),
        ],
      },
      {
        ...leaf('cameron-manager'),
        children: [
          leaf('cameron-a'),
          { ...leaf('cameron-b'), children: [leaf('cameron-b-child')] },
          { ...leaf('cameron-c'), children: [leaf('cameron-c-child')] },
          leaf('cameron-d'),
        ],
      },
    ],
  });
  const makeNoahPeerBandTree = (): OrgNode => ({
    ...leaf('parker'),
    title: 'CEO',
    children: [
      {
        ...leaf('rowan'),
        children: [
          { ...leaf('avery'), children: [leaf('morgan-young')] },
          leaf('morgan-johnson'),
        ],
      },
      {
        ...leaf('kai'),
        children: [leaf('riley-thomas'), leaf('morgan-walker'), leaf('riley-lewis')],
      },
      { ...leaf('sam'), children: [leaf('casey'), leaf('mila')] },
      { ...leaf('noah-jackson'), children: [leaf('rowan-harris')] },
      leaf('noah-martinez'),
      leaf('quinn'),
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
      return a.y > top + 0.001 && a.y < bottom - 0.001 &&
        Math.max(a.x, b.x) > left + 0.001 && Math.min(a.x, b.x) < right - 0.001;
    }
    if (Math.abs(a.x - b.x) < 0.001) {
      return a.x > left + 0.001 && a.x < right - 0.001 &&
        Math.max(a.y, b.y) > top + 0.001 && Math.min(a.y, b.y) < bottom - 0.001;
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
    expect(portrait.signature.startsWith('R:root')).toBe(true);
    const portraitPositions = root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]);
    const portraitRoutes = new Map(
      Array.from(portrait.routes, ([key, route]) => [
        key,
        route.map((point) => ({ ...point })),
      ]),
    );
    const landscape = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 4);
    expect(landscape.signature).not.toBe(portrait.signature);
    const portraitAgain = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.25);
    expect(portraitAgain.signature).toBe(portrait.signature);
    expect(portraitAgain.routes).toEqual(portraitRoutes);
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
          const gap = ordered[index]!.x - ordered[index - 1]!.x - CARD_WIDTH;
          expect(gap).toBeGreaterThanOrEqual(GAP_H - 0.001);
        }
      }
    }
  });

  it('uses a portrait roster, balanced square bands, and one landscape row', () => {
    const { root, result } = layout(makeStar(4), 1);
    const rows = rootRows(result);
    const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));

    expect(rows).toEqual([
      ['child-1', 'child-2'],
      ['child-3', 'child-4'],
    ]);
    expect(byId.get('child-1')!.y).toBe(byId.get('child-2')!.y);
    expect(byId.get('child-3')!.y).toBe(byId.get('child-4')!.y);
    expect(byId.get('child-3')!.y - byId.get('child-1')!.y)
      .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);

    const portrait = layout(makeStar(4), 0.25);
    const landscape = layout(makeStar(4), 4);
    const portraitById = new Map(
      portrait.root.descendants().map((node) => [node.data.id, positioned(node)]),
    );
    const portraitRows = rootRows(portrait.result);
    expect(portraitRows).toEqual([
      ['child-1'],
      ['child-2'],
      ['child-3'],
      ['child-4'],
    ]);
    expect(portrait.result.signature.startsWith('R:root')).toBe(true);
    expect(new Set(
      portraitRows.flat().map((id) => portraitById.get(id)!.x),
    ).size).toBe(1);
    for (let index = 1; index < portraitRows.length; index++) {
      expect(
        portraitById.get(portraitRows[index]![0]!)!.y -
          portraitById.get(portraitRows[index - 1]![0]!)!.y,
      ).toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
    }

    const firstPortraitLink = portrait.root.links().find(
      (link) => link.target.data.id === 'child-1',
    )!;
    const lastPortraitLink = portrait.root.links().find(
      (link) => link.target.data.id === 'child-4',
    )!;
    const firstRoute = service.buildLinkRoute(firstPortraitLink, portrait.result.routes);
    const lastRoute = service.buildLinkRoute(lastPortraitLink, portrait.result.routes);
    expect(firstRoute).toHaveLength(5);
    expect(lastRoute).toHaveLength(5);
    expect(firstRoute[2]!.x).toBe(lastRoute[2]!.x);
    expect(firstRoute[2]!.y).toBe(lastRoute[2]!.y);
    expect(lastRoute.at(-1)!.x).toBeCloseTo(-CARD_WIDTH / 2, 8);
    expect(lastRoute.at(-1)!.y).toBeCloseTo(
      portraitById.get('child-4')!.y + CARD_HEIGHT / 2,
      8,
    );
    expect(portrait.result.achievedAspectRatio).toBeLessThan(0.4);
    expect(rootRows(landscape.result)).toHaveLength(1);
  });

  it('never flattens a visible manager subtree into a portrait roster', () => {
    const data: OrgNode = {
      ...leaf('root'),
      children: [
        { ...leaf('manager'), children: [leaf('manager-report')] },
        leaf('peer-2'),
        leaf('peer-3'),
        leaf('peer-4'),
      ],
    };
    const { root, result } = layout(data, 0.25);
    const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));

    expect(result.signature.startsWith('R:root')).toBe(false);
    expect(result.rowsByParent.get('root')?.flat()).toEqual([
      'manager',
      'peer-2',
      'peer-3',
      'peer-4',
    ]);
    expect(result.rowsByParent.get('manager')).toEqual([['manager-report']]);
    expect(byId.get('manager-report')!.y).toBeGreaterThan(byId.get('manager')!.y);
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

  it('fills an available earlier peer band before opening a lower band', () => {
    const { root, result } = layout(makeNoahPeerBandTree(), 1);
    const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));
    const rows = result.rowsByParent.get('parker')!;

    expect(rows.flat()).toEqual([
      'rowan',
      'kai',
      'sam',
      'noah-jackson',
      'noah-martinez',
      'quinn',
    ]);
    expect(byId.get('noah-jackson')!.y).toBe(byId.get('kai')!.y);
    expect(byId.get('rowan-harris')!.y - byId.get('noah-jackson')!.y)
      .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
  });

  it('keeps connector buses from different managers visually separate', () => {
    const { root, result } = layout(makeConnectorOwnershipTree(), 2.15);
    const links = root.links().map((link) => ({
      sourceId: link.source.data.id,
      targetId: link.target.data.id,
      route: service.buildLinkRoute(link, result.routes),
    }));
    const rileyRoutes = links.filter((link) => link.sourceId === 'riley-root');
    const samRoutes = links.filter((link) => link.sourceId === 'sam-manager');
    expect(rileyRoutes.length).toBeGreaterThan(0);
    expect(samRoutes.length).toBeGreaterThan(0);

    const intersects = (
      aStart: LayoutPoint,
      aEnd: LayoutPoint,
      bStart: LayoutPoint,
      bEnd: LayoutPoint,
    ): boolean => {
      const aHorizontal = aStart.y === aEnd.y;
      const bHorizontal = bStart.y === bEnd.y;
      const overlapsRange = (a1: number, a2: number, b1: number, b2: number) =>
        Math.max(Math.min(a1, a2), Math.min(b1, b2)) <=
          Math.min(Math.max(a1, a2), Math.max(b1, b2)) + 0.001;
      if (aHorizontal && bHorizontal) {
        return aStart.y === bStart.y && overlapsRange(aStart.x, aEnd.x, bStart.x, bEnd.x);
      }
      if (!aHorizontal && !bHorizontal) {
        return aStart.x === bStart.x && overlapsRange(aStart.y, aEnd.y, bStart.y, bEnd.y);
      }
      return false;
    };

    for (const riley of rileyRoutes) {
      for (const sam of samRoutes) {
        for (let rileyIndex = 1; rileyIndex < riley.route.length; rileyIndex++) {
          for (let samIndex = 1; samIndex < sam.route.length; samIndex++) {
            expect(intersects(
              riley.route[rileyIndex - 1]!,
              riley.route[rileyIndex]!,
              sam.route[samIndex - 1]!,
              sam.route[samIndex]!,
            )).toBe(false);
          }
        }
      }
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
        let result: LayoutResult;
        try {
          ({ result } = layout(data!, target));
        } catch (error) {
          throw new Error(`Generated ${size} layout failed at ratio ${target}.`, { cause: error });
        }
        expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight).toBeCloseTo(target, 8);
      }
    }
  });
});
