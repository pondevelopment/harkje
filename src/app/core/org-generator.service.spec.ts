import { describe, it, expect } from 'vitest';
import {
  ORG_SIZE_RANGES,
  ORG_SIZES,
  OrgGeneratorService,
} from './org-generator.service';
import { FlatNode } from '../models/org.types';

/**
 * Unit tests for OrgGeneratorService — determinism + data-model invariants.
 * The generator must produce a valid single-root tree with no orphans/cycles,
 * and be fully deterministic per (size, theme, nonce).
 */
describe('OrgGeneratorService', () => {
  const service = new OrgGeneratorService();

  /** Verify a FlatNode[] forms exactly one root + every parent resolves. */
  const assertValidTree = (nodes: FlatNode[]): void => {
    expect(nodes.length).toBeGreaterThan(0);
    const ids = new Set(nodes.map((n) => String(n.id)));
    const roots = nodes.filter(
      (n) => n.parentId === null || String(n.parentId).toLowerCase() === 'null',
    );
    expect(roots).toHaveLength(1);
    for (const n of nodes) {
      if (n.parentId === null || String(n.parentId).toLowerCase() === 'null') continue;
      expect(ids.has(String(n.parentId)), `parent ${n.parentId} of ${n.id} resolves`).toBe(true);
    }
  };

  // ---------------- size buckets ----------------

  describe('generateRandomOrgStructure — sizes', () => {
    for (const size of ORG_SIZES) {
      const range = ORG_SIZE_RANGES[size];

      it(`${size} produces ~${range.min}-${range.max} nodes`, async () => {
        const nodes = await service.generateRandomOrgStructure(size, 'Default', 1);
        assertValidTree(nodes);
        expect(nodes.length).toBeGreaterThanOrEqual(range.min);
        expect(nodes.length).toBeLessThanOrEqual(range.max);
      });
    }
  });

  // ---------------- determinism ----------------

  describe('determinism', () => {
    it('same (size, theme, nonce) → identical output', async () => {
      const a = await service.generateRandomOrgStructure('M', 'Default', 42);
      const b = await service.generateRandomOrgStructure('M', 'Default', 42);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('different nonce → different output', async () => {
      const a = await service.generateRandomOrgStructure('M', 'Default', 1);
      const b = await service.generateRandomOrgStructure('M', 'Default', 2);
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('missing nonce vs empty-string nonce behave consistently', async () => {
      const omitted = await service.generateRandomOrgStructure('S', 'Default', undefined);
      const empty = await service.generateRandomOrgStructure('S', 'Default', '');
      // Both treat the salt as empty, so outputs should match.
      expect(JSON.stringify(omitted)).toBe(JSON.stringify(empty));
    });

    it('different theme → different output (same size+nonce)', async () => {
      const a = await service.generateRandomOrgStructure('M', 'Alpha', 7);
      const b = await service.generateRandomOrgStructure('M', 'Beta', 7);
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });
  });

  // ---------------- invariants ----------------

  describe('invariants', () => {
    it('output has exactly one root and all parents resolve', async () => {
      for (const size of ORG_SIZES) {
        const nodes = await service.generateRandomOrgStructure(size, 'Default', 3);
        assertValidTree(nodes);
      }
    });

    it('ids are unique sequential strings starting at "1"', async () => {
      const nodes = await service.generateRandomOrgStructure('M', 'Default', 1);
      const ids = nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe('1');
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
    });

    it('the root is titled "CEO" in department "Executive"', async () => {
      const nodes = await service.generateRandomOrgStructure('M', 'Default', 1);
      const root = nodes.find((n) => n.parentId === 'null')!;
      expect(root.title).toBe('CEO');
      expect(root.department).toBe('Executive');
    });

    it('every node has a non-empty name, title, and department', async () => {
      const nodes = await service.generateRandomOrgStructure('L', 'Default', 1);
      for (const n of nodes) {
        expect(n.name.length).toBeGreaterThan(0);
        expect(n.title.length).toBeGreaterThan(0);
        expect(n.department.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------- generateOrgStructure ----------------

  describe('generateOrgStructure', () => {
    it('is deterministic for the same description', async () => {
      const a = await service.generateOrgStructure('a global fintech with 5 teams');
      const b = await service.generateOrgStructure('a global fintech with 5 teams');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('different descriptions → different output', async () => {
      const a = await service.generateOrgStructure('a tiny startup');
      const b = await service.generateOrgStructure('a large enterprise');
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('produces a valid tree', async () => {
      const nodes = await service.generateOrgStructure('a healthtech with 12 teams');
      assertValidTree(nodes);
    });

    it('falls back to a default seed for empty description', async () => {
      const a = await service.generateOrgStructure('');
      const b = await service.generateOrgStructure('   ');
      // Both empty/whitespace → same default seed.
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
