import { Injectable } from '@angular/core';
import { FlatNode, OrgNode } from '../models/org.types';

/** Result of building a tree from a flat list. */
export interface BuildTreeResult {
  /** The resolved root node, or null when no root could be found. */
  root: OrgNode | null;
  /**
   * Non-fatal issues fixed along the way (dangling parent ids, unrendered
   * top-level groups). Callers should surface these to the user.
   */
  warnings: string[];
}

/**
 * Pure helpers for converting between the nested `OrgNode` tree and the flat
 * `FlatNode[]` list, plus building a validated tree from flat nodes.
 *
 * Invariants maintained: exactly one root, ids are strings, no cycles, parent
 * references must resolve (orphaned nodes become implicit roots and are
 * reported as warnings).
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

  /** Convert flat array → nested tree. Returns { root: null } if no root found. */
  buildTree(flatNodes: FlatNode[]): BuildTreeResult {
    const warnings: string[] = [];
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
        if (!isExplicitRoot) {
          warnings.push(
            `Row for "${node.name}": parentId "${parentIdStr}" does not exist; ` +
            `the node was detached as a separate top-level group.`,
          );
        }
        potentialRoots.push(current);
      } else {
        const parent = idMapping[parentIdStr];
        parent?.children?.push(current);
      }
    }

    if (potentialRoots.length === 0) return { root: null, warnings };

    let root = potentialRoots[0]!;
    if (potentialRoots.length > 1) {
      const leader = potentialRoots.find((r) =>
        /ceo|president|founder|director|chief/i.test(r.title || r.name),
      );
      if (leader) root = leader;
      const dropped = potentialRoots.filter((r) => r !== root);
      const droppedNames = dropped.map((r) => `"${r.name}"`).join(', ');
      warnings.push(
        `${potentialRoots.length} separate top-level groups found; the group rooted at ` +
        `"${root.name}" is used. Others are not rendered: ${droppedNames}.`,
      );
    }

    return { root, warnings };
  }
}
