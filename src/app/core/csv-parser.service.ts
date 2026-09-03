import { Injectable } from '@angular/core';
import { FlatNode } from '../models/org.types';

/**
 * CSV import/export for org structures. Mirrors the original React logic:
 * flexible header detection (`user`/`manager`/`title`/`department`/`details`
 * with aliases), manager-name → id resolution, explicit-id support, cycle
 * detection, duplicate-name detection, missing-manager synthesis, single-root
 * enforcement.
 */
@Injectable({ providedIn: 'root' })
export class CsvParserService {
  private importWarnings: string[] = [];

  get warnings(): readonly string[] {
    return this.importWarnings;
  }

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

  parseCsvLine(line: string, delimiter = ','): string[] {
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
      if (ch === delimiter) {
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
    const delimiter = this.detectDelimiter(lines[0] ?? '');
    return lines.map((l) => this.parseCsvLine(l, delimiter));
  }

  private detectDelimiter(line: string): ',' | ';' {
    let commaCount = 0;
    let semicolonCount = 0;
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && ch === ',') {
        commaCount++;
      } else if (!inQuotes && ch === ';') {
        semicolonCount++;
      }
    }

    return semicolonCount > commaCount ? ';' : ',';
  }

  buildFlatNodesFromCsv(csvText: string): FlatNode[] {
    this.importWarnings = [];
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
    const usedIds = new Set(nodes.map((node) => node.id));
    const nextGeneratedId = (prefix: string): string => {
      let suffix = 1;
      let id = `${prefix}-${suffix}`;
      while (usedIds.has(id)) {
        suffix++;
        id = `${prefix}-${suffix}`;
      }
      usedIds.add(id);
      return id;
    };

    nodes.forEach((n, idx) => {
      const row = temp[idx]!.row;
      const explicitParentId = headerRow
        ? col(row, ['parentId', 'parentid', 'managerId', 'managerid']).trim()
        : '';

      if (explicitParentId) {
        const pid = String(explicitParentId);
        if (pid === n.id) {
          n.parentId = 'null';
          this.importWarnings.push(
            `Row ${idx + 1}: "${n.name}" listed itself as manager; manager was cleared.`,
          );
        } else {
          n.parentId = pid.toLowerCase() === 'null' ? 'null' : pid;
        }
      } else {
        const managerName = col(row, ['manager', 'parent', 'reportsTo', 'reportsto'], 1).trim();
        if (!managerName || managerName.toLowerCase() === 'null') {
          n.parentId = 'null';
        } else if (normalizeKey(managerName) === normalizeKey(n.name)) {
          n.parentId = 'null';
          this.importWarnings.push(
            `Row ${idx + 1}: "${n.name}" listed itself as manager; manager was cleared.`,
          );
        } else {
          const managerKey = normalizeKey(managerName);
          let pid = nameToId.get(managerKey);
          if (!pid) {
            pid = nextGeneratedId('generated-manager');
            nameToId.set(managerKey, pid);
            nodes.push({
              id: pid,
              parentId: 'null',
              name: managerName,
              title: 'Manager',
              department: '',
              details: 'Added automatically from a CSV manager reference.',
            });
            this.importWarnings.push(
              `Row ${idx + 1}: manager "${managerName}" had no user row; a user was added automatically.`,
            );
          }
          n.parentId = pid;
        }
      }
    });

    let roots = nodes.filter((node) => node.parentId === 'null');
    if (roots.length > 1) {
      const organizationRootId = nextGeneratedId('generated-root');
      for (const root of roots) root.parentId = organizationRootId;
      nodes.push({
        id: organizationRootId,
        parentId: 'null',
        name: 'Organization',
        title: 'Organization',
        department: '',
        details: 'Added automatically to connect CSV root groups.',
      });
      this.importWarnings.push(
        `Added an "Organization" root to connect ${roots.length} separate top-level groups.`,
      );
      roots = [nodes[nodes.length - 1]!];
    }

    if (roots.length !== 1) {
      throw new Error(
        `CSV must define exactly one root (a row with empty manager or manager = null). Found ${roots.length} roots.`,
      );
    }

    // Repair disconnected manager cycles by reconnecting the earliest CSV row
    // in each cycle to the established root.
    const parentById = new Map<string, string | null>();
    nodes.forEach((n) =>
      parentById.set(String(n.id), n.parentId === 'null' ? null : String(n.parentId)),
    );
    const rootId = roots[0]!.id;
    const processed = new Set<string>();
    const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));

    for (const startId of parentById.keys()) {
      if (processed.has(startId)) continue;
      const path: string[] = [];
      const pathIndex = new Map<string, number>();
      let currentId: string | null = startId;

      while (currentId && parentById.has(currentId) && !processed.has(currentId)) {
        const cycleStart = pathIndex.get(currentId);
        if (cycleStart !== undefined) {
          const cycleIds = path.slice(cycleStart);
          const repairedId = [...cycleIds].sort((a, b) =>
            (nodeIndexById.get(a) ?? Infinity) - (nodeIndexById.get(b) ?? Infinity),
          )[0]!;
          const repairedNode = nodes[nodeIndexById.get(repairedId)!]!;
          const formerManagerId = parentById.get(repairedId)!;
          const formerManager = nodes[nodeIndexById.get(formerManagerId!)!]!;
          repairedNode.parentId = rootId;
          parentById.set(repairedId, rootId);
          this.importWarnings.push(
            `Manager cycle detected (${cycleIds.map((id) => nodes[nodeIndexById.get(id)!]!.name).join(' -> ')}); ` +
            `"${repairedNode.name}" was reassigned from "${formerManager.name}" to "${roots[0]!.name}".`,
          );
          break;
        }
        pathIndex.set(currentId, path.length);
        path.push(currentId);
        currentId = parentById.get(currentId) ?? null;
      }
      for (const id of path) processed.add(id);
    }

    nodes.forEach((n) => {
      n.title = n.title ?? '';
      n.department = n.department ?? '';
      n.details = n.details ?? '';
    });

    return nodes;
  }
}
