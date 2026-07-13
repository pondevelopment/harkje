import { describe, it, expect } from 'vitest';
import { OrgTreeService } from './org-tree.service';
import { FlatNode, OrgNode } from '../models/org.types';

/**
 * Unit tests for OrgTreeService — the tree <-> flat conversion that guards
 * the data-model invariants (golden rule). Pure logic, no Angular DI.
 */
describe('OrgTreeService', () => {
  const service = new OrgTreeService();

  const makeTree = (): OrgNode => ({
    id: '1',
    name: 'CEO',
    title: 'CEO',
    department: 'Executive',
    details: 'Runs the company',
    children: [
      {
        id: '2',
        name: 'Alice',
        title: 'VP Eng',
        department: 'Engineering',
        details: 'Leads eng',
        children: [
          { id: '3', name: 'Bob', title: 'Engineer', department: 'Engineering', details: '' },
        ],
      },
      { id: '4', name: 'Carol', title: 'VP Sales', department: 'Sales', details: '' },
    ],
  });

  // ------------------------- flattenTree -------------------------

  describe('flattenTree', () => {
    it('converts nested tree to flat array with correct parentIds', () => {
      const flat = service.flattenTree(makeTree());
      expect(flat).toHaveLength(4);
      expect(flat.map((n) => n.id).sort()).toEqual(['1', '2', '3', '4']);
      const byId = Object.fromEntries(flat.map((n) => [n.id, n]));
      expect(byId['1']!.parentId).toBeNull();
      expect(byId['2']!.parentId).toBe('1');
      expect(byId['3']!.parentId).toBe('2');
      expect(byId['4']!.parentId).toBe('1');
    });

    it('preserves name/title/department/details and defaults empty strings', () => {
      const tree: OrgNode = { id: '1', name: 'Root', title: 'CEO' }; // no department/details
      const flat = service.flattenTree(tree);
      expect(flat[0]).toMatchObject({ name: 'Root', title: 'CEO' });
      expect(flat[0]!.department).toBe('');
      expect(flat[0]!.details).toBe('');
    });

    it('does not mutate the input tree', () => {
      const tree = makeTree();
      const snapshot = JSON.parse(JSON.stringify(tree));
      service.flattenTree(tree);
      expect(tree).toEqual(snapshot);
    });
  });

  // ------------------------- buildTree -------------------------

  describe('buildTree', () => {
    const flat: FlatNode[] = [
      { id: '1', parentId: 'null', name: 'CEO', title: 'CEO', department: 'Executive', details: '' },
      { id: '2', parentId: '1', name: 'Alice', title: 'VP', department: 'Eng', details: '' },
      { id: '3', parentId: '2', name: 'Bob', title: 'Eng', department: 'Eng', details: '' },
    ];

    it('builds a nested tree from a flat list with one root', () => {
      const root = service.buildTree(flat);
      expect(root).not.toBeNull();
      expect(root!.id).toBe('1');
      expect(root!.children).toHaveLength(1);
      expect(root!.children![0]!.id).toBe('2');
      expect(root!.children![0]!.children![0]!.id).toBe('3');
    });

    it('accepts parentId null (not string "null") as root', () => {
      const flatWithNull: FlatNode[] = [
        { id: '1', parentId: null, name: 'CEO', title: 'CEO', department: '', details: '' },
        { id: '2', parentId: '1', name: 'A', title: 'T', department: '', details: '' },
      ];
      const root = service.buildTree(flatWithNull);
      expect(root!.id).toBe('1');
      expect(root!.children).toHaveLength(1);
      expect(root!.children![0]!.id).toBe('2');
    });

    it('treats parentId "null" (string) as the root marker', () => {
      const root = service.buildTree(flat);
      expect(root!.id).toBe('1');
    });

    it('treats parentId "" (empty string) as the root marker', () => {
      const flatEmpty: FlatNode[] = [
        { id: '1', parentId: '', name: 'CEO', title: 'CEO', department: '', details: '' },
      ];
      const root = service.buildTree(flatEmpty);
      expect(root!.id).toBe('1');
    });

    it('makes orphan nodes (parent id missing) into potential roots', () => {
      const flatOrphan: FlatNode[] = [
        { id: '1', parentId: 'null', name: 'CEO', title: 'CEO', department: '', details: '' },
        { id: '2', parentId: '999-missing', name: 'Orphan', title: 'X', department: '', details: '' },
      ];
      const root = service.buildTree(flatOrphan);
      // CEO wins as root[0], orphan stays a dangling root (not attached to CEO).
      expect(root!.id).toBe('1');
      expect(root!.children).toHaveLength(0);
    });

    it('picks the CEO-titled node when multiple roots exist (heuristic)', () => {
      const flatMulti: FlatNode[] = [
        { id: '1', parentId: 'null', name: 'Some Person', title: 'Random', department: '', details: '' },
        { id: '2', parentId: 'null', name: 'Real CEO', title: 'CEO', department: '', details: '' },
        { id: '3', parentId: '1', name: 'Report', title: 'X', department: '', details: '' },
      ];
      const root = service.buildTree(flatMulti);
      expect(root!.id).toBe('2');
    });

    it('returns null for an empty flat list', () => {
      expect(service.buildTree([])).toBeNull();
    });

    it('coerces ids to strings', () => {
      // Pass numeric-ish ids as strings (FlatNode.id is already string).
      const root = service.buildTree(flat);
      expect(typeof root!.id).toBe('string');
      expect(typeof root!.children![0]!.id).toBe('string');
    });
  });

  // ------------------------- round-trip -------------------------

  describe('round-trip', () => {
    it('buildTree(flattenTree(tree)) reproduces structure and ids', () => {
      const tree = makeTree();
      const rebuilt = service.buildTree(service.flattenTree(tree))!;
      expect(rebuilt.id).toBe(tree.id);
      expect(rebuilt.name).toBe(tree.name);
      const collectIds = (n: OrgNode | undefined, acc: string[] = []): string[] => {
        if (!n) return acc;
        acc.push(n.id);
        (n.children ?? []).forEach((c) => collectIds(c, acc));
        return acc;
      };
      expect(collectIds(rebuilt).sort()).toEqual(collectIds(tree).sort());
      // Structure preserved: root has 2 children, first child has 1 child.
      expect(rebuilt.children).toHaveLength(2);
      expect(rebuilt.children![0]!.children).toHaveLength(1);
    });
  });
});
