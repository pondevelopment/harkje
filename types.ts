export interface OrgNode {
  id: string;
  name: string;
  title: string;
  department?: string;
  details?: string;
  children?: OrgNode[];
  // Visual properties used by D3
  x?: number;
  y?: number;
  collapsed?: boolean;
}

export interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  title: string;
  department: string;
  details: string;
}

export enum LayoutDirection {
  TopDown = 'TB',
  LeftRight = 'LR'
}