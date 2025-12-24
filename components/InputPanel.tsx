import React, { useState, useEffect } from 'react';
import { generateOrgStructure, generateRandomOrgStructure } from '../services/geminiService';
import { FlatNode, OrgNode } from '../types';
import { Loader2, Wand2, FileJson, Layers, Sparkles, Dices } from 'lucide-react';

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

export const InputPanel: React.FC<InputPanelProps> = ({ onDataUpdate, currentData }) => {
  const [activeTab, setActiveTab] = useState<'ai' | 'json'>('ai');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Initialize state with flattened data
  const [jsonInput, setJsonInput] = useState(() => JSON.stringify(flattenTree(currentData), null, 2));

  // Quick Gen State
  const [quickTheme, setQuickTheme] = useState('Tech Startup');
  const [quickSize, setQuickSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Sync JSON editor when the chart updates (e.g. from AI)
  useEffect(() => {
    setJsonInput(JSON.stringify(flattenTree(currentData), null, 2));
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
          throw new Error("AI returned empty or invalid data structure.");
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

  const handleGenerateFromDescription = () => {
    if (!prompt.trim()) return;
    handleDataGeneration(generateOrgStructure(prompt));
  };

  const handleQuickGenerate = () => {
      if (!quickTheme.trim()) return;
      handleDataGeneration(generateRandomOrgStructure(quickSize, quickTheme));
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

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 w-full max-w-md shadow-xl z-20">
      <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6" />
          OrgaGenius
        </h1>
        <p className="text-indigo-100 text-sm mt-1 opacity-90">
          Visualize your team structure effortlessly.
        </p>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'ai'
              ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Wand2 className="w-4 h-4" />
          AI Generator
        </button>
        <button
          onClick={() => setActiveTab('json')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'json'
              ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <FileJson className="w-4 h-4" />
          List Editor
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
        {activeTab === 'ai' ? (
          <div className="space-y-8">
            {/* Custom Description Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                 <div className="p-1.5 bg-indigo-100 rounded-md text-indigo-600">
                    <Sparkles size={16} />
                 </div>
                 <h2 className="text-sm font-bold text-gray-800">Custom Description</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Describe your organization in plain text.
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full h-32 p-4 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all resize-none shadow-sm mb-3"
                placeholder="e.g. Sarah is CEO. She manages Tom (Sales) and Jerry (Tech)..."
              />
              <button
                onClick={handleGenerateFromDescription}
                disabled={isLoading || !prompt.trim()}
                className="w-full py-2.5 px-4 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-medium rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-sm"
              >
                 Generate from Text
              </button>
            </div>

            <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-gray-200"></div>
                <span className="flex-shrink-0 mx-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Or Try Auto-Gen</span>
                <div className="flex-grow border-t border-gray-200"></div>
            </div>

            {/* Quick Generator Section */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                 <div className="p-1.5 bg-violet-100 rounded-md text-violet-600">
                    <Dices size={16} />
                 </div>
                 <h2 className="text-sm font-bold text-gray-800">Quick Test Generator</h2>
              </div>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Theme / Industry</label>
                      <input 
                        type="text" 
                        value={quickTheme}
                        onChange={(e) => setQuickTheme(e.target.value)}
                        className="w-full p-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                        placeholder="e.g. Pirate Ship, Mars Colony..."
                      />
                  </div>

                  <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Organization Size</label>
                      <div className="grid grid-cols-3 gap-2">
                          {(['small', 'medium', 'large'] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => setQuickSize(s)}
                                className={`py-2 px-1 text-xs font-medium rounded-lg capitalize transition-all ${
                                    quickSize === s 
                                    ? 'bg-violet-600 text-white shadow-md' 
                                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                  {s}
                              </button>
                          ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1.5 text-right">
                          {quickSize === 'small' && '~5-8 nodes'}
                          {quickSize === 'medium' && '~15-20 nodes'}
                          {quickSize === 'large' && '~30-40 nodes'}
                      </p>
                  </div>

                  <button
                    onClick={handleQuickGenerate}
                    disabled={isLoading || !quickTheme.trim()}
                    className="w-full py-3 px-4 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white font-medium rounded-xl shadow-md transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
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
        ) : (
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Structure Data (Flat Array)
              </label>
              <p className="text-xs text-gray-500 mb-2">Edit the array below. Use <code>"parentId": "null"</code> for the root node.</p>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-[calc(100%-4rem)] p-4 font-mono text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 text-slate-700 resize-none"
                placeholder='[{"id": "1", "parentId": "null", "name": "CEO", ...}]'
              />
            </div>
            <button
              onClick={handleJsonUpdate}
              className="w-full py-2.5 px-4 bg-gray-800 hover:bg-gray-900 text-white font-medium rounded-xl shadow-md transition-all"
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

      <div className="p-4 border-t border-gray-200 bg-gray-50 text-center">
        <p className="text-xs text-gray-400">Powered by Gemini 3 Flash & D3.js</p>
      </div>
    </div>
  );
};