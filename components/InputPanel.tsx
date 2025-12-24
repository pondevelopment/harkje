import React, { useState, useEffect, useRef } from 'react';
import { generateRandomOrgStructure } from '../services/geminiService';
import { FlatNode, OrgNode } from '../types';
import { Loader2, Wand2, FileJson, Layers, Dices, Sheet } from 'lucide-react';

interface InputPanelProps {
  onDataUpdate: (newRoot: OrgNode) => void;
  currentData: OrgNode;
}

// Helper: Convert nested tree to flat array for user editing
const flattenTree = (node: OrgNode, parentId: string | null = null, result: FlatNode[] = []): FlatNode[] => {
  result.push({
    id: node.id,
    parentId: parentId,
    name: node.name,
    title: node.title,
    department: node.department || '',
    details: node.details || ''
  });

  if (node.children) {
    node.children.forEach(child => flattenTree(child, node.id, result));
  }
  return result;
};

const csvEscape = (value: string) => {
  const v = value ?? '';
  if (/[\n\r",]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

const flatNodesToCsv = (flatNodes: FlatNode[]) => {
  const idToName = new Map<string, string>();
  flatNodes.forEach(n => idToName.set(String(n.id), n.name || ''));

  const header = ['user', 'manager', 'title', 'department', 'details'];
  const lines = [header.join(',')];

  flatNodes.forEach(n => {
    const pid = n.parentId;
    const isRoot = pid === null || String(pid).toLowerCase() === 'null' || pid === '';
    const managerName = isRoot ? '' : (idToName.get(String(pid)) ?? '');
    lines.push([
      csvEscape(n.name || ''),
      csvEscape(managerName),
      csvEscape(n.title || ''),
      csvEscape(n.department || ''),
      csvEscape(n.details || ''),
    ].join(','));
  });

  return lines.join('\n');
};

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

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
};

const parseCsvText = (text: string): string[][] => {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  return lines.map(parseCsvLine);
};

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '');
const normalizeKey = (v: string) => v.trim().toLowerCase();

const buildFlatNodesFromCsv = (csvText: string): FlatNode[] => {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) throw new Error('CSV is empty.');

  const firstRow = rows[0].map(normalizeHeader);
  const looksLikeHeader = firstRow.some(h => ['user', 'name', 'employee', 'manager', 'title', 'role', 'department', 'dept', 'details', 'id', 'parentid', 'managerid'].includes(h));

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

  const col = (row: string[], keyVariants: string[], fallbackIndex?: number) => {
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

  // Optional explicit ids.
  const explicitIds = headerRow ? temp.map(t => col(t.row, ['id'])) : [];
  const usesExplicitId = explicitIds.some(v => v && v.trim().length > 0);

  const nameToId = new Map<string, string>();
  const nodes: FlatNode[] = [];

  temp.forEach((t, i) => {
    const id = usesExplicitId ? String(col(t.row, ['id']).trim() || (i + 1)) : String(i + 1);
    const key = normalizeKey(t.name);
    if (nameToId.has(key)) {
      throw new Error(`Duplicate user name detected: "${t.name}". Please make user names unique (or provide an explicit 'id' column).`);
    }
    nameToId.set(key, id);

    const title = col(t.row, ['title', 'role'], 2).trim();
    const department = col(t.row, ['department', 'dept'], 3).trim();
    const detailsFromHeader = col(t.row, ['details', 'detail', 'notes', 'note'], 4).trim();

    // If there's no header, treat extra columns as additional details.
    let details = detailsFromHeader;
    if (!headerRow && t.row.length > 4) {
      const extra = t.row.slice(4).map(s => s.trim()).filter(Boolean);
      details = [detailsFromHeader, ...extra].filter(Boolean).join(' | ');
    }

    nodes.push({
      id,
      parentId: 'null',
      name: t.name,
      title,
      department,
      details,
    });
  });

  // Resolve parentId.
  const unresolvedManagers: Array<{ user: string; manager: string; row: number }> = [];
  const roots: number[] = [];

  nodes.forEach((n, idx) => {
    const row = temp[idx]!.row;

    const explicitParentId = headerRow
      ? (col(row, ['parentId', 'parentid', 'managerId', 'managerid']).trim())
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
    const sample = unresolvedManagers.slice(0, 5).map(m => `Row ${m.row}: "${m.user}" -> manager "${m.manager}" not found`).join('\n');
    throw new Error(`Some manager names could not be resolved. Make sure managers exist as users in the CSV.\n${sample}${unresolvedManagers.length > 5 ? `\n(and ${unresolvedManagers.length - 5} more)` : ''}`);
  }

  if (roots.length !== 1) {
    throw new Error(`CSV must define exactly one root (a row with empty manager or manager = null). Found ${roots.length} roots.`);
  }

  // Cycle detection (by id -> parentId)
  const parentById = new Map<string, string | null>();
  nodes.forEach(n => parentById.set(String(n.id), n.parentId === 'null' ? null : String(n.parentId)));

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
    if (dfs(id)) {
      throw new Error('Cycle detected in CSV manager relationships.');
    }
  }

  // Ensure required strings
  nodes.forEach(n => {
    n.title = n.title ?? '';
    n.department = n.department ?? '';
    n.details = n.details ?? '';
  });

  return nodes;
};

export const InputPanel: React.FC<InputPanelProps> = ({ onDataUpdate, currentData }) => {
  const buildSha = (import.meta as any)?.env?.VITE_BUILD_SHA as string | undefined;
  const buildTimeRaw = (import.meta as any)?.env?.VITE_BUILD_TIME as string | undefined;
  const buildShaShort = buildSha ? String(buildSha).slice(0, 7) : null;
  const buildTime = buildTimeRaw ? new Date(buildTimeRaw).toISOString().replace('.000Z', 'Z') : null;

  const [activeTab, setActiveTab] = useState<'ai' | 'json' | 'csv'>('ai');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize state with flattened data
  const [jsonInput, setJsonInput] = useState(() => JSON.stringify(flattenTree(currentData), null, 2));
  const [csvInput, setCsvInput] = useState(() => flatNodesToCsv(flattenTree(currentData)));

  // Quick Gen State
  const [quickSize, setQuickSize] = useState<'small' | 'medium' | 'large'>('medium');
  const quickRunIdRef = useRef(0);

  // Sync JSON editor when the chart updates (e.g. from AI)
  useEffect(() => {
    const flat = flattenTree(currentData);
    setJsonInput(JSON.stringify(flat, null, 2));
    setCsvInput(flatNodesToCsv(flat));
  }, [currentData]);

  const buildTree = (flatNodes: FlatNode[]): OrgNode | null => {
    const idMapping: { [key: string]: OrgNode } = {};
    const allIds = new Set<string>();

    // 1. Create nodes map
    flatNodes.forEach(node => {
      const strId = String(node.id);
      allIds.add(strId);
      idMapping[strId] = {
        ...node,
        id: strId,
        children: []
      };
    });

    // 2. Connect nodes and identify potential roots
    const potentialRoots: OrgNode[] = [];

    flatNodes.forEach(node => {
      const strId = String(node.id);
      const current = idMapping[strId];
      
      const pid = node.parentId;
      // Check for explicit root indicators
      const isExplicitRoot = pid === null || String(pid).toLowerCase() === 'null' || pid === undefined || pid === "";
      
      // Check if parent actually exists in the dataset
      const parentIdStr = String(pid);
      const parentExists = allIds.has(parentIdStr);

      if (isExplicitRoot || !parentExists) {
        // This is a root (either explicitly, or implicitly because parent is missing)
        potentialRoots.push(current);
      } else {
        // Parent exists, attach to it
        const parent = idMapping[parentIdStr];
        if (parent) {
          parent.children?.push(current);
        }
      }
    });

    if (potentialRoots.length === 0) return null;

    // If multiple roots found, try to find the "best" one (e.g. CEO) or default to first
    let root = potentialRoots[0];
    if (potentialRoots.length > 1) {
        console.warn("Multiple roots detected:", potentialRoots.map(r => r.name));
        // Simple heuristic: look for typical leader titles
        const leader = potentialRoots.find(r => 
            /ceo|president|founder|director|chief/i.test(r.title || r.name)
        );
        if (leader) root = leader;
    }

    return root;
  };

  const handleDataGeneration = async (generationPromise: Promise<FlatNode[]>) => {
    setIsLoading(true);
    setError(null);
    try {
      const flatNodes = await generationPromise;
      if (!Array.isArray(flatNodes) || flatNodes.length === 0) {
          throw new Error("Generator returned empty or invalid data structure.");
      }
      const newRoot = buildTree(flatNodes);
      if (newRoot) {
        onDataUpdate(newRoot);
        // jsonInput will be updated by useEffect
      } else {
        setError("Could not build a valid tree. Ensure the data has a root node (parentId: null).");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate structure.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickGenerate = () => {
      quickRunIdRef.current += 1;
      handleDataGeneration(generateRandomOrgStructure(quickSize, 'Default', quickRunIdRef.current));
  };

  const handleJsonUpdate = () => {
      try {
          const parsed = JSON.parse(jsonInput) as FlatNode[];
          if (!Array.isArray(parsed)) {
            throw new Error("Input must be an array of employees.");
          }
          const newRoot = buildTree(parsed);
          if (newRoot) {
              onDataUpdate(newRoot);
              setError(null);
          } else {
              setError("Could not build tree. Ensure exactly one node has parentId: null (the CEO/Root).");
          }
      } catch (e: any) {
          setError("Invalid JSON format: " + e.message);
      }
  };

  const handleCsvUpdate = () => {
    try {
      const flatNodes = buildFlatNodesFromCsv(csvInput);
      const newRoot = buildTree(flatNodes);
      if (newRoot) {
        onDataUpdate(newRoot);
        setError(null);
      } else {
        setError('Could not build tree from CSV. Ensure exactly one row has an empty manager (the root).');
      }
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Invalid CSV format.');
    }
  };

  return (
    <div
      className="flex flex-col h-full w-full shadow-xl z-20"
      style={{ backgroundColor: 'var(--ui-surface)', borderRight: '1px solid var(--ui-border)', color: 'var(--ui-text)' }}
    >
      <div className="p-6" style={{ borderBottom: '1px solid var(--ui-border)', backgroundColor: 'var(--ui-accent)', color: 'var(--ui-accent-contrast)' }}>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6" />
          Harkje
        </h1>
        <p className="text-sm mt-1 opacity-90" style={{ color: 'var(--ui-accent-contrast)' }}>
          Visualize your team structure effortlessly.
        </p>
      </div>

      <div className="flex" style={{ borderBottom: '1px solid var(--ui-border)' }}>
        <button
          onClick={() => setActiveTab('ai')}
          className="flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={activeTab === 'ai'
            ? { color: 'var(--ui-accent)', borderBottom: '2px solid var(--ui-accent)', backgroundColor: 'var(--ui-surface-2)' }
            : { color: 'var(--ui-muted)' }}
        >
          <Wand2 className="w-4 h-4" />
          Generator
        </button>
        <button
          onClick={() => setActiveTab('json')}
          className="flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={activeTab === 'json'
            ? { color: 'var(--ui-accent)', borderBottom: '2px solid var(--ui-accent)', backgroundColor: 'var(--ui-surface-2)' }
            : { color: 'var(--ui-muted)' }}
        >
          <FileJson className="w-4 h-4" />
          List Editor
        </button>
        <button
          onClick={() => setActiveTab('csv')}
          className="flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          style={activeTab === 'csv'
            ? { color: 'var(--ui-accent)', borderBottom: '2px solid var(--ui-accent)', backgroundColor: 'var(--ui-surface-2)' }
            : { color: 'var(--ui-muted)' }}
        >
          <Sheet className="w-4 h-4" />
          CSV
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
        {activeTab === 'ai' ? (
          <div className="space-y-8">
            {/* How-to */}
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ui-surface-2)', border: '1px solid var(--ui-border)' }}>
              <h2 className="text-sm font-bold" style={{ color: 'var(--ui-text)' }}>How to use Harkje</h2>
              <ul className="mt-2 space-y-1 text-xs list-disc pl-4" style={{ color: 'var(--ui-muted)' }}>
                <li>Use <span className="font-semibold">Generator</span> to create a quick example org by size.</li>
                <li>Use <span className="font-semibold">List Editor</span> (JSON) or <span className="font-semibold">CSV</span> to paste/edit your own org data.</li>
                <li>In the chart: scroll to zoom, drag to pan, click a manager to collapse/expand their team.</li>
                <li>Use <span className="font-semibold">Aspect Ratio</span> to influence how wide vs. tall the layout tries to be (lower = taller/narrower, higher = wider/flatter).</li>
                <li>Use <span className="font-semibold">Download image</span> (top-right) to export a PNG for slides.</li>
              </ul>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ui-muted)' }}>
                Privacy: no data is uploaded — everything stays local in your browser.
              </p>
            </div>

            {/* Quick Generator Section */}
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ui-surface-2)', border: '1px solid var(--ui-border)' }}>
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="p-1.5 rounded-md"
                  style={{ backgroundColor: 'var(--ui-surface)', border: '1px solid var(--ui-border)', color: 'var(--ui-accent)' }}
                >
                    <Dices size={16} />
                 </div>
                <h2 className="text-sm font-bold" style={{ color: 'var(--ui-text)' }}>Generator</h2>
              </div>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ui-muted)' }}>Organization Size</label>
                      <div className="grid grid-cols-3 gap-2">
                          {(['small', 'medium', 'large'] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => setQuickSize(s)}
                          className="py-2 px-1 text-xs font-medium rounded-lg capitalize transition-all"
                          style={quickSize === s
                            ? { backgroundColor: 'var(--ui-accent)', color: 'var(--ui-accent-contrast)', border: '1px solid var(--ui-accent)' }
                            : { backgroundColor: 'var(--ui-surface)', color: 'var(--ui-muted)', border: '1px solid var(--ui-border)' }
                          }
                              >
                                  {s}
                              </button>
                          ))}
                      </div>
                      <p className="text-[10px] mt-1.5 text-right" style={{ color: 'var(--ui-muted)' }}>
                          {quickSize === 'small' && '~5-8 nodes'}
                          {quickSize === 'medium' && '~15-20 nodes'}
                          {quickSize === 'large' && '~30-40 nodes'}
                      </p>
                  </div>

                  <button
                    onClick={handleQuickGenerate}
                    disabled={isLoading}
                    className="w-full py-3 px-4 font-medium rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                    style={{ backgroundColor: 'var(--ui-accent)', color: 'var(--ui-accent-contrast)' }}
                  >
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Wand2 className="w-5 h-5" />
                    )}
                    Generate Random Org
                  </button>
              </div>
            </div>
            
          </div>
        ) : activeTab === 'json' ? (
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex-1">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ui-text)' }}>
                Structure Data (Flat Array)
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--ui-muted)' }}>Edit the array below. Use <code>"parentId": "null"</code> for the root node.</p>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-[calc(100%-4rem)] p-4 font-mono text-xs border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-surface-2)', color: 'var(--ui-text)' }}
                placeholder='[{"id": "1", "parentId": "null", "name": "CEO", ...}]'
              />
            </div>
            <button
              onClick={handleJsonUpdate}
              className="w-full py-2.5 px-4 font-medium rounded-xl shadow-md transition-all"
              style={{ backgroundColor: 'var(--ui-accent)', color: 'var(--ui-accent-contrast)' }}
            >
              Update Visualization
            </button>
          </div>
        ) : (
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex-1">
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ui-text)' }}>
                Structure Data (CSV)
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--ui-muted)' }}>
                Only <code>user</code> and <code>manager</code> are required. Leave <code>manager</code> empty (or <code>null</code>) for the single root.
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--ui-muted)' }}>
                Leaf employees (who manage nobody) need no special handling — just include them as normal rows with a manager.
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--ui-muted)' }}>
                Empty values are allowed for <code>title</code>/<code>department</code>/<code>details</code>. <code>user</code> must be filled.
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--ui-muted)' }}>
                Example: <code>Jane Doe,,CEO,Executive,"Leads the company"</code>
              </p>
              <textarea
                value={csvInput}
                onChange={(e) => setCsvInput(e.target.value)}
                className="w-full h-[calc(100%-6rem)] p-4 font-mono text-xs border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-surface-2)', color: 'var(--ui-text)' }}
                placeholder={'user,manager,title,department,details\nJane Doe,,CEO,Executive,"Leads the company"\nJohn Smith,Jane Doe,Engineering Manager,Engineering,"Runs the platform team"'}
              />
            </div>
            <button
              onClick={handleCsvUpdate}
              className="w-full py-2.5 px-4 font-medium rounded-xl shadow-md transition-all"
              style={{ backgroundColor: 'var(--ui-accent)', color: 'var(--ui-accent-contrast)' }}
            >
              Update Visualization
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm animate-in fade-in slide-in-from-bottom-2">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      <div className="p-4 border-t text-center" style={{ borderColor: 'var(--ui-border)', backgroundColor: 'var(--ui-surface-2)' }}>
        <p className="text-xs" style={{ color: 'var(--ui-muted)' }}>Powered by random generation & D3.js</p>
        <p className="text-[10px] mt-1" style={{ color: 'var(--ui-muted)' }}>
          {buildShaShort && buildTime
            ? <>Deployed: {buildTime} • {buildShaShort}</>
            : buildShaShort
              ? <>Deployed: {buildShaShort}</>
              : <>Deployed: dev</>
          }
        </p>
      </div>
    </div>
  );
};