import { describe, it, expect } from 'vitest';
import { CsvParserService } from './csv-parser.service';
import { FlatNode } from '../models/org.types';

/**
 * Unit tests for CsvParserService — CSV import/export + validation. Pure logic
 * (no file I/O), so we hardcode CSV strings and FlatNode[] fixtures.
 */
describe('CsvParserService', () => {
  const service = new CsvParserService();

  const sampleNodes: FlatNode[] = [
    { id: '1', parentId: 'null', name: 'CEO', title: 'CEO', department: 'Executive', details: 'Top' },
    { id: '2', parentId: '1', name: 'Alice, VP', title: 'VP Eng', department: 'Engineering', details: '' },
    { id: '3', parentId: '1', name: 'Bob', title: 'VP Sales', department: 'Sales', details: 'Quota' },
  ];

  // ------------------------- flatNodesToCsv -------------------------

  describe('flatNodesToCsv', () => {
    it('emits a header row then one row per node', () => {
      const csv = service.flatNodesToCsv(sampleNodes);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(1 + sampleNodes.length);
      const header = lines[0]!.split(',');
      expect(header).toEqual(['user', 'manager', 'title', 'department', 'details']);
    });

    it('quotes fields containing commas', () => {
      const csv = service.flatNodesToCsv(sampleNodes);
      // "Alice, VP" must be wrapped in quotes.
      expect(csv).toContain('"Alice, VP"');
    });

    it('writes empty manager cell for the root', () => {
      const csv = service.flatNodesToCsv(sampleNodes);
      const lines = csv.trim().split('\n');
      // Root row: "CEO,,CEO,Executive,Top"
      const rootRow = lines[1]!;
      expect(rootRow.startsWith('CEO,')).toBe(true);
    });

    it('writes the manager name (not id) for non-root nodes', () => {
      const csv = service.flatNodesToCsv(sampleNodes);
      const lines = csv.trim().split('\n');
      // Alice's row should list "CEO" as the manager.
      const aliceRow = lines.find((l) => l.includes('Alice, VP'))!;
      expect(aliceRow).toContain('CEO');
    });
  });

  // ------------------------- parseCsvLine -------------------------

  describe('parseCsvLine', () => {
    it('parses a simple comma-separated row', () => {
      expect(service.parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('preserves commas inside quoted fields', () => {
      expect(service.parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
    });

    it('trims whitespace around cells', () => {
      expect(service.parseCsvLine('  a , b ')).toEqual(['a', 'b']);
    });

    it('handles escaped quotes inside quoted fields', () => {
      expect(service.parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
    });
  });

  // --------------------- buildFlatNodesFromCsv ---------------------

  describe('buildFlatNodesFromCsv', () => {
    it('round-trips a flat list through CSV export + import', () => {
      const csv = service.flatNodesToCsv(sampleNodes);
      const imported = service.buildFlatNodesFromCsv(csv);
      expect(imported).toHaveLength(sampleNodes.length);
      // Compare field-by-field (ids may be re-assigned but names align).
      for (let i = 0; i < imported.length; i++) {
        expect(imported[i]!.name).toBe(sampleNodes[i]!.name);
        expect(imported[i]!.title).toBe(sampleNodes[i]!.title);
        expect(imported[i]!.department).toBe(sampleNodes[i]!.department);
        expect(imported[i]!.details).toBe(sampleNodes[i]!.details);
      }
    });

    it('detects headers case-insensitively (user/manager/title/department/details)', () => {
      const csv = 'USER,MANAGER,TITLE,DEPARTMENT,DETAILS\nCEO,,CEO,Executive,Top\nAlice,CEO,VP,Eng,';
      const nodes = service.buildFlatNodesFromCsv(csv);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.name).toBe('CEO');
      expect(nodes[0]!.parentId).toBe('null');
      // Manager column 'CEO' should resolve to the CEO node's id in parentId.
      expect(nodes[1]!.parentId).toBe(nodes[0]!.id);
    });

    it('imports semicolon-delimited CSV', () => {
      const csv =
        'user;manager;title;department\n' +
        'Jane Doe;;CEO;Executive\n' +
        'John Smith;Jane Doe;Engineering Manager;Engineering';
      const nodes = service.buildFlatNodesFromCsv(csv);

      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.parentId).toBe('null');
      expect(nodes[1]!.parentId).toBe(nodes[0]!.id);
      expect(nodes[1]!.department).toBe('Engineering');
    });

    it('accepts alternative header names (name/role/dept)', () => {
      const csv = 'name,manager,role,dept,details\nAlice,,VP,Eng,X';
      const nodes = service.buildFlatNodesFromCsv(csv);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.name).toBe('Alice');
      expect(nodes[0]!.title).toBe('VP');
      expect(nodes[0]!.department).toBe('Eng');
    });

    it('accepts explicit id/parentId columns', () => {
      const csv = 'user,manager,title,department,details,id,parentId\nCEO,,CEO,Exec,,1,null\nAlice,CEO,VP,Eng,,2,1';
      const nodes = service.buildFlatNodesFromCsv(csv);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.id).toBe('1');
      expect(nodes[1]!.id).toBe('2');
      expect(nodes[1]!.parentId).toBe('1');
    });

    it('adds an organization root and warning for multiple explicit roots', () => {
      const csv = 'user,manager,title,department,details\nA,,X,Y,\nB,,X,Y,';
      const nodes = service.buildFlatNodesFromCsv(csv);
      const root = nodes.find((node) => node.parentId === 'null')!;

      expect(root.name).toBe('Organization');
      expect(nodes.filter((node) => node.parentId === root.id)).toHaveLength(2);
      expect(service.warnings).toContain(
        'Added an "Organization" root to connect 2 separate top-level groups.',
      );
    });

    it('creates a user for an unresolved manager name', () => {
      const csv = 'user,manager,title,department,details\nAlice,Ghost,VP,Eng,';
      const nodes = service.buildFlatNodesFromCsv(csv);
      const alice = nodes.find((node) => node.name === 'Alice')!;
      const manager = nodes.find((node) => node.name === 'Ghost')!;

      expect(manager.title).toBe('Manager');
      expect(manager.parentId).toBe('null');
      expect(alice.parentId).toBe(manager.id);
      expect(service.warnings).toEqual([
        'Row 1: manager "Ghost" had no user row; a user was added automatically.',
      ]);
    });

    it('reuses a generated user referenced by multiple reports', () => {
      const csv =
        'user,manager,title,department\n' +
        'Alice,Ghost,VP,Eng\n' +
        'Bob,Ghost,Developer,Eng';
      const nodes = service.buildFlatNodesFromCsv(csv);
      const managers = nodes.filter((node) => node.name === 'Ghost');

      expect(managers).toHaveLength(1);
      expect(nodes.filter((node) => node.parentId === managers[0]!.id)).toHaveLength(2);
    });

    it('adds one organization root for multiple generated manager groups', () => {
      const csv =
        'user,manager,title,department\n' +
        'Alice,Manager One,VP,Eng\n' +
        'Bob,Manager Two,VP,Sales';
      const nodes = service.buildFlatNodesFromCsv(csv);
      const root = nodes.find((node) => node.parentId === 'null')!;

      expect(root.name).toBe('Organization');
      expect(nodes.filter((node) => node.parentId === root.id)).toHaveLength(2);
      expect(service.warnings).toContain(
        'Added an "Organization" root to connect 2 separate top-level groups.',
      );
    });

    it('clears a self-manager relationship and reports a warning', () => {
      const csv =
        'user;manager;title;department\n' +
        'Anouk Hiensch;Anouk Hiensch;Managing Director;Bike Mobility Services B.V.';
      const nodes = service.buildFlatNodesFromCsv(csv);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.parentId).toBe('null');
      expect(service.warnings).toEqual([
        'Row 1: "Anouk Hiensch" listed itself as manager; manager was cleared.',
      ]);
    });

    it('clears an explicit self parent id and reports a warning', () => {
      const csv = 'user,id,parentId\nAlice,person-1,person-1';
      const nodes = service.buildFlatNodesFromCsv(csv);

      expect(nodes[0]!.parentId).toBe('null');
      expect(service.warnings[0]).toContain('manager was cleared');
    });

    it('throws on duplicate names', () => {
      const csv = 'user,manager,title,department,details\nAlice,,CEO,Exec,\nAlice,CEO,VP,Eng,';
      expect(() => service.buildFlatNodesFromCsv(csv)).toThrow(/duplicate/i);
    });

    it('repairs a multi-person cycle by reconnecting its earliest row to the root', () => {
      // One root (Root, id 1) plus a 2-node cycle B↔C. Each row uses the
      // explicit `parentId` column so the `manager` column is ignored, which
      // means unresolved-manager validation passes and we reach the cycle DFS.
      const cyclic =
        'user,manager,title,department,details,id,parentId\n' +
        'Root,,X,Y,,1,null\n' +
        'A,Root,R,Y,,2,1\n' +
        'B,A,R,Y,,3,4\n' +   // B's parent is C (id 4)
        'C,B,R,Y,,4,3\n';   // C's parent is B (id 3)
      const nodes = service.buildFlatNodesFromCsv(cyclic);
      const root = nodes.find((node) => node.name === 'Root')!;
      const b = nodes.find((node) => node.name === 'B')!;
      const c = nodes.find((node) => node.name === 'C')!;

      expect(b.parentId).toBe(root.id);
      expect(c.parentId).toBe(b.id);
      expect(service.warnings).toContain(
        'Manager cycle detected (B -> C); "B" was reassigned from "C" to "Root".',
      );
    });

    it('defaults title/department/details to empty strings when columns absent', () => {
      const csv = 'user,manager\nAlice,,';
      const nodes = service.buildFlatNodesFromCsv(csv);
      expect(nodes[0]!.title).toBe('');
      expect(nodes[0]!.department).toBe('');
      expect(nodes[0]!.details).toBe('');
    });

    it('warns and generates a collision-free id for a blank id cell', () => {
      const csv = 'user,manager,id\nRoot,,1\nAlice,Root,\nBob,Root,1-1';
      const nodes = service.buildFlatNodesFromCsv(csv);

      const root = nodes.find((n) => n.name === 'Root')!;
      const alice = nodes.find((n) => n.name === 'Alice')!;
      const bob = nodes.find((n) => n.name === 'Bob')!;
      // Alice's blank id got a generated (non-colliding) id, not "2" blindly.
      expect(alice.id).not.toBe('');
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
      expect(bob.parentId).toBe(root.id);
      expect(alice.parentId).toBe(root.id);
      expect(service.warnings).toContain(
        'Row 2: blank id for "Alice"; a generated id was used.',
      );
    });

    it('warns when an explicit parentId references a nonexistent id', () => {
      const csv = 'user,manager,title,department,details,id,parentId\nRoot,,X,Y,,1,null\nA,Root,R,Y,,2,typo-3';
      const nodes = service.buildFlatNodesFromCsv(csv);
      const a = nodes.find((n) => n.name === 'A')!;

      expect(a.parentId).toBe('typo-3');
      expect(service.warnings).toContain(
        'Row 2: parentId "typo-3" for "A" does not exist; the node is treated as a separate top-level group.',
      );
    });
  });

  // ------------------------- csvEscape -------------------------

  describe('csvEscape', () => {
    it('does not quote a plain field', () => {
      expect(service.csvEscape('hello')).toBe('hello');
    });
    it('quotes a field containing a comma', () => {
      expect(service.csvEscape('a,b')).toBe('"a,b"');
    });
    it('quotes a field containing a newline', () => {
      expect(service.csvEscape('a\nb')).toBe('"a\nb"');
    });
    it('quotes a field containing a double-quote and escapes it', () => {
      expect(service.csvEscape('say "hi"')).toBe('"say ""hi"""');
    });
  });

  // ------------------------- parseCsvText -------------------------

  describe('parseCsvText', () => {
    it('normalises CRLF and drops trailing empty lines', () => {
      const csv = 'a,b\r\nc,d\r\n\r\n';
      const lines = service.parseCsvText(csv);
      expect(lines).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('preserves content of otherwise-blank cells', () => {
      const lines = service.parseCsvText('a,b\nc,');
      expect(lines).toEqual([['a', 'b'], ['c', '']]);
    });

    it('ignores semicolons inside quoted fields when detecting the delimiter', () => {
      const lines = service.parseCsvText(
        'user;manager;details\nJane;;"Leads sales; marketing"',
      );
      expect(lines).toEqual([
        ['user', 'manager', 'details'],
        ['Jane', '', 'Leads sales; marketing'],
      ]);
    });
  });
});
