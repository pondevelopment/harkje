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

    it('throws on multiple roots', () => {
      const csv = 'user,manager,title,department,details\nA,,X,Y,\nB,,X,Y,';
      expect(() => service.buildFlatNodesFromCsv(csv)).toThrow(/root/i);
    });

    it('throws on unresolved manager name', () => {
      const csv = 'user,manager,title,department,details\nAlice,Ghost,VP,Eng,';
      expect(() => service.buildFlatNodesFromCsv(csv)).toThrow();
    });

    it('throws on duplicate names', () => {
      const csv = 'user,manager,title,department,details\nAlice,,CEO,Exec,\nAlice,CEO,VP,Eng,';
      expect(() => service.buildFlatNodesFromCsv(csv)).toThrow(/duplicate/i);
    });

    it('throws on a cycle', () => {
      // One root (Root, id 1) plus a 2-node cycle B↔C. Each row uses the
      // explicit `parentId` column so the `manager` column is ignored, which
      // means unresolved-manager validation passes and we reach the cycle DFS.
      const cyclic =
        'user,manager,title,department,details,id,parentId\n' +
        'Root,,X,Y,,1,null\n' +
        'A,Root,R,Y,,2,1\n' +
        'B,A,R,Y,,3,4\n' +   // B's parent is C (id 4)
        'C,B,R,Y,,4,3\n';   // C's parent is B (id 3)
      expect(() => service.buildFlatNodesFromCsv(cyclic)).toThrow(/cycle/i);
    });

    it('defaults title/department/details to empty strings when columns absent', () => {
      const csv = 'user,manager\nAlice,,';
      const nodes = service.buildFlatNodesFromCsv(csv);
      expect(nodes[0]!.title).toBe('');
      expect(nodes[0]!.department).toBe('');
      expect(nodes[0]!.details).toBe('');
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
  });
});
