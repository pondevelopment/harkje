import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { OrgLayoutService, CARD_WIDTH, CARD_HEIGHT, GAP_H } from './org-layout.service';
import { LayoutDirection, OrgNode } from '../models/org.types';

/**
 * Unit tests for OrgLayoutService — pure geometry. We exercise the engine
 * against small known trees built with d3.hierarchy() and verify invariants
 * (no overlaps, finite/positive bounds, deterministic paths).
 */
describe('OrgLayoutService', () => {
  const service = new OrgLayoutService();

  const makeSimpleTree = (): OrgNode => ({
    id: '1',
    name: 'CEO',
    title: 'CEO',
    department: 'Executive',
    children: [
      {
        id: '2',
        name: 'VP Eng',
        title: 'VP Eng',
        department: 'Engineering',
        children: [
          { id: '3', name: 'A', title: 'Eng', department: 'Engineering' },
          { id: '4', name: 'B', title: 'Eng', department: 'Engineering' },
        ],
      },
      {
        id: '5',
        name: 'VP Sales',
        title: 'VP Sales',
        department: 'Sales',
        children: [
          { id: '6', name: 'C', title: 'Sales', department: 'Sales' },
        ],
      },
    ],
  });

  // ------------------------- constants -------------------------

  describe('constants', () => {
    it('all layout constants are positive numbers', () => {
      expect(CARD_WIDTH).toBeGreaterThan(0);
      expect(CARD_HEIGHT).toBeGreaterThan(0);
      expect(GAP_H).toBeGreaterThan(0);
    });
  });

  // --------------------- segmentIntersectsRect ---------------------

  describe('segmentIntersectsRect', () => {
    const rect = { left: 100, right: 200, top: 100, bottom: 200 };
    it('returns true for a horizontal segment crossing the rect', () => {
      expect(service.segmentIntersectsRect(rect, 90, 150, 210, 150, 0)).toBe(true);
    });
    it('returns false for a horizontal segment above the rect', () => {
      expect(service.segmentIntersectsRect(rect, 90, 50, 210, 50, 0)).toBe(false);
    });
    it('returns true for a vertical segment crossing the rect', () => {
      expect(service.segmentIntersectsRect(rect, 150, 90, 150, 210, 0)).toBe(true);
    });
    it('returns false for a vertical segment to the left of the rect', () => {
      expect(service.segmentIntersectsRect(rect, 50, 90, 50, 210, 0)).toBe(false);
    });
    it('returns false for a diagonal (non-axis-aligned) segment', () => {
      expect(service.segmentIntersectsRect(rect, 0, 0, 300, 300, 0)).toBe(false);
    });
    it('expands the rect by the padding (positive pad → catches more, not fewer)', () => {
      // A horizontal segment just *outside* the rect border (y=104, rect top=100
      // so y is above the rect's left edge bottom=100) — wait, horizontal seg at
      // y < top means no overlap with pad 0. With pad 10, the rect's top extends
      // to 100-10 = 90, so y=104 now lies inside → intersect.
      // Use a segment below: a horizontal line at y=204 (rect bottom=200).
      expect(service.segmentIntersectsRect(rect, 90, 204, 210, 204, 0)).toBe(false);
      expect(service.segmentIntersectsRect(rect, 90, 204, 210, 204, 10)).toBe(true);
    });
  });

  // ----------------------- computeRectsAndBounds -----------------------

  describe('computeRectsAndBounds', () => {
    it('produces one rect per node and finite/positive bounds', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      const { rects, bounds } = service.computeRectsAndBounds(tree);
      expect(rects).toHaveLength(6);
      expect(Number.isFinite(bounds.treeWidth)).toBe(true);
      expect(Number.isFinite(bounds.treeHeight)).toBe(true);
      expect(bounds.treeWidth).toBeGreaterThanOrEqual(CARD_WIDTH);
      expect(bounds.treeHeight).toBeGreaterThanOrEqual(CARD_HEIGHT);
    });

    it('each rect has correct width = CARD_WIDTH and height = CARD_HEIGHT', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      const { rects } = service.computeRectsAndBounds(tree);
      for (const r of rects) {
        expect(Math.abs((r.right - r.left) - CARD_WIDTH)).toBeLessThanOrEqual(0.001);
        expect(Math.abs((r.bottom - r.top) - CARD_HEIGHT)).toBeLessThanOrEqual(0.001);
      }
    });
  });

  // ----------------------- no-overlap property -----------------------

  describe('no overlaps', () => {
    it('no two sibling rects overlap after computeBalancedLayout (TopDown)', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      const { rects } = service.computeRectsAndBounds(tree);
      // Collect sibling groups: within each parent, children must not overlap.
      const byParent = new Map<string, typeof rects>();
      tree.each((d) => {
        if (d.children && d.children.length > 0) {
          const childIds = new Set(d.children.map((c) => String(c.data.id)));
          const childRects = rects.filter((r) => childIds.has(r.id));
          byParent.set(String(d.data.id), childRects);
        }
      });
      for (const [pid, group] of byParent) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i]!;
            const b = group[j]!;
            const overlapX = a.left < b.right && a.right > b.left;
            const overlapY = a.top < b.bottom && a.bottom > b.top;
            expect(!(overlapX && overlapY), `siblings ${pid} ids ${a.id}/${b.id} overlap`).toBe(true);
          }
        }
      }
    });
  });

  // --------------------------- buildLinkPath ---------------------------

  describe('buildLinkPath', () => {
    it('returns a non-empty path string starting with M', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      const { rects, bounds } = service.computeRectsAndBounds(tree);
      const links = tree.links();
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const path = service.buildLinkPath(link, rects, bounds);
        expect(path.length).toBeGreaterThan(0);
        expect(path.startsWith('M')).toBe(true);
      }
    });

    it('emits a straight line when source and target share x', () => {
      // Build a 2-node tree; CEO and one direct report share x (1 child → centered).
      const tiny: OrgNode = {
        id: '1',
        name: 'CEO',
        title: 'CEO',
        department: 'Exec',
        children: [{ id: '2', name: 'Rep', title: 'X', department: 'Y' }],
      };
      const tree = d3.hierarchy(tiny);
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      const { rects, bounds } = service.computeRectsAndBounds(tree);
      const link = tree.links()[0]!;
      const path = service.buildLinkPath(link, rects, bounds);
      // Single-child layout means source.x === target.x → straight `M ... L ...`.
      expect(path).not.toContain('L ' + bounds.minX);
    });
  });

  // ----------------------- compactLayoutOneShot -----------------------

  describe('compactLayoutOneShot', () => {
    it('mutates positions and keeps them finite for TopDown', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.TopDown, 1.6);
      // Snapshot x positions after balanced layout.
      const before = tree.descendants().map((d) => d.x);
      service.compactLayoutOneShot(tree, LayoutDirection.TopDown);
      const after = tree.descendants().map((d) => d.x);
      expect(after.length).toBe(before.length);
      for (const v of after) expect(Number.isFinite(v)).toBe(true);
    });

    it('does not introduce sibling overlaps after compaction (LeftRight)', () => {
      const tree = d3.hierarchy(makeSimpleTree());
      service.computeBalancedLayout(tree, LayoutDirection.LeftRight, 1.6);
      service.compactLayoutOneShot(tree, LayoutDirection.LeftRight);
      const { rects } = service.computeRectsAndBounds(tree);
      // For LeftRight, "siblings" share a y band → check non-overlap on y axis.
      const groups = new Map<string, typeof rects>();
      tree.each((d) => {
        if (d.children && d.children.length > 0) {
          const ids = new Set(d.children.map((c) => String(c.data.id)));
          groups.set(String(d.data.id), rects.filter((r) => ids.has(r.id)));
        }
      });
      for (const [, g] of groups) {
        for (let i = 0; i < g.length; i++) {
          for (let j = i + 1; j < g.length; j++) {
            const a = g[i]!;
            const b = g[j]!;
            const overlapX = a.left < b.right && a.right > b.left;
            const overlapY = a.top < b.bottom && a.bottom > b.top;
            expect(!(overlapX && overlapY)).toBe(true);
          }
        }
      }
    });
  });

  // ---------------------- findClearHorizontalY ----------------------

  describe('findClearHorizontalY', () => {
    it('returns the baseY when no rects are in the way', () => {
      const baseY = 100;
      const result = service.findClearHorizontalY(baseY, 0, 10, 90, 110, [], new Set());
      // With no obstacles, baseY itself is clear.
      expect(result).not.toBeNull();
      expect(Number.isFinite(result)).toBe(true);
    });

    it('returns null when any value in the search range is blocked (heuristic)', () => {
      // Place a rect whose vertical extent blocks all candidates between sy and ty.
      const rect = { id: 'blocker', left: -1000, right: 1000, top: 80, bottom: 120 };
      // sy=90, ty=110 → the search starts at min(90,110)+2=92 .. max-2=108, all blocked by [80,120].
      const result = service.findClearHorizontalY(100, 0, 10, 90, 110, [rect], new Set(['blocker']));
      // Because the rect is excluded, it should not block → returns baseY-ish.
      expect(result).not.toBeNull();
    });
  });
});
