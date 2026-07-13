import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_BRANCH_GAP,
  EXPORT_PADDING,
  LayoutPoint,
  LayoutRect,
  LayoutResult,
  LINK_CARD_PADDING,
  MAX_BRANCH_GAP,
  MIN_BRANCH_GAP,
  OrgLayoutService,
} from './org-layout.service';
import { OrgGeneratorService } from './org-generator.service';
import { OrgTreeService } from './org-tree.service';
import { LayoutDirection, OrgNode } from '../models/org.types';

type PositionedNode = d3.HierarchyNode<OrgNode> & { x: number; y: number };

describe('OrgLayoutService', () => {
  const service = new OrgLayoutService();

  const leaf = (id: string, name = id): OrgNode => ({
    id,
    name,
    title: 'Role',
    department: 'Department',
  });

  const makeStar = (count = 6): OrgNode => ({
    id: 'root',
    name: 'Root',
    title: 'CEO',
    department: 'Executive',
    children: Array.from({ length: count }, (_, index) => leaf(`child-${index + 1}`)),
  });

  /** Asymmetric business fixture reproducing the formerly wasted branch space. */
  const makeBusinessTree = (): OrgNode => ({
    id: 'sofia',
    name: 'Sofia Smith',
    title: 'CEO',
    department: 'Executive',
    children: [
      {
        id: 'sam-anderson',
        name: 'Sam Anderson',
        title: 'Engineering Manager',
        department: 'Engineering',
        children: [
          leaf('skyler'),
          {
            id: 'noah',
            name: 'Noah Brown',
            title: 'CS Director',
            department: 'Customer Success',
            children: [leaf('dakota-jackson'), leaf('dakota-kim')],
          },
          {
            id: 'parker-wilson',
            name: 'Parker Wilson',
            title: 'Head of People',
            department: 'People',
            children: [leaf('mila-jackson')],
          },
        ],
      },
      {
        id: 'parker-harris',
        name: 'Parker Harris',
        title: 'Product Manager',
        department: 'Product',
        children: [leaf('avery'), leaf('casey'), leaf('cameron-kim'), leaf('sam-nguyen')],
      },
      {
        id: 'mila-martinez',
        name: 'Mila Martinez',
        title: 'Account Executive',
        department: 'Sales',
        children: [
          { ...leaf('taylor-kim'), children: [leaf('jordan-patel')] },
          { ...leaf('skyler-harris'), children: [leaf('kai-patel')] },
          { ...leaf('noah-jackson'), children: [leaf('cameron-wilson'), leaf('cameron-white')] },
        ],
      },
      {
        id: 'mila-king',
        name: 'Mila King',
        title: 'Program Manager',
        department: 'Operations',
        children: [
          {
            ...leaf('quinn-anderson'),
            children: [{ ...leaf('sam-lewis'), children: [leaf('quinn-thomas')] }],
          },
        ],
      },
      {
        id: 'sam-johnson',
        name: 'Sam Johnson',
        title: 'CTO',
        department: 'Executive',
        children: [leaf('taylor-patel')],
      },
      {
        id: 'rowan-jackson',
        name: 'Rowan Jackson',
        title: 'COO',
        department: 'Executive',
        children: [leaf('alex-wilson')],
      },
    ],
  });

  const positioned = (node: d3.HierarchyNode<OrgNode>): PositionedNode =>
    node as PositionedNode;

  const snapshot = (root: d3.HierarchyNode<OrgNode>) =>
    root.descendants().map((node) => ({
      id: node.data.id,
      x: positioned(node).x,
      y: positioned(node).y,
    }));

  const rectsOverlap = (a: LayoutRect, b: LayoutRect): boolean =>
    a.left < b.right - 0.001 &&
    a.right > b.left + 0.001 &&
    a.top < b.bottom - 0.001 &&
    a.bottom > b.top + 0.001;

  const assertNoCardOverlaps = (root: d3.HierarchyNode<OrgNode>): void => {
    const { rects } = service.computeRectsAndBounds(root);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(
          rectsOverlap(rects[i]!, rects[j]!),
          `cards ${rects[i]!.id} and ${rects[j]!.id} overlap`,
        ).toBe(false);
      }
    }
  };

  const assertCardDimensions = (root: d3.HierarchyNode<OrgNode>): void => {
    for (const rect of service.computeRectsAndBounds(root).rects) {
      expect(rect.right - rect.left).toBeCloseTo(CARD_WIDTH, 8);
      expect(rect.bottom - rect.top).toBeCloseTo(CARD_HEIGHT, 8);
    }
  };

  const segmentIntersectsRect = (
    a: LayoutPoint,
    b: LayoutPoint,
    rect: LayoutRect,
    padding: number,
  ): boolean => {
    const left = rect.left - padding;
    const right = rect.right + padding;
    const top = rect.top - padding;
    const bottom = rect.bottom + padding;
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

  const assertRoutesClearCards = (
    root: d3.HierarchyNode<OrgNode>,
    direction: LayoutDirection,
    result: LayoutResult,
  ): void => {
    const { rects } = service.computeRectsAndBounds(root);
    for (const link of root.links()) {
      const route = service.buildLinkRoute(link, direction, result.routes);
      expect(route.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < route.length; i++) {
        const start = route[i - 1]!;
        const end = route[i]!;
        expect(start.x === end.x || start.y === end.y).toBe(true);
        for (const rect of rects) {
          if (rect.id === link.source.data.id || rect.id === link.target.data.id) continue;
          expect(
            segmentIntersectsRect(start, end, rect, LINK_CARD_PADDING),
            `link ${link.source.data.id}->${link.target.data.id} intersects ${rect.id}`,
          ).toBe(false);
        }
      }
    }
  };

  const layout = (
    data: OrgNode,
    target: number,
    direction = LayoutDirection.TopDown,
    branchGap = DEFAULT_BRANCH_GAP,
  ): { root: d3.HierarchyNode<OrgNode>; result: LayoutResult } => {
    const root = d3.hierarchy(data);
    const result = service.computeTidyLayout(root, direction, branchGap, target);
    assertCardDimensions(root);
    assertNoCardOverlaps(root);
    assertRoutesClearCards(root, direction, result);
    return { root, result };
  };

  const rootRows = (result: LayoutResult): readonly (readonly string[])[] =>
    result.rowsByParent.get('root') ?? result.rowsByParent.get('sofia') ?? [];

  describe('ratio-driven discrete topology', () => {
    it('selects different row partitions instead of scaling one layout', () => {
      const portrait = layout(makeStar(), 0.35);
      const landscape = layout(makeStar(), 4);
      const portraitRows = rootRows(portrait.result);
      const landscapeRows = rootRows(landscape.result);

      expect(portrait.result.signature).not.toBe(landscape.result.signature);
      expect(portraitRows.length).toBeGreaterThan(landscapeRows.length);

      // A topology change cannot be represented by one affine x/y scale.
      const portraitById = new Map(snapshot(portrait.root).map((node) => [node.id, node]));
      const landscapeById = new Map(snapshot(landscape.root).map((node) => [node.id, node]));
      const sharedLandscapeRow = landscapeRows.find((row) => row.length > 1)!;
      const [firstId, secondId] = sharedLandscapeRow;
      expect(landscapeById.get(firstId!)!.y).toBe(landscapeById.get(secondId!)!.y);
      expect(portraitById.get(firstId!)!.y).not.toBe(portraitById.get(secondId!)!.y);
    });

    it('preserves source order row-major for every target ratio', () => {
      const expected = makeStar().children!.map((child) => child.id);
      for (const target of [0.25, 0.5, 1, 16 / 9, 3, 4]) {
        const { result } = layout(makeStar(), target);
        expect(rootRows(result).flat()).toEqual(expected);
      }
    });

    it('keeps configured gaps fixed while ratio changes topology', () => {
      for (const branchGap of [MIN_BRANCH_GAP, DEFAULT_BRANCH_GAP, MAX_BRANCH_GAP]) {
        const { root, result } = layout(makeStar(4), 4, LayoutDirection.TopDown, branchGap);
        const rows = rootRows(result);
        expect(rows).toHaveLength(1);
        const byId = new Map(root.descendants().map((node) => [node.data.id, positioned(node)]));
        const xs = rows[0]!.map((id) => byId.get(id)!.x);
        for (let index = 1; index < xs.length; index++) {
          expect(xs[index]! - xs[index - 1]! - CARD_WIDTH).toBeCloseTo(branchGap, 8);
        }
      }
    });

    it('moves achieved layout ratios monotonically toward wider formats', () => {
      const achieved = [0.35, 0.75, 1, 16 / 9, 3, 4].map((target) =>
        layout(makeStar(), target).result.achievedAspectRatio,
      );
      for (let index = 1; index < achieved.length; index++) {
        expect(achieved[index]!).toBeGreaterThanOrEqual(achieved[index - 1]! - 0.001);
      }
    });

    it('creates an exact target-ratio communication frame without moving cards', () => {
      for (const target of [0.25, 0.75, 1, 4 / 3, 16 / 9, 4]) {
        const { result } = layout(makeStar(), target);
        expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
          .toBeCloseTo(target, 8);
        expect(result.bounds.minX - result.frameBounds.minX)
          .toBeGreaterThanOrEqual(EXPORT_PADDING - 0.001);
        expect(result.bounds.minY - result.frameBounds.minY)
          .toBeGreaterThanOrEqual(EXPORT_PADDING - 0.001);
      }
    });
  });

  describe('contour packing and business geometry', () => {
    it('packs asymmetric sibling subtrees against real contours as rigid blocks', () => {
      const branchGap = DEFAULT_BRANCH_GAP;
      const { root, result } = layout(makeBusinessTree(), 4, LayoutDirection.TopDown, branchGap);
      const rows = rootRows(result);
      expect(rows).toHaveLength(1);
      const rectsById = new Map(
        service.computeRectsAndBounds(root).rects.map((rect) => [rect.id, rect]),
      );
      const childById = new Map((root.children ?? []).map((child) => [child.data.id, child]));
      let exactContourContacts = 0;

      for (let index = 1; index < rows[0]!.length; index++) {
        const left = childById.get(rows[0]![index - 1]!)!;
        const right = childById.get(rows[0]![index]!)!;
        const leftRects = left.descendants().map((node) => rectsById.get(node.data.id)!);
        const rightRects = right.descendants().map((node) => rectsById.get(node.data.id)!);
        let contourGap = Infinity;
        for (const leftRect of leftRects) {
          for (const rightRect of rightRects) {
            if (leftRect.top < rightRect.bottom && leftRect.bottom > rightRect.top) {
              contourGap = Math.min(contourGap, rightRect.left - leftRect.right);
            }
          }
        }
        expect(contourGap).toBeGreaterThanOrEqual(branchGap - 0.001);
        if (Math.abs(contourGap - branchGap) < 0.001) exactContourContacts++;
      }
      expect(exactContourContacts).toBeGreaterThan(0);
    });

    it('is deterministic for topology, positions, routes, and row bands', () => {
      const first = layout(makeBusinessTree(), 0.75);
      const second = layout(makeBusinessTree(), 0.75);
      expect(second.result.signature).toBe(first.result.signature);
      expect(second.result.rowsByParent).toEqual(first.result.rowsByParent);
      expect(second.result.routes).toEqual(first.result.routes);
      expect(snapshot(second.root)).toEqual(snapshot(first.root));
    });

    it('caps candidate frontiers for predictable business performance', () => {
      for (const target of [0.35, 1, 16 / 9, 4]) {
        const { result } = layout(makeBusinessTree(), target);
        expect(result.candidateCount).toBeLessThanOrEqual(32);
      }
    });

    it('recomputes a valid topology for collapsed visible data', () => {
      const root = d3.hierarchy(makeBusinessTree());
      const sam = root.descendants().find((node) => node.data.id === 'sam-anderson')!;
      sam.children = undefined;
      const result = service.computeTidyLayout(
        root,
        LayoutDirection.TopDown,
        DEFAULT_BRANCH_GAP,
        0.75,
      );
      expect(root.descendants().some((node) => node.data.id === 'noah')).toBe(false);
      assertNoCardOverlaps(root);
      assertRoutesClearCards(root, LayoutDirection.TopDown, result);
    });

    it('supports ratio-driven LeftRight layouts and routes', () => {
      const portrait = layout(makeBusinessTree(), 0.5, LayoutDirection.LeftRight);
      const landscape = layout(makeBusinessTree(), 3, LayoutDirection.LeftRight);
      expect(portrait.result.signature).not.toBe(landscape.result.signature);
      expect(portrait.result.frameBounds.treeWidth / portrait.result.frameBounds.treeHeight)
        .toBeCloseTo(0.5, 8);
      expect(landscape.result.frameBounds.treeWidth / landscape.result.frameBounds.treeHeight)
        .toBeCloseTo(3, 8);
    });
  });

  describe('generated organization matrix', () => {
    it('keeps fixed geometry and clear routing across sizes and communication formats', async () => {
      const generator = new OrgGeneratorService();
      const treeService = new OrgTreeService();
      const sizes = ['small', 'medium', 'large'] as const;
      const targets = [0.5, 1, 16 / 9, 3];

      for (const size of sizes) {
        const flat = await generator.generateRandomOrgStructure(size, 'business', `ratio-${size}`);
        const data = treeService.buildTree(flat);
        expect(data).not.toBeNull();
        for (const target of targets) {
          const { result } = layout(data!, target);
          expect(result.frameBounds.treeWidth / result.frameBounds.treeHeight)
            .toBeCloseTo(target, 8);
          expect(result.candidateCount).toBeLessThanOrEqual(32);
        }
      }
    });
  });
});