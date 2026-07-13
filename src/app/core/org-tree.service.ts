import { Injectable } from '@angular/core';
import { FlatNode, OrgNode } from '../models/org.types';

/**
 * Pure helpers for converting between the nested `OrgNode` tree and the flat
 * `FlatNode[]` list, plus building a validated tree from flat nodes.
 *
 * Invariants maintained: exactly one root, ids are strings, no cycles, parent
 * references must resolve (orphaned nodes become implicit roots and warn).
 */
@Injectable({ providedIn: 'root' })
export class OrgTreeService {
  /** Convert nested tree → flat array for editing/export. */
  flattenTree(node: OrgNode, parentId: string | null = null, result: FlatNode[] = []): FlatNode[] {
    result.push({
      id: node.id,
      parentId,
      name: node.name,
      title: node.title,
      department: node.department || '',
      details: node.details || '',
    });
    if (node.children) {
      for (const child of node.children) this.flattenTree(child, node.id, result);
    }
    return result;
  }

  /** Convert flat array → nested tree. Returns null if no root found. */
  buildTree(flatNodes: FlatNode[]): OrgNode | null {
    const idMapping: Record<string, OrgNode> = {};
    const allIds = new Set<string>();

    // 1. Create nodes map
    for (const node of flatNodes) {
      const strId = String(node.id);
      allIds.add(strId);
      idMapping[strId] = {
        ...node,
        id: strId,
        children: [],
      };
    }

    // 2. Connect nodes and identify potential roots
    const potentialRoots: OrgNode[] = [];

    for (const node of flatNodes) {
      const strId = String(node.id);
      const current = idMapping[strId];
      const pid = node.parentId;
      const isExplicitRoot =
        pid === null ||
        String(pid).toLowerCase() === 'null' ||
        pid === undefined ||
        pid === '';
      const parentIdStr = String(pid);
      const parentExists = allIds.has(parentIdStr);

      if (isExplicitRoot || !parentExists) {
        potentialRoots.push(current);
      } else {
        const parent = idMapping[parentIdStr];
        parent?.children?.push(current);
      }
    }

    if (potentialRoots.length === 0) return null;

    let root = potentialRoots[0]!;
    if (potentialRoots.length > 1) {
      // eslint-disable-next-line no-console
      console.warn('Multiple roots detected:', potentialRoots.map((r) => r.name));
      const leader = potentialRoots.find((r) =>
        /ceo|president|founder|director|chief/i.test(r.title || r.name),
      );
      if (leader) root = leader;
    }

    return root;
  }
}
