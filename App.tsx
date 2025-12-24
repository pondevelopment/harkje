import React, { useEffect, useState, useRef } from 'react';
import { OrgChart, OrgChartRef } from './components/OrgChart';
import { InputPanel } from './components/InputPanel';
import { INITIAL_DATA } from './constants';
import { OrgNode, LayoutDirection } from './types';
import { Menu, X, Ratio, Download } from 'lucide-react';
import { ThemeProvider, THEMES, ThemeId, useTheme } from './theme';

const AppInner: React.FC = () => {
  const { themeId, setThemeId } = useTheme();
  const [data, setData] = useState<OrgNode>(INITIAL_DATA);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [targetAspectRatio, setTargetAspectRatio] = useState<number>(1); // Default 1:1
  const chartRef = useRef<OrgChartRef>(null);

  const DEFAULT_SIDEBAR_WIDTH = (typeof window !== 'undefined' && window.innerWidth >= 1024) ? 384 : 320; // ~w-96 or w-80
  const MIN_SIDEBAR_WIDTH = 280;
  const MAX_SIDEBAR_WIDTH = 1200;
  const MIN_CHART_WIDTH = 320;
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const isResizingRef = useRef(false);
  const suppressSidebarToggleClickRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const onResizeMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onResizeEndRef = useRef<((e: PointerEvent) => void) | null>(null);

  const clampSidebarWidth = (width: number) => {
    const viewportMax = typeof window !== 'undefined'
      ? Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_CHART_WIDTH)
      : MAX_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, Math.min(MAX_SIDEBAR_WIDTH, viewportMax)));
  };

  const cleanupResizeListeners = () => {
    if (onResizeMoveRef.current) {
      window.removeEventListener('pointermove', onResizeMoveRef.current);
      onResizeMoveRef.current = null;
    }
    if (onResizeEndRef.current) {
      window.removeEventListener('pointerup', onResizeEndRef.current);
      window.removeEventListener('pointercancel', onResizeEndRef.current);
      onResizeEndRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    return () => {
      cleanupResizeListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only allow resizing on desktop layouts.
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;

    cleanupResizeListeners();
    isResizingRef.current = true;
    suppressSidebarToggleClickRef.current = false;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      if (!isResizingRef.current) return;
      const dx = ev.clientX - resizeStartXRef.current;
      if (Math.abs(dx) > 3) suppressSidebarToggleClickRef.current = true;
      setSidebarWidth(clampSidebarWidth(resizeStartWidthRef.current + dx));
      ev.preventDefault();
    };

    const onEnd = (ev: PointerEvent) => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      cleanupResizeListeners();
      ev.preventDefault();
    };

    onResizeMoveRef.current = onMove;
    onResizeEndRef.current = onEnd;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd, { passive: false });
    window.addEventListener('pointercancel', onEnd, { passive: false });

    // Avoid preventing default here so clicks still work when the user doesn't drag.
  };

  const handleDownload = () => {
    if (chartRef.current) {
      chartRef.current.exportImage();
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden relative" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text)' }}>
      
      {/* Mobile Sidebar Toggle - visible only on small screens or when closed */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute top-4 left-4 z-30 p-2 rounded-lg shadow-md md:hidden"
        style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--text)' }}
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
          className="hidden md:block absolute inset-y-0 -right-2 w-4 cursor-col-resize touch-none z-40 pointer-events-auto hover:bg-indigo-100/40"
          onPointerDown={handleResizeStart}
          title="Drag to resize sidebar"
          aria-label="Resize sidebar"
          role="separator"
          aria-orientation="vertical"
        >
          <div className="absolute inset-y-0 right-1 w-px bg-slate-300/70" />
        </div>
        
        {/* Toggle Button for Desktop - Absolute on the edge of sidebar */}
        <button
           onPointerDown={(e) => handleResizeStart(e as unknown as React.PointerEvent<HTMLDivElement>)}
           onClick={() => {
             if (suppressSidebarToggleClickRef.current) {
               suppressSidebarToggleClickRef.current = false;
               return;
             }
             setIsSidebarOpen(false);
           }}
           className="hidden md:flex absolute top-1/2 -right-3 w-6 h-12 items-center justify-center rounded-r-lg shadow-md cursor-pointer z-50"
           style={{ backgroundColor: 'var(--surface)', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}
           title="Collapse Sidebar"
        >
             <div className="w-1 h-4 bg-gray-300 rounded-full" />
        </button>
      </div>

      {/* Re-open button when sidebar is closed on desktop */}
      {!isSidebarOpen && (
         <button
         onClick={() => setIsSidebarOpen(true)}
        className="hidden md:flex absolute top-1/2 left-0 w-6 h-12 items-center justify-center rounded-r-lg shadow-md cursor-pointer z-50"
        style={{ backgroundColor: 'var(--surface)', borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}
         title="Expand Sidebar"
      >
           <div className="w-1 h-4 bg-gray-300 rounded-full" />
      </button>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Toolbar */}
        <div className="absolute top-6 right-6 z-10 flex gap-4 items-start">

            {/* Theme */}
            <div className="backdrop-blur rounded-lg shadow-sm px-3 py-2 flex items-center gap-2" style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--text)' }}>
              <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }} htmlFor="theme">
                Theme
              </label>
              <select
                id="theme"
                value={themeId}
                onChange={(e) => setThemeId(e.target.value as ThemeId)}
                className="text-sm outline-none rounded-md px-2 py-1"
                style={{
                  color: 'var(--text)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
                title="Theme"
              >
                {THEMES.map(t => (
                  <option key={t.id} value={t.id} style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Aspect Ratio Control */}
            <div className="backdrop-blur rounded-lg shadow-sm p-2 flex flex-col gap-1 w-32" style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--text)' }}>
                <div className="flex items-center gap-2 text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>
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
                    <span className="text-xs w-6 text-right" style={{ color: 'var(--muted)' }}>{targetAspectRatio}</span>
                </div>
            </div>

            {/* Download */}
            <button 
              onClick={handleDownload}
              className="backdrop-blur rounded-lg shadow-sm px-3 py-2 flex items-center gap-2 transition-all"
              style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--text)' }}
              title="Download image (PNG)"
            >
              <Download size={18} />
              <span className="text-sm font-medium">Download image</span>
            </button>
        </div>

        {/* Chart View */}
        <div className="flex-1 overflow-hidden" style={{ backgroundColor: 'var(--app-bg)' }}>
          <OrgChart 
            ref={chartRef}
            data={data} 
            direction={LayoutDirection.TopDown} 
            targetAspectRatio={targetAspectRatio} 
            themeId={themeId}
          />
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
};

export default App;