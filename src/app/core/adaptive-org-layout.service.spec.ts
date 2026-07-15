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
interface CandidateProbe {
  logicalWidth: number;
  physicalWidth: number;
  physicalHeight: number;
  rankInversionCount: number;
  routeOverlapCount: number;
  peerBandCount: number;
  peerBandImbalance: number;
  rowCount: number;
  singletonTailCount: number;
  peerBandDelay: number;
  maxPeerBandOffset: number;
  connectorLength: number;
  rowImbalance: number;
  signature: string;
  rowsByParent: Map<string, string[][]>;
}
interface LayoutServiceProbe {
  frontierCache: WeakMap<
    d3.HierarchyNode<OrgNode>,
    Map<LayoutDirection, CandidateProbe[]>
  >;
  finalRatioTolerance(): number;
  hierarchyDominates(better: CandidateProbe, worse: CandidateProbe): boolean;
  buildVariants(
    node: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
    memo: Map<d3.HierarchyNode<OrgNode>, CandidateProbe[]>,
  ): CandidateProbe[];
  composeVariantRaw(
    node: d3.HierarchyNode<OrgNode>,
    children: CandidateProbe[],
    rows: number[][],
    direction: LayoutDirection,
  ): CandidateProbe | null;
  generatePartitions(
    children: CandidateProbe[],
    direction: LayoutDirection,
  ): number[][][];
  isVariantValid(candidate: CandidateProbe): boolean;
}

describe('AdaptiveOrgLayoutService', () => {
  const service = new AdaptiveOrgLayoutService();
  const serviceProbe = service as unknown as LayoutServiceProbe;
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
  const makeParkerCrossingTree = (): OrgNode => ({
    ...leaf('sofia-walker'),
    title: 'CEO',
    children: [
      {
        ...leaf('kai-garcia'),
        children: [leaf('noah-johnson'), leaf('rowan-anderson'), leaf('morgan-king')],
      },
      {
        ...leaf('avery-jackson'),
        children: [
          { ...leaf('sam-harris'), children: [leaf('jamie-harris')] },
          leaf('casey-anderson'),
          leaf('taylor-smith'),
        ],
      },
      {
        ...leaf('kai-nguyen'),
        children: [leaf('taylor-johnson'), leaf('parker-lewis')],
      },
      {
        ...leaf('parker-smith'),
        children: [leaf('riley-clark'), leaf('skyler-white')],
      },
      leaf('alex-brown'),
    ],
  });
  const makeCameronPeerPackingTree = (): OrgNode => ({
    ...leaf('cameron-walker'),
    title: 'CEO',
    children: [
      {
        ...leaf('rowan-smith'),
        children: [leaf('casey-martinez'), leaf('rowan-king'), leaf('jamie-garcia-devops')],
      },
      {
        ...leaf('kai-walker'),
        children: [leaf('sofia-wilson'), leaf('kai-martinez'), leaf('mila-white')],
      },
      { ...leaf('kai-wilson'), children: [leaf('taylor-wilson')] },
      {
        ...leaf('jamie-young'),
        children: [
          {
            ...leaf('alex-nguyen'),
            children: [
              leaf('jamie-garcia-growth'),
              { ...leaf('jordan-martinez'), children: [leaf('morgan-jackson')] },
            ],
          },
          leaf('casey-anderson'),
          leaf('morgan-nguyen'),
          leaf('reese-nguyen'),
        ],
      },
    ],
  });
  const orderedTreeShapes = (() => {
    const memo = new Map<number, string[]>([[1, ['()']]]);
    const compositions = (total: number): number[][] => {
      if (total === 0) return [[]];
      const result: number[][] = [];
      for (let first = 1; first <= total; first++) {
        for (const rest of compositions(total - first)) result.push([first, ...rest]);
      }
      return result;
    };
    const cartesian = (groups: readonly string[][]): string[][] =>
      groups.reduce<string[][]>(
        (products, group) => products.flatMap((product) =>
          group.map((value) => [...product, value])),
        [[]],
      );
    const build = (count: number): string[] => {
      const cached = memo.get(count);
      if (cached) return cached;
      const shapes = new Set<string>();
      for (const childSizes of compositions(count - 1)) {
        const childGroups = childSizes.map((size) => build(size));
        for (const children of cartesian(childGroups)) {
          shapes.add(`(${children.join('')})`);
        }
      }
      const result = Array.from(shapes).sort();
      memo.set(count, result);
      return result;
    };
    return build;
  })();
  const treeFromShape = (shape: string): OrgNode => {
    let cursor = 0;
    let nextId = 1;
    const parse = (): OrgNode => {
      if (shape[cursor] !== '(') throw new Error(`Invalid tree shape at ${cursor}: ${shape}`);
      cursor++;
      const node = leaf(`shape-${nextId++}`);
      const children: OrgNode[] = [];
      while (shape[cursor] === '(') children.push(parse());
      if (shape[cursor] !== ')') throw new Error(`Unclosed tree shape at ${cursor}: ${shape}`);
      cursor++;
      if (children.length > 0) node.children = children;
      return node;
    };
    const root = parse();
    if (cursor !== shape.length) throw new Error(`Trailing tree shape data: ${shape}`);
    return root;
  };
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
  const rangesIntersect = (a1: number, a2: number, b1: number, b2: number): boolean =>
    Math.max(Math.min(a1, a2), Math.min(b1, b2)) <=
      Math.min(Math.max(a1, a2), Math.max(b1, b2)) + 0.001;
  const routeSegmentsIntersect = (
    aStart: LayoutPoint,
    aEnd: LayoutPoint,
    bStart: LayoutPoint,
    bEnd: LayoutPoint,
  ): boolean => {
    const aHorizontal = Math.abs(aStart.y - aEnd.y) < 0.001;
    const bHorizontal = Math.abs(bStart.y - bEnd.y) < 0.001;
    if (aHorizontal && bHorizontal) {
      return Math.abs(aStart.y - bStart.y) < 0.001 &&
        rangesIntersect(aStart.x, aEnd.x, bStart.x, bEnd.x);
    }
    if (!aHorizontal && !bHorizontal) {
      return Math.abs(aStart.x - bStart.x) < 0.001 &&
        rangesIntersect(aStart.y, aEnd.y, bStart.y, bEnd.y);
    }
    const horizontalStart = aHorizontal ? aStart : bStart;
    const horizontalEnd = aHorizontal ? aEnd : bEnd;
    const verticalStart = aHorizontal ? bStart : aStart;
    const verticalEnd = aHorizontal ? bEnd : aEnd;
    return rangesIntersect(horizontalStart.x, horizontalEnd.x, verticalStart.x, verticalStart.x) &&
      rangesIntersect(verticalStart.y, verticalEnd.y, horizontalStart.y, horizontalStart.y);
  };
  const foreignRouteIntersections = (
    root: d3.HierarchyNode<OrgNode>,
    result: LayoutResult,
  ): { firstOwner: string; secondOwner: string; point?: LayoutPoint }[] => {
    const routes = root.links().map((link) => ({
      owner: link.source.data.id,
      route: service.buildLinkRoute(link, result.routes),
    }));
    const conflicts: { firstOwner: string; secondOwner: string; point?: LayoutPoint }[] = [];
    for (let first = 0; first < routes.length; first++) {
      for (let second = first + 1; second < routes.length; second++) {
        const a = routes[first]!;
        const b = routes[second]!;
        if (a.owner === b.owner) continue;
        for (let aIndex = 1; aIndex < a.route.length; aIndex++) {
          for (let bIndex = 1; bIndex < b.route.length; bIndex++) {
            if (routeSegmentsIntersect(
              a.route[aIndex - 1]!,
              a.route[aIndex]!,
              b.route[bIndex - 1]!,
              b.route[bIndex]!,
            )) {
              conflicts.push({ firstOwner: a.owner, secondOwner: b.owner });
            }
          }
        }
      }
    }
    return conflicts;
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
    expect(foreignRouteIntersections(root, result)).toEqual([]);
    expect(result.candidateCount).toBeLessThanOrEqual(32);
    expect(direction === LayoutDirection.TopDown || direction === LayoutDirection.LeftRight).toBe(true);
    expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
      .toBeCloseTo(result.targetAspectRatio, 8);

    const frontier = serviceProbe.frontierCache.get(root)?.get(direction);
    expect(frontier).toBeDefined();
    const minimumRouteOverlaps = Math.min(
      ...frontier!.map((candidate) => candidate.routeOverlapCount),
    );
    const safetyGroup = frontier!.filter((candidate) =>
      candidate.routeOverlapCount === minimumRouteOverlaps,
    );
    const ratioError = (candidate: CandidateProbe): number => Math.abs(Math.log(
      (candidate.physicalWidth / candidate.physicalHeight) / result.targetAspectRatio,
    ));
    const bestSafeRatioError = Math.min(...safetyGroup.map(ratioError));
    const selectedRatioError = Math.abs(Math.log(
      result.achievedAspectRatio / result.targetAspectRatio,
    ));
    expect(
      selectedRatioError,
      `content ratio ${result.achievedAspectRatio} exceeds the safe ratio tier for ` +
        `target ${result.targetAspectRatio}`,
    ).toBeLessThanOrEqual(
      bestSafeRatioError + serviceProbe.finalRatioTolerance() + 0.001,
    );
    const ratioSuitable = safetyGroup.filter((candidate) =>
      ratioError(candidate) <=
        bestSafeRatioError + serviceProbe.finalRatioTolerance() + 0.000001,
    );
    const hierarchyBest = [...ratioSuitable].sort((a, b) =>
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
      ratioError(a) - ratioError(b) ||
      a.signature.localeCompare(b.signature)
    )[0]!;
    expect(result.signature).toBe(hierarchyBest.signature);
    for (const candidate of frontier!) {
      expect(frontier!.some((other) =>
        other !== candidate && serviceProbe.hierarchyDominates(other, candidate),
      )).toBe(false);
    }
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

  it('uses a portrait roster, ratio-suitable square bands, and one landscape row', () => {
    const { root, result } = layout(makeStar(4), 1);
    const rows = rootRows(result);
    const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));

    expect(rows.flat()).toEqual(['child-1', 'child-2', 'child-3', 'child-4']);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThan(4);
    for (const row of rows) {
      expect(new Set(row.map((id) => byId.get(id)!.y)).size).toBe(1);
    }
    for (let index = 1; index < rows.length; index++) {
      expect(byId.get(rows[index]![0]!)!.y - byId.get(rows[index - 1]![0]!)!.y)
        .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
    }

    const portrait = layout(makeStar(4), 0.25);
    const landscapeResults = [1, 2, 2.45, 4].map((target) =>
      layout(makeStar(4), target).result,
    );
    for (let index = 1; index < landscapeResults.length; index++) {
      expect(rootRows(landscapeResults[index]!).length)
        .toBeLessThanOrEqual(rootRows(landscapeResults[index - 1]!).length);
    }
    expect(rootRows(landscapeResults.at(-1)!)).toEqual([
      ['child-1', 'child-2', 'child-3', 'child-4'],
    ]);
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
    expect(portrait.result.bounds.minX).toBeLessThanOrEqual(firstRoute[2]!.x);
    expect(portrait.result.frameBounds.minX)
      .toBeLessThanOrEqual(firstRoute[2]!.x - EXPORT_PADDING);
    expect(portrait.result.achievedAspectRatio).toBeLessThan(0.4);
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

  it('lifts Parker Kim peer subtrees instead of using depth as ratio padding', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    const data = trees.buildTree(await generator.generateRandomOrgStructure(
      'M',
      'Default',
      2,
    ));
    expect(data).not.toBeNull();
    const root = d3.hierarchy(data!);
    expect(root.descendants()).toHaveLength(16);
    expect(root.data.name).toBe('Parker Kim');
    expect(root.children?.map((node) => node.data.name)).toEqual([
      'Rowan Allen',
      'Kai Harris',
      'Sam Allen',
      'Noah Jackson',
      'Noah Martinez',
      'Quinn King',
    ]);

    const result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.25);
    assertGeometry(root, LayoutDirection.TopDown, result);
    expect(result.rowsByParent.get('1')).toEqual([['2', '3', '4', '5', '12', '15']]);
    expect(new Set(root.children!.map((node) => positioned(node).y)).size).toBe(1);
    expect(positioned(root.children![0]!).y).toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
    for (const manager of root.children!) {
      for (const descendant of manager.descendants().slice(1)) {
        expect(positioned(descendant).y).toBeGreaterThan(positioned(manager).y);
      }
    }
  });

  it('removes Dakota Garcia peer layouts dominated across child variants', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    const data = trees.buildTree(await generator.generateRandomOrgStructure(
      'M',
      'Default',
      6,
    ));
    expect(data).not.toBeNull();
    const root = d3.hierarchy(data!);
    expect(root.descendants()).toHaveLength(20);
    expect(root.data.name).toBe('Dakota Garcia');
    expect(root.children?.map((node) => node.data.name)).toEqual([
      'Noah Jackson',
      'Rowan Smith',
      'Reese Nguyen',
      'Riley Martinez',
      'Jamie King',
    ]);

    const results = [0.25, 0.5, 1, 2, 4].map((target) => {
      const result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, target);
      assertGeometry(root, LayoutDirection.TopDown, result);
      expect(result.rowsByParent.get('1')).toEqual([['2', '3', '4', '5', '6']]);
      expect(new Set(root.children!.map((node) => positioned(node).y)).size).toBe(1);
      return result;
    });
    expect(new Set(results.map((result) => result.signature)).size).toBeGreaterThan(1);
  });

  it('matches an independent exhaustive parent-partition dominance oracle', () => {
    const root = d3.hierarchy(makeStar(5));
    service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 1);
    const childBlocks = root.children!.map((child) =>
      serviceProbe.buildVariants(
        child,
        LayoutDirection.TopDown,
        new Map(),
      )[0]!,
    );
    const raw: CandidateProbe[] = [];
    for (let mask = 0; mask < 2 ** (childBlocks.length - 1); mask++) {
      const rows: number[][] = [[]];
      for (let index = 0; index < childBlocks.length; index++) {
        rows[rows.length - 1]!.push(index);
        if (
          index < childBlocks.length - 1 &&
          (mask & (1 << index)) !== 0
        ) {
          rows.push([]);
        }
      }
      const candidate = serviceProbe.composeVariantRaw(
        root,
        childBlocks,
        rows,
        LayoutDirection.TopDown,
      );
      if (candidate && serviceProbe.isVariantValid(candidate)) raw.push(candidate);
    }
    expect(raw).toHaveLength(16);
    const oracle = raw.filter((candidate) => !raw.some((other) =>
      other !== candidate && serviceProbe.hierarchyDominates(other, candidate),
    ));
    const frontier = serviceProbe.frontierCache.get(root)!.get(LayoutDirection.TopDown)!;
    const frontierSignatures = new Set(frontier.map((candidate) => candidate.signature));
    for (const candidate of oracle) {
      expect(frontierSignatures.has(candidate.signature)).toBe(true);
    }
  });

  it('bounds large ordered-partition search while preserving aspect anchors', () => {
    const root = d3.hierarchy(makeStar(12));
    const childBlocks = root.children!.map((child) =>
      serviceProbe.buildVariants(
        child,
        LayoutDirection.TopDown,
        new Map(),
      )[0]!,
    );
    const partitions = serviceProbe.generatePartitions(
      childBlocks,
      LayoutDirection.TopDown,
    );
    expect(partitions.length).toBeLessThanOrEqual(32);
    expect(partitions.some((rows) => rows.length === 1)).toBe(true);
    expect(partitions.some((rows) => rows.length === childBlocks.length)).toBe(true);
    expect(new Set(partitions.map((rows) =>
      rows.map((row) => row.length).join('.'),
    )).size).toBe(partitions.length);
    for (const rows of partitions) {
      expect(rows.flat()).toEqual(
        Array.from({ length: childBlocks.length }, (_, index) => index),
      );
    }
  });

  it('keeps geometry invariant when person labels change', () => {
    const rename = (node: OrgNode): OrgNode => ({
      ...node,
      name: `Renamed ${node.id}`,
      title: `Role ${node.id}`,
      department: `Department ${node.id}`,
      children: node.children?.map(rename),
    });
    const original = layout(makeAsymmetricTree(), 2);
    const renamed = layout(rename(makeAsymmetricTree()), 2);
    expect(renamed.result.signature).toBe(original.result.signature);
    expect(renamed.result.routes).toEqual(original.result.routes);
    expect(renamed.root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ])).toEqual(original.root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]));
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

  it('keeps Parker Smith ingress clear of Kai Garcia connector geometry', () => {
    for (const target of [1, 2, 2.5, 3, 4]) {
      const { root, result } = layout(makeParkerCrossingTree(), target);
      const conflicts = foreignRouteIntersections(root, result);
      expect(conflicts, `foreign route conflict at ratio ${target}: ${result.signature}`)
        .toEqual([]);
    }
  });

  it('moves Cameron Walker report blocks upward as the target widens', () => {
    const results = [1, 2, 2.45, 4].map((target) => {
      const { root, result } = layout(makeCameronPeerPackingTree(), target);
      const rows = result.rowsByParent.get('cameron-walker')!;
      const byId = new Map(
        root.descendants().map((node) => [node.data.id, positioned(node)]),
      );

      expect(rows.flat()).toEqual([
        'rowan-smith', 'kai-walker', 'kai-wilson', 'jamie-young',
      ]);
      expect(byId.get('casey-martinez')!.y - byId.get('rowan-smith')!.y)
        .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
      expect(byId.get('sofia-wilson')!.y - byId.get('kai-walker')!.y)
        .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
      expect(byId.get('taylor-wilson')!.y - byId.get('kai-wilson')!.y)
        .toBeCloseTo(CARD_HEIGHT + GAP_V, 8);
      return result;
    });
    expect(new Set(results.map((result) => result.signature)).size).toBeGreaterThan(1);
    for (let index = 1; index < results.length; index++) {
      expect(results[index]!.rowsByParent.get('cameron-walker')!.length)
        .toBeLessThanOrEqual(
          results[index - 1]!.rowsByParent.get('cameron-walker')!.length,
        );
    }
    expect(results.at(-1)!.rowsByParent.get('cameron-walker')).toHaveLength(1);
  });

  it('changes Cameron topology by ratio and restores the cached square block', () => {
    const root = d3.hierarchy(makeCameronPeerPackingTree());
    const subSquare = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.95);
    assertGeometry(root, LayoutDirection.TopDown, subSquare);
    expect(subSquare.rowsByParent.get('cameron-walker')!.flat()).toEqual([
      'rowan-smith',
      'kai-walker',
      'kai-wilson',
      'jamie-young',
    ]);

    const square = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 1);
    assertGeometry(root, LayoutDirection.TopDown, square);
    expect(square.rowsByParent.get('cameron-walker')!.flat()).toEqual([
      'rowan-smith',
      'kai-walker',
      'kai-wilson',
      'jamie-young',
    ]);
    const squarePositions = root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]);
    const squareRoutes = new Map(
      Array.from(square.routes, ([key, route]) => [
        key,
        route.map((point) => ({ ...point })),
      ]),
    );

    const landscape = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 4);
    assertGeometry(root, LayoutDirection.TopDown, landscape);
    expect(landscape.signature).not.toBe(square.signature);
    expect(landscape.rowsByParent.get('cameron-walker'))
      .toEqual(square.rowsByParent.get('cameron-walker'));

    const squareAgain = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 1);
    assertGeometry(root, LayoutDirection.TopDown, squareAgain);
    expect(squareAgain.signature).toBe(square.signature);
    expect(squareAgain.routes).toEqual(squareRoutes);
    expect(root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ])).toEqual(squarePositions);
  });

  it('keeps XXL recursive root subtrees in earliest bands across ratios', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    const data = trees.buildTree(await generator.generateRandomOrgStructure(
      'XXL',
      'Default',
      13,
    ));
    expect(data).not.toBeNull();
    const root = d3.hierarchy(data!);
    expect(root.descendants()).toHaveLength(73);
    expect(root.children?.map((node) => node.data.id)).toEqual(['2', '3', '4', '5', '18']);

    const portrait = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 0.25);
    assertGeometry(root, LayoutDirection.TopDown, portrait);
    expect(portrait.rowsByParent.get('1')!.flat()).toEqual(['2', '3', '4', '5', '18']);

    const landscapeResults = [1, 1.5, 2, 2.45, 3, 4].map((target) => {
      const result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, target);
      assertGeometry(root, LayoutDirection.TopDown, result);
      expect(result.rowsByParent.get('1')!.flat()).toEqual(['2', '3', '4', '5', '18']);
      expect(result.rowsByParent.get('1')).toHaveLength(1);
      return result;
    });
    const landscape = landscapeResults.at(-1)!;
    for (const manager of root.children!) {
      for (const descendant of manager.descendants().slice(1)) {
        expect(positioned(descendant).y).toBeGreaterThan(positioned(manager).y);
      }
    }
    const landscapePositions = root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]);
    const landscapeRoutes = new Map(
      Array.from(landscape.routes, ([key, route]) => [
        key,
        route.map((point) => ({ ...point })),
      ]),
    );

    const landscapeAgain = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 4);
    assertGeometry(root, LayoutDirection.TopDown, landscapeAgain);
    expect(landscapeAgain.signature).toBe(landscape.signature);
    expect(landscapeAgain.routes).toEqual(landscapeRoutes);
    expect(root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ])).toEqual(landscapePositions);
  });

  it('keeps XXL peer roots compact across the complete aspect-ratio sweep', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    const data = trees.buildTree(await generator.generateRandomOrgStructure(
      'XXL',
      'Default',
      2,
    ));
    expect(data).not.toBeNull();
    const root = d3.hierarchy(data!);
    expect(root.descendants()).toHaveLength(76);
    expect(root.children?.map((node) => node.data.id)).toEqual(['2', '3', '4', '5']);

    for (const target of [0.25, 0.5, 0.75, 0.95]) {
      const result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, target);
      assertGeometry(root, LayoutDirection.TopDown, result);
      expect(result.rowsByParent.get('1')).toEqual([['2', '3', '4', '5']]);
    }

    const landscapeResults = [1, 1.25, 1.5, 2, 2.45, 3, 3.5, 4].map((target) => {
      const result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, target);
      assertGeometry(root, LayoutDirection.TopDown, result);
      expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
        .toBeCloseTo(target, 8);
      expect(result.rowsByParent.get('1')).toEqual([['2', '3', '4', '5']]);
      return { target, result };
    });
    const landscape = landscapeResults.at(-1)!.result;
    const landscapePositions = root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ]);
    const landscapeRoutes = new Map(
      Array.from(landscape.routes, ([key, route]) => [
        key,
        route.map((point) => ({ ...point })),
      ]),
    );

    service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 1.5);
    const landscapeAgain = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, 4);
    assertGeometry(root, LayoutDirection.TopDown, landscapeAgain);
    expect(landscapeAgain.signature).toBe(landscape.signature);
    expect(landscapeAgain.routes).toEqual(landscapeRoutes);
    expect(root.descendants().map((node) => [
      node.data.id,
      positioned(node).x,
      positioned(node).y,
    ])).toEqual(landscapePositions);
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
    expect(rootRows(portrait.result)).toHaveLength(1);
    expect(rootRows(landscape.result).flat()).toEqual(rootRows(portrait.result).flat());
    expect(portrait.result.frameBounds.treeWidth / portrait.result.frameBounds.treeHeight).toBeCloseTo(0.5, 8);
    expect(landscape.result.frameBounds.treeWidth / landscape.result.frameBounds.treeHeight).toBeCloseTo(3, 8);
  });

  it('passes every ordered rooted tree shape through six nodes', () => {
    let checkedLayouts = 0;
    for (let nodeCount = 2; nodeCount <= 6; nodeCount++) {
      for (const shape of orderedTreeShapes(nodeCount)) {
        for (const target of [0.25, 1, 4]) {
          const { result } = layout(treeFromShape(shape), target);
          expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
            .toBeCloseTo(target, 8);
          checkedLayouts++;
        }
      }
    }
    expect(checkedLayouts).toBe(192);
  });

  it('passes 70 generated XXS–XXL layouts across the ratio range', async () => {
    const generator = new OrgGeneratorService();
    const trees = new OrgTreeService();
    for (const size of ORG_SIZES) {
      for (let seed = 1; seed <= 2; seed++) {
        const data = trees.buildTree(await generator.generateRandomOrgStructure(
          size,
          'stress',
          `recursive-${size}-${seed}`,
        ));
        expect(data).not.toBeNull();
        const root = d3.hierarchy(data!);
        for (const target of [0.25, 0.5, 1, 2, 4]) {
          let result: LayoutResult;
          try {
            result = service.computeAdaptiveLayout(root, LayoutDirection.TopDown, target);
            assertGeometry(root, LayoutDirection.TopDown, result);
          } catch (error) {
            throw new Error(
              `Generated ${size}/${seed} layout failed at ratio ${target}.`,
              { cause: error },
            );
          }
          expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
            .toBeCloseTo(target, 8);
        }
      }
    }
  });
});
