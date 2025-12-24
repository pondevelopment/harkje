import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as d3 from 'd3';
import { toPng } from 'html-to-image';
import { OrgNode, LayoutDirection } from '../types';
import type { ChartThemeId } from '../theme';

interface OrgChartProps {
  data: OrgNode;
  direction: LayoutDirection;
  targetAspectRatio: number;
  chartThemeId: ChartThemeId;
}

export interface OrgChartRef {
  exportImage: () => void;
}

// Configuration Constants - COMPACT MODE
const CARD_WIDTH = 180;   // Reduced from 220
const CARD_HEIGHT = 74;   // Reduced from 90
const GAP_H = 20;         // Reduced from 40
const GAP_V = 48;         // Reduced from 80
const GRID_GAP = 12;      // Reduced from 20
const CHANNEL_WIDTH = 30; // Reduced from 70

export const OrgChart = forwardRef<OrgChartRef, OrgChartProps>(({ data, direction, targetAspectRatio, chartThemeId }, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const layoutBoundsRef = useRef<{ minX: number; minY: number; treeWidth: number; treeHeight: number } | null>(null);
  
  // State to track collapsed nodes
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  
  // Track previous data to determine if we should reset zoom or preserve it
  const prevDataRef = useRef<OrgNode | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  // Expose export function
  useImperativeHandle(ref, () => ({
    exportImage: async () => {
      if (!containerRef.current) return;
      if (!svgRef.current) return;
      if (!layoutBoundsRef.current) {
        alert('Chart is not ready to export yet. Please try again in a moment.');
        return;
      }

      const svgEl = svgRef.current;
      const gEl = svgEl.querySelector('g');
      if (!gEl) {
        alert('Chart is not ready to export yet. Please try again in a moment.');
        return;
      }

      const padding = 40;
      const { minX, minY, treeWidth, treeHeight } = layoutBoundsRef.current;

      const exportWidth = Math.max(1, Math.ceil(treeWidth + padding * 2));
      const exportHeight = Math.max(1, Math.ceil(treeHeight + padding * 2));

      // Some browsers can export an empty PNG when cloning nodes containing <foreignObject>.
      // Instead, temporarily resize and re-position the live chart to the tight bounds,
      // export it, and then restore the original state.
      const containerEl = containerRef.current;
      const prevContainerWidth = containerEl.style.width;
      const prevContainerHeight = containerEl.style.height;
      const prevContainerOverflow = containerEl.style.overflow;
      const prevContainerBg = containerEl.style.background;
      const prevContainerBgColor = containerEl.style.backgroundColor;

      const prevSvgWidth = svgEl.getAttribute('width');
      const prevSvgHeight = svgEl.getAttribute('height');
      const prevGTransform = gEl.getAttribute('transform');

      const excludedEls = Array.from(containerEl.querySelectorAll('[data-export-exclude="true"]')) as HTMLElement[];
      const prevExcludedDisplay = excludedEls.map(el => el.style.display);

      try {
        excludedEls.forEach(el => (el.style.display = 'none'));

        containerEl.style.width = `${exportWidth}px`;
        containerEl.style.height = `${exportHeight}px`;
        containerEl.style.overflow = 'hidden';
        // Do not touch the `background` shorthand here; it can override and clear
        // the inline `backgroundColor` React sets for the chart.
        containerEl.style.backgroundColor = 'transparent';

        svgEl.setAttribute('width', String(exportWidth));
        svgEl.setAttribute('height', String(exportHeight));
        gEl.setAttribute('transform', `translate(${padding - minX},${padding - minY})`);

        // Let layout/paint settle (foreignObject is sensitive here).
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        // 1. Warmup run
        try {
          await toPng(containerEl, {
            quality: 0.1,
            skipFonts: true,
            pixelRatio: 1,
            width: exportWidth,
            height: exportHeight,
            backgroundColor: 'transparent',
          });
        } catch {
          // Ignore errors in warmup
        }

        // 2. Actual export
        const dataUrl = await toPng(containerEl, {
          quality: 1.0,
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: 'transparent',
          skipFonts: true,
          width: exportWidth,
          height: exportHeight,
        });

        const link = document.createElement('a');
        link.download = `org-chart-${new Date().toISOString().slice(0,10)}.png`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error('Failed to export image', err);
        alert('Failed to export image. Please try using a modern desktop browser (Chrome/Edge/Firefox).');
      } finally {
        // Restore DOM state
        excludedEls.forEach((el, i) => (el.style.display = prevExcludedDisplay[i] ?? ''));

        containerEl.style.width = prevContainerWidth;
        containerEl.style.height = prevContainerHeight;
        containerEl.style.overflow = prevContainerOverflow;
        containerEl.style.background = prevContainerBg;
        containerEl.style.backgroundColor = prevContainerBgColor;

        if (prevSvgWidth === null) svgEl.removeAttribute('width');
        else svgEl.setAttribute('width', prevSvgWidth);
        if (prevSvgHeight === null) svgEl.removeAttribute('height');
        else svgEl.setAttribute('height', prevSvgHeight);

        if (prevGTransform === null) gEl.removeAttribute('transform');
        else gEl.setAttribute('transform', prevGTransform);
      }
    }
  }));

  // Update dimensions on window resize
  useEffect(() => {
    const updateDims = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', updateDims);
    updateDims();
    return () => window.removeEventListener('resize', updateDims);
  }, []);

  /**
   * Custom Layout Engine: Balanced Hybrid
   */
  const computeBalancedLayout = (root: d3.HierarchyNode<OrgNode>) => {
    
    // 1. Post-Order Traversal (Bottom-Up): Calculate subtree sizes and configurations
    root.eachAfter((node: any) => {
      const children = node.children;
      
      if (!children || children.length === 0) {
        // LEAF
        node._w = CARD_WIDTH;
        node._h = CARD_HEIGHT;
        node._layout = 'leaf';
      } else {
        // PARENT
        const allChildrenAreLeaves = children.every((c: any) => !c.children || c.children.length === 0);
        
        let layoutType = 'row';
        let rows: any[][] = [];

        // DECISION LOGIC
        if (allChildrenAreLeaves && children.length > 3) {
            layoutType = 'grid';
            // Grid logic
            const count = children.length;
            const cols = Math.ceil(Math.sqrt(count * (CARD_WIDTH/CARD_HEIGHT))); 
            // Create rows for grid
            for (let i = 0; i < count; i += cols) {
                rows.push(children.slice(i, i + cols));
            }
        } 
        else {
            // Mixed or small leaf group
            let linearW = 0;
            let maxChildH = 0;
            children.forEach((c: any, i: number) => {
               linearW += c._w;
               if (i < children.length - 1) linearW += GAP_H;
               maxChildH = Math.max(maxChildH, c._h);
            });

            const currentRatio = linearW / (CARD_HEIGHT + GAP_V + maxChildH);
            
            if (currentRatio > targetAspectRatio * 1.5 && children.length >= 3) {
                layoutType = 'wrap';
                // Wrapping logic
                const area = linearW * maxChildH; 
                const idealWidth = Math.sqrt(area * targetAspectRatio);
                
                let currentRow: any[] = [];
                let currentRowWidth = 0;
                
                children.forEach((child: any) => {
                    const childW = child._w;
                    if (currentRowWidth + childW > idealWidth && currentRow.length > 0) {
                        rows.push(currentRow);
                        currentRow = [child];
                        currentRowWidth = childW;
                    } else {
                        currentRow.push(child);
                        currentRowWidth += childW + (currentRow.length > 0 ? GAP_H : 0);
                    }
                });
                if (currentRow.length > 0) rows.push(currentRow);
            } else {
                layoutType = 'row';
            }
        }

        node._layout = layoutType;
        node._rows = rows;

        // SIZE CALCULATION
        if (layoutType === 'row') {
             let totalW = 0;
             let maxH = 0;
             children.forEach((c: any, i: number) => {
                totalW += c._w;
                if (i < children.length - 1) totalW += GAP_H;
                maxH = Math.max(maxH, c._h);
             });
             node._w = Math.max(CARD_WIDTH, totalW);
             node._h = CARD_HEIGHT + GAP_V + maxH;
        } else {
            // 'grid' or 'wrap' - Use Channel Logic for width
            let maxRowW = 0;
            let totalBlockH = 0;

            rows.forEach((row, rowIndex) => {
                const isLastRow = rowIndex === rows.length - 1;
                // If single item and last row, it can be centered (no split needed)
                if (isLastRow && row.length === 1) {
                    maxRowW = Math.max(maxRowW, row[0]._w);
                } else {
                    // Split row into Left/Right
                    const mid = Math.ceil(row.length / 2);
                    const left = row.slice(0, mid);
                    const right = row.slice(mid);
                    const gap = layoutType==='grid' ? GRID_GAP : GAP_H;

                    // Calculate Width of Left Group
                    let wLeft = 0;
                    left.forEach((c: any, i: number) => { 
                        wLeft += c._w; 
                        if(i < left.length-1) wLeft += gap; 
                    });
                    
                    // Calculate Width of Right Group
                    let wRight = 0;
                    right.forEach((c: any, i: number) => { 
                        wRight += c._w; 
                        if(i < right.length-1) wRight += gap; 
                    });

                    // Distance from Center Axis (x) to the outer edges
                    const distToLeftEdge = wLeft + (CHANNEL_WIDTH / 2);
                    const distToRightEdge = wRight + (CHANNEL_WIDTH / 2);
                    
                    // The row width must be symmetric to preserve the center axis
                    const symmetricRowWidth = Math.max(distToLeftEdge, distToRightEdge) * 2;
                    
                    maxRowW = Math.max(maxRowW, symmetricRowWidth);
                }

                // Calc Height
                let rowH = 0;
                row.forEach((c: any) => rowH = Math.max(rowH, c._h));
                totalBlockH += rowH;
            });

            totalBlockH += (rows.length - 1) * (layoutType==='grid' ? GRID_GAP : GAP_V);
            
            node._w = Math.max(CARD_WIDTH, maxRowW);
            node._h = CARD_HEIGHT + GAP_V + totalBlockH;
        }
      }
    });

    // 2. Pre-Order Traversal (Top-Down): Assign absolute coordinates
    const positionNode = (node: any, x: number, y: number) => {
        node.x = x;
        node.y = y;
        
        if (!node.children || node.children.length === 0) return;
        
        if (node._layout === 'row') {
             const children = node.children;
             let totalChildrenWidth = 0;
             children.forEach((c: any, i: number) => {
                totalChildrenWidth += c._w;
                if (i < children.length - 1) totalChildrenWidth += GAP_H;
             });
             
             let currentX = x - totalChildrenWidth / 2;
             const childY = y + CARD_HEIGHT + GAP_V;
             
             children.forEach((child: any) => {
                 const childX = currentX + child._w / 2;
                 positionNode(child, childX, childY);
                 currentX += child._w + GAP_H;
             });

        } else {
            // 'grid' or 'wrap'
            let currentY = y + CARD_HEIGHT + GAP_V;
            const rows = node._rows;
            const gapType = node._layout === 'grid' ? GRID_GAP : GAP_H;
            const vGap = node._layout === 'grid' ? GRID_GAP : GAP_V;

            rows.forEach((row: any[], rowIndex: number) => {
                let rowH = 0;
                row.forEach(c => rowH = Math.max(rowH, c._h));
                
                const isLastRow = rowIndex === rows.length - 1;

                if (isLastRow && row.length === 1) {
                    const child = row[0];
                    positionNode(child, x, currentY);
                } 
                else {
                    const mid = Math.ceil(row.length / 2);
                    const leftGroup = row.slice(0, mid);
                    const rightGroup = row.slice(mid);

                    // Position Left Group
                    let wLeft = 0;
                    leftGroup.forEach((c: any, i: number) => { 
                        wLeft += c._w; 
                        if(i<leftGroup.length-1) wLeft += gapType; 
                    });
                    
                    let leftStartX = x - (CHANNEL_WIDTH / 2) - wLeft;
                    
                    leftGroup.forEach((child: any) => {
                        const childX = leftStartX + child._w / 2;
                        positionNode(child, childX, currentY);
                        leftStartX += child._w + gapType;
                    });

                    // Position Right Group
                    let rightStartX = x + (CHANNEL_WIDTH / 2);
                    
                    rightGroup.forEach((child: any) => {
                        const childX = rightStartX + child._w / 2;
                        positionNode(child, childX, currentY);
                        rightStartX += child._w + gapType;
                    });
                }
                
                currentY += rowH + vGap;
            });
        }
    };
    
    positionNode(root, 0, 0);
  };

  useEffect(() => {
    if (!data || !svgRef.current) return;
    const containerEl = containerRef.current;
    const computed = containerEl ? window.getComputedStyle(containerEl) : null;
    const chartLinkStroke = (computed?.getPropertyValue('--chart-link') || '').trim() || '#cbd5e1';

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous render

    const { width, height } = dimensions;
    const root = d3.hierarchy<OrgNode>(data);

    // Apply Collapse State
    root.descendants().forEach((d) => {
        if (collapsedIds.has(d.data.id)) {
            d.children = undefined;
        }
    });

    computeBalancedLayout(root);

    // Calculate Bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each((d: any) => {
      const left = d.x - CARD_WIDTH / 2;
      const right = d.x + CARD_WIDTH / 2;
      const top = d.y;
      const bottom = d.y + CARD_HEIGHT;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });

    const treeWidth = maxX - minX;
    const treeHeight = maxY - minY;

    layoutBoundsRef.current = { minX, minY, treeWidth, treeHeight };

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        transformRef.current = event.transform;
      });

    svg.call(zoom);

    // Determine Zoom Strategy
    if (prevDataRef.current !== data) {
        // DATA CHANGED: Perform Auto-Fit
        const padding = 80;
        const availableW = width - padding * 2;
        const availableH = height - padding * 2;
        const scale = Math.min(
          1.2,
          Math.min(availableW / treeWidth, availableH / treeHeight)
        );
        const layoutCenterX = minX + treeWidth / 2;
        const layoutCenterY = minY + treeHeight / 2;
        const transformX = (width / 2) - (layoutCenterX * scale);
        const transformY = (height / 2) - (layoutCenterY * scale);
        const newTransform = d3.zoomIdentity.translate(transformX, transformY).scale(scale);
        svg.call(zoom.transform, newTransform);
        transformRef.current = newTransform;
        prevDataRef.current = data;
    } else {
        svg.call(zoom.transform, transformRef.current);
    }

    // --- Draw Links ---
    g.selectAll(".link")
      .data(root.links())
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", chartLinkStroke)
      .attr("stroke-width", 1.5) // Thinner lines for compact view
      .attr("d", (d: any) => {
        const source = d.source;
        const target = d.target;
        const sx = source.x;
        const sy = source.y + CARD_HEIGHT;
        const tx = target.x;
        const ty = target.y;

        if (source._layout === 'wrap' || source._layout === 'grid') {
             const branchY = ty - (GAP_V / 2);
             if (Math.abs(sx - tx) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`;
             return `M ${sx} ${sy} L ${sx} ${branchY} L ${tx} ${branchY} L ${tx} ${ty}`;
        }
        const midY = (sy + ty) / 2;
        return `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
      });

    // --- Draw Nodes ---
    const node = g.selectAll(".node")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .on("click", (event, d) => {
          if (d.data.children && d.data.children.length > 0) {
              event.stopPropagation();
              setCollapsedIds(prev => {
                  const next = new Set(prev);
                  if (next.has(d.data.id)) next.delete(d.data.id);
                  else next.add(d.data.id);
                  return next;
              });
          }
      });

    node.append("foreignObject")
      .attr("width", CARD_WIDTH)
      .attr("height", CARD_HEIGHT)
      .attr("x", -CARD_WIDTH / 2)
      .attr("y", 0) 
      .style("overflow", "visible")
      .append("xhtml:div")
      .attr("xmlns", "http://www.w3.org/1999/xhtml")
      .style("width", "100%")
      .style("height", "100%")
      .style("font-family", "sans-serif") 
      .html(d => {
        const hasChildren = d.data.children && d.data.children.length > 0;
        const isCollapsed = collapsedIds.has(d.data.id);
        const childCount = d.data.children ? d.data.children.length : 0;
        
        // Compact Inline Styles
        const cardStyle = `
            width: 100%; height: 100%; 
          background-color: var(--card-bg); 
          border: 1px solid ${hasChildren ? 'var(--card-border-manager)' : 'var(--card-border)'}; 
            border-radius: 0.375rem; 
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            display: flex; flex-direction: column; 
            padding: 8px 10px; 
            position: relative; z-index: 10;
            cursor: ${hasChildren ? 'pointer' : 'default'};
            box-sizing: border-box;
            font-family: var(--chart-font-family, sans-serif);
        `;

        const headerStyle = `
            display: flex; align-items: start; justify-content: space-between; 
            gap: 4px;
        `;

        const textContainerStyle = `
            flex: 1; min-width: 0;
        `;

        const nameStyle = `
          color: var(--card-name); font-weight: var(--card-name-weight, 700); font-size: var(--card-name-size, 12px); 
            line-height: 1.2; 
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            display: block; margin-bottom: 2px;
        `;

        const titleStyle = `
          color: var(--card-title); font-weight: var(--card-title-weight, 600); font-size: var(--card-title-size, 10px); 
            line-height: 1.2; 
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            display: block;
        `;

        const footerStyle = `
            margin-top: auto;
            display: flex; align-items: center; justify-content: space-between; gap: 4px;
        `;

        const deptStyle = `
          font-size: var(--card-dept-size, 9px); color: var(--card-dept); font-weight: var(--card-dept-weight, 500); 
            text-transform: uppercase; letter-spacing: 0.025em; 
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
            display: block;
        `;

        const badgeStyle = `
            height: 14px; padding-left: 4px; padding-right: 4px;
            border-radius: 9999px; border-width: 1px;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            ${isCollapsed 
            ? 'background-color: var(--badge-bg-collapsed); color: var(--badge-fg-collapsed); border-color: var(--badge-border-collapsed);' 
            : 'background-color: var(--badge-bg); color: var(--badge-fg); border-color: var(--badge-border);' 
            }
        `;

        return `
        <div style="${cardStyle}">
          <div style="${headerStyle}">
             <div style="${textContainerStyle}">
                <span style="${nameStyle}" title="${d.data.name}">${d.data.name}</span>
                <span style="${titleStyle}" title="${d.data.title}">${d.data.title}</span>
             </div>
             ${hasChildren ? 
                `<div style="${badgeStyle}">
                 <span style="font-size: var(--badge-count-size, 9px); font-weight: 700; margin-right: 1px; line-height: 1;">${childCount}</span>
                   ${isCollapsed 
                     ? '<svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' 
                     : '<svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
                   }
                </div>` 
                : ''}
          </div>
          <div style="${footerStyle}">
            <span style="${deptStyle}">${d.data.department || 'Org'}</span>
            ${d.data.details ? `
            <div style="position: relative;">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--card-icon, #cbd5e1); cursor: help; display: block;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            </div>` : ''}
          </div>
          
          ${isCollapsed && hasChildren ? `
            <div style="position: absolute; bottom: -0.25rem; left: 50%; transform: translateX(-50%); width: 1.5rem; height: 0.25rem; background-color: var(--card-notch-bg, var(--card-bg)); border: 1px solid var(--card-notch-border, var(--card-border)); border-top: none; border-bottom-right-radius: 0.25rem; border-bottom-left-radius: 0.25rem; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);"></div>
          ` : ''}
        </div>
      `;
      });

  }, [data, dimensions, direction, targetAspectRatio, collapsedIds, chartThemeId]);

  return (
    <div
      ref={containerRef}
      data-chart-theme={chartThemeId}
      className="w-full h-full relative overflow-hidden"
      style={{ backgroundColor: 'var(--chart-bg)' }}
    >
     <div
       data-export-exclude="true"
       className="absolute inset-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(var(--chart-grid-dot) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
      </div>
      <svg data-chart-svg="true" ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      <div
        data-export-exclude="true"
        className="absolute bottom-4 left-4 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm pointer-events-none select-none text-[10px]"
        style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--overlay-text)' }}
      >
        No data is shared — everything stays local in your browser.
      </div>
      
      
      
      <div data-export-exclude="true" className="absolute bottom-4 right-4 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm pointer-events-none select-none flex items-center gap-2 text-[10px]" style={{ backgroundColor: 'var(--overlay-bg)', border: '1px solid var(--overlay-border)', color: 'var(--overlay-text)' }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }}></span>
         Overlap-Free Engine v3 (Compact)
      </div>
    </div>
  );
});