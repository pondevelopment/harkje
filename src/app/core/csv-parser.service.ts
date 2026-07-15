import { Injectable } from '@angular/core';
import { FlatNode } from '../models/org.types';

/**
 * CSV import/export for org structures. Mirrors the original React logic:
 * flexible header detection (`user`/`manager`/`title`/`department`/`details`
 * with aliases), manager-name → id resolution, explicit-id support, cycle
 * detection, duplicate-name detection, single-root enforcement.
 */
@Injectable({ providedIn: 'root' })
export class CsvParserService {
  csvEscape(value: string): string {
    const v = value ?? '';
    if (/[\n\r",]/.test(v)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }

  flatNodesToCsv(flatNodes: FlatNode[]): string {
    const idToName = new Map<string, string>();
    for (const n of flatNodes) idToName.set(String(n.id), n.name || '');

    const header = ['user', 'manager', 'title', 'department', 'details'];
    const lines = [header.join(',')];

    for (const n of flatNodes) {
      const pid = n.parentId;
      const isRoot = pid === null || String(pid).toLowerCase() === 'null' || pid === '';
      const managerName = isRoot ? '' : (idToName.get(String(pid)) ?? '');
      lines.push(
        [
          this.csvEscape(n.name || ''),
          this.csvEscape(managerName),
          this.csvEscape(n.title || ''),
          this.csvEscape(n.department || ''),
          this.csvEscape(n.details || ''),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          const next = line[i + 1];
          if (next === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  parseCsvText(text: string): string[][] {
    const lines = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return lines.map((l) => this.parseCsvLine(l));
  }

  buildFlatNodesFromCsv(csvText: string): FlatNode[] {
    const rows = this.parseCsvText(csvText);
    if (rows.length === 0) throw new Error('CSV is empty.');

    const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '');
    const normalizeKey = (v: string) => v.trim().toLowerCase();

    const firstRow = rows[0]!.map(normalizeHeader);
    const looksLikeHeader = firstRow.some((h) =>
      ['user', 'name', 'employee', 'manager', 'title', 'role', 'department', 'dept', 'details', 'id', 'parentid', 'managerid'].includes(h),
    );

    const headerRow = looksLikeHeader ? rows[0] : null;
    const dataRows = looksLikeHeader ? rows.slice(1) : rows;
    if (dataRows.length === 0) throw new Error('CSV has a header but no data rows.');

    const headerIndex: Record<string, number> = {};
    if (headerRow) {
      headerRow.forEach((h, idx) => {
        const key = normalizeHeader(h);
        if (key) headerIndex[key] = idx;
      });
    }

    const col = (row: string[], keyVariants: string[], fallbackIndex?: number): string => {
      for (const key of keyVariants) {
        const idx = headerIndex[normalizeHeader(key)];
        if (idx !== undefined) return row[idx] ?? '';
      }
      if (fallbackIndex !== undefined) return row[fallbackIndex] ?? '';
      return '';
    };

    // Build name list first so manager-name -> id can resolve.
    const temp = dataRows.map((row, i) => {
      const name = col(row, ['user', 'name', 'employee'], 0);
      if (!name?.trim()) throw new Error(`Row ${i + 1}: missing user/name.`);
      return { row, name: name.trim() };
    });

    const explicitIds = headerRow ? temp.map((t) => col(t.row, ['id'])) : [];
    const usesExplicitId = explicitIds.some((v) => v && v.trim().length > 0);

    const nameToId = new Map<string, string>();
    const nodes: FlatNode[] = [];

    temp.forEach((t, i) => {
      const id = usesExplicitId
        ? String(col(t.row, ['id']).trim() || i + 1)
        : String(i + 1);
      const key = normalizeKey(t.name);
      if (nameToId.has(key)) {
        throw new Error(
          `Duplicate user name detected: "${t.name}". Please make user names unique (or provide an explicit 'id' column).`,
        );
      }
      nameToId.set(key, id);

      const title = col(t.row, ['title', 'role'], 2).trim();
      const department = col(t.row, ['department', 'dept'], 3).trim();
      const detailsFromHeader = col(t.row, ['details', 'detail', 'notes', 'note'], 4).trim();

      // If there's no header, treat extra columns as additional details.
      let details = detailsFromHeader;
      if (!headerRow && t.row.length > 4) {
        const extra = t.row.slice(4).map((s) => s.trim()).filter(Boolean);
        details = [detailsFromHeader, ...extra].filter(Boolean).join(' | ');
      }

      nodes.push({ id, parentId: 'null', name: t.name, title, department, details });
    });

    // Resolve parentId.
    const unresolvedManagers: { user: string; manager: string; row: number }[] = [];
    const roots: number[] = [];

    nodes.forEach((n, idx) => {
      const row = temp[idx]!.row;
      const explicitParentId = headerRow
        ? col(row, ['parentId', 'parentid', 'managerId', 'managerid']).trim()
        : '';

      if (explicitParentId) {
        const pid = String(explicitParentId);
        n.parentId = pid.toLowerCase() === 'null' ? 'null' : pid;
      } else {
        const managerName = col(row, ['manager', 'parent', 'reportsTo', 'reportsto'], 1).trim();
        if (!managerName || managerName.toLowerCase() === 'null') {
          n.parentId = 'null';
        } else {
          const pid = nameToId.get(normalizeKey(managerName));
          if (!pid) {
            unresolvedManagers.push({ user: n.name, manager: managerName, row: idx + 1 });
            n.parentId = 'null';
          } else {
            n.parentId = pid;
          }
        }
      }
      if (n.parentId === 'null') roots.push(idx);
    });

    if (unresolvedManagers.length > 0) {
      const sample = unresolvedManagers
        .slice(0, 5)
        .map((m) => `Row ${m.row}: "${m.user}" -> manager "${m.manager}" not found`)
        .join('\n');
      throw new Error(
        `Some manager names could not be resolved. Make sure managers exist as users in the CSV.\n${sample}${
          unresolvedManagers.length > 5 ? `\n(and ${unresolvedManagers.length - 5} more)` : ''
        }`,
      );
    }

    if (roots.length !== 1) {
      throw new Error(
        `CSV must define exactly one root (a row with empty manager or manager = null). Found ${roots.length} roots.`,
      );
    }

    // Cycle detection (by id -> parentId)
    const parentById = new Map<string, string | null>();
    nodes.forEach((n) =>
      parentById.set(String(n.id), n.parentId === 'null' ? null : String(n.parentId)),
    );

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      const pid = parentById.get(id);
      if (pid) {
        if (dfs(pid)) return true;
      }
      inStack.delete(id);
      return false;
    };

    for (const id of parentById.keys()) {
      if (dfs(id)) throw new Error('Cycle detected in CSV manager relationships.');
    }

    nodes.forEach((n) => {
      n.title = n.title ?? '';
      n.department = n.department ?? '';
      n.details = n.details ?? '';
    });

    return nodes;
  }
}
