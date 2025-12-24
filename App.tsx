import React, { useState, useRef } from 'react';
import { OrgChart, OrgChartRef } from './components/OrgChart';
import { InputPanel } from './components/InputPanel';
import { INITIAL_DATA } from './constants';
import { OrgNode, LayoutDirection } from './types';
import { Menu, X, ArrowDown, ArrowRight, Ratio, Download } from 'lucide-react';

const App: React.FC = () => {
  const [data, setData] = useState<OrgNode>(INITIAL_DATA);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>(LayoutDirection.TopDown);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [targetAspectRatio, setTargetAspectRatio] = useState<number>(1); // Default 1:1
  const chartRef = useRef<OrgChartRef>(null);

  const DEFAULT_SIDEBAR_WIDTH = (typeof window !== 'undefined' && window.innerWidth >= 1024) ? 384 : 320; // ~w-96 or w-80
  const MIN_SIDEBAR_WIDTH = 280;
  const MAX_SIDEBAR_WIDTH = 1200;
  const MIN_CHART_WIDTH = 320;
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const clampSidebarWidth = (width: number) => {
    const viewportMax = typeof window !== 'undefined'
      ? Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_CHART_WIDTH)
      : MAX_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, Math.min(MAX_SIDEBAR_WIDTH, viewportMax)));
  };

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only allow resizing on desktop layouts.
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return;
    const dx = e.clientX - resizeStartXRef.current;
    setSidebarWidth(clampSidebarWidth(resizeStartWidthRef.current + dx));
    e.preventDefault();
  };

  const handleResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
    e.preventDefault();
  };

  const handleDownload = () => {
    if (chartRef.current) {
      chartRef.current.exportImage();
    }
  };

  return (
    <div className="flex h-screen w-screen bg-gray-100 overflow-hidden relative">
      
      {/* Mobile Sidebar Toggle - visible only on small screens or when closed */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute top-4 left-4 z-30 p-2 bg-white rounded-lg shadow-md text-gray-600 hover:text-indigo-600 md:hidden"
      >
        {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar Container */}
      <div 
        className={`fixed md:relative inset-y-0 left-0 transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 transition-transform duration-300 ease-in-out z-20 h-full shadow-2xl md:shadow-none flex-shrink-0`}
        style={{ width: sidebarWidth }}
      >
        <InputPanel onDataUpdate={setData} currentData={data} />

        {/* Drag handle to resize sidebar (desktop) */}
        <div
          className="hidden md:block absolute inset-y-0 -right-1 w-2 cursor-col-resize touch-none z-40"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title="Drag to resize sidebar"
          aria-label="Resize sidebar"
          role="separator"
          aria-orientation="vertical"
        />
        
        {/* Toggle Button for Desktop - Absolute on the edge of sidebar */}
        <button
           onClick={() => setIsSidebarOpen(false)}
           className="hidden md:flex absolute top-1/2 -right-3 w-6 h-12 bg-white items-center justify-center rounded-r-lg shadow-md text-gray-400 hover:text-indigo-600 cursor-pointer border-y border-r border-gray-100 z-50"
           title="Collapse Sidebar"
        >
             <div className="w-1 h-4 bg-gray-300 rounded-full" />
        </button>
      </div>

      {/* Re-open button when sidebar is closed on desktop */}
      {!isSidebarOpen && (
         <button
         onClick={() => setIsSidebarOpen(true)}
         className="hidden md:flex absolute top-1/2 left-0 w-6 h-12 bg-white items-center justify-center rounded-r-lg shadow-md text-gray-400 hover:text-indigo-600 cursor-pointer border-y border-r border-gray-100 z-50"
         title="Expand Sidebar"
      >
           <div className="w-1 h-4 bg-gray-300 rounded-full" />
      </button>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Toolbar */}
        <div className="absolute top-6 right-6 z-10 flex gap-4 items-start">
            
            {/* Aspect Ratio Control */}
            <div className="bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 p-2 flex flex-col gap-1 w-32">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 mb-1">
                    <Ratio size={14} />
                    <span>Aspect Ratio</span>
                </div>
                <div className="flex items-center gap-2">
                    <input 
                        type="range" 
                        min="0.5" 
                        max="2" 
                        step="0.1" 
                        value={targetAspectRatio}
                        onChange={(e) => setTargetAspectRatio(parseFloat(e.target.value))}
                        className="w-full h-2 bg-indigo-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <span className="text-xs text-gray-600 w-6 text-right">{targetAspectRatio}</span>
                </div>
            </div>

            {/* Actions Group */}
            <div className="bg-white/90 backdrop-blur rounded-lg shadow-sm border border-gray-200 p-1 flex">
                <button 
                    onClick={() => setLayoutDirection(LayoutDirection.TopDown)}
                    className={`p-2 rounded-md transition-all ${layoutDirection === LayoutDirection.TopDown ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                    title="Vertical Layout"
                >
                    <ArrowDown size={20} />
                </button>
                <div className="w-px bg-gray-200 mx-1 my-1"></div>
                <button 
                    onClick={() => setLayoutDirection(LayoutDirection.LeftRight)}
                    className={`p-2 rounded-md transition-all ${layoutDirection === LayoutDirection.LeftRight ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                    title="Horizontal Layout"
                >
                    <ArrowRight size={20} />
                </button>
                <div className="w-px bg-gray-200 mx-1 my-1"></div>
                <button 
                    onClick={handleDownload}
                    className="p-2 rounded-md text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                    title="Export as PNG"
                >
                    <Download size={20} />
                </button>
            </div>
        </div>

        {/* Chart View */}
        <div className="flex-1 overflow-hidden bg-slate-50">
          <OrgChart 
            ref={chartRef}
            data={data} 
            direction={layoutDirection} 
            targetAspectRatio={targetAspectRatio} 
          />
        </div>
      </div>
    </div>
  );
};

export default App;