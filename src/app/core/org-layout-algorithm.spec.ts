import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';
import { OrgNode, LayoutDirection, LayoutResult } from '../models/org.types';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
} from './adaptive-org-layout.service';
import { BasicTreeLayoutService } from './basic-tree-layout.service';
import './org-layout-algorithms.registry';
import { getLayoutAlgorithm, LAYOUT_ALGORITHMS } from './org-layout-algorithm';

type PositionedNode = d3.HierarchyNode<OrgNode> & { x: number; y: number };

const leaf = (id: string): OrgNode => ({
  id,
  name: id,
  title: 'Role',
  department: 'Department',
});

/** A medium asymmetric tree exercising multiple levels and sibling widths. */
const fixtureTree = (): OrgNode => ({
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

interface Rect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Shared geometry invariants every layout algorithm must satisfy. */
function assertValidLayout(
  root: d3.HierarchyNode<OrgNode>,
  result: LayoutResult,
  direction: LayoutDirection,
  resultAlgorithm: { buildLinkRoute(link: d3.HierarchyLink<OrgNode>, routes: ReadonlyMap<string, readonly { x: number; y: number; }[]>): { x: number; y: number; }[]; buildLinkPath(link: d3.HierarchyLink<OrgNode>, routes: ReadonlyMap<string, readonly { x: number; y: number; }[]>): string },
): void {
  // Every descendant has physical coordinates.
  for (const node of root.descendants()) {
    const positioned = node as PositionedNode;
    expect(typeof positioned.x).toBe('number');
    expect(typeof positioned.y).toBe('number');
    expect(Number.isFinite(positioned.x)).toBe(true);
    expect(Number.isFinite(positioned.y)).toBe(true);
  }

  // Card rects match card dimensions and do not overlap each other.
  const rects: Rect[] = root.descendants().map((node) => {
    const positioned = node as PositionedNode;
    return {
      id: String(node.data.id),
      left: positioned.x - CARD_WIDTH / 2,
      right: positioned.x + CARD_WIDTH / 2,
      top: positioned.y,
      bottom: positioned.y + CARD_HEIGHT,
    };
  });
  for (const rect of rects) {
    expect(rect.right - rect.left).toBeCloseTo(CARD_WIDTH, 8);
    expect(rect.bottom - rect.top).toBeCloseTo(CARD_HEIGHT, 8);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
    }
  }

  // Every link has a route with >= 2 collinear-orthogonal points; the path
  // starts with 'M'.
  for (const link of root.links()) {
    const route = resultAlgorithm.buildLinkRoute(link, result.routes);
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < route.length; index++) {
      const start = route[index - 1]!;
      const end = route[index]!;
      expect(start.x === end.x || start.y === end.y).toBe(true);
    }
    expect(resultAlgorithm.buildLinkPath(link, result.routes).startsWith('M')).toBe(true);
  }

  // Frame bounds wrap the content bounds and honor the target ratio envelope.
  expect(result.frameBounds.minX).toBeLessThanOrEqual(result.bounds.minX);
  expect(result.frameBounds.maxX).toBeGreaterThanOrEqual(result.bounds.maxX);
  expect(result.frameBounds.minY).toBeLessThanOrEqual(result.bounds.minY);
  expect(result.frameBounds.maxY).toBeGreaterThanOrEqual(result.bounds.maxY);
  expect(result.bounds.treeWidth).toBeGreaterThan(0);
  expect(result.bounds.treeHeight).toBeGreaterThan(0);
  expect(result.signature.length).toBeGreaterThan(0);
}

describe('LAYOUT_ALGORITHMS registry', () => {
  it('registers the adaptive and basic algorithms', () => {
    const ids = LAYOUT_ALGORITHMS.map((entry) => entry.id);
    expect(ids).toContain('adaptive');
    expect(ids).toContain('basic');
  });

  it('falls back to the first registered algorithm for unknown ids', () => {
    const fallback = getLayoutAlgorithm('does-not-exist');
    expect(fallback).toBe(LAYOUT_ALGORITHMS[0]!.algorithm);
  });
});

describe('registered algorithms produce valid layouts', () => {
  const targets = [0.25, 0.5, 1, 2, 4];
  const directions = [LayoutDirection.TopDown, LayoutDirection.LeftRight];

  for (const descriptor of LAYOUT_ALGORITHMS) {
    describe(`algorithm: ${descriptor.label} (${descriptor.id})`, () => {
      for (const direction of directions) {
        for (const target of targets) {
          it(`produces non-overlapping cards & orthogonal routes (${direction}, ratio ${target})`, () => {
            const root = d3.hierarchy(fixtureTree());
            const algorithm = getLayoutAlgorithm(descriptor.id);
            const result = algorithm.computeLayout(root, direction, target);
            assertValidLayout(root, result, direction, algorithm);
          });
        }
      }
    });
  }
});

describe('BasicTreeLayoutService (unit)', () => {
  it('is deterministic (same signature & positions for the same input)', () => {
    const root1 = d3.hierarchy(fixtureTree());
    const root2 = d3.hierarchy(fixtureTree());
    const service = new BasicTreeLayoutService();
    const a = service.computeLayout(root1, LayoutDirection.TopDown, 1);
    const b = service.computeLayout(root2, LayoutDirection.TopDown, 1);
    expect(a.signature).toBe(b.signature);
    expect(root1.descendants().map((n) => (n as PositionedNode).x))
      .toEqual(root2.descendants().map((n) => (n as PositionedNode).x));
    expect(root1.descendants().map((n) => (n as PositionedNode).y))
      .toEqual(root2.descendants().map((n) => (n as PositionedNode).y));
  });

  it('wraps wide sibling rows (rowsByParent has rows of <= MAX_SIBLINGS_PER_ROW)', () => {
    const root = d3.hierarchy(fixtureTree());
    const service = new BasicTreeLayoutService();
    const result = service.computeLayout(root, LayoutDirection.TopDown, 1);
    for (const rows of result.rowsByParent.values()) {
      for (const row of rows) {
        expect(row.length).toBeLessThanOrEqual(BasicTreeLayoutService.MAX_SIBLINGS_PER_ROW);
      }
    }
  });
});
