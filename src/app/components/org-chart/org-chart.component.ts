import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  ViewChild,
  effect,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import * as d3 from 'd3';
import { toPng } from 'html-to-image';
import {
  ChartThemeId,
  LayoutDirection,
  OrgChartNodeKeys,
  OrgNode,
} from '../../models/org.types';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_BRANCH_GAP,
  DEFAULT_TARGET_ASPECT_RATIO,
  LayoutResult,
  OrgLayoutService,
} from '../../core/org-layout.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Org chart renderer backed by D3, using Harkje's custom layout engine.
 *
 * Public API mirrors PrimeNG's `p-organization-chart` where practical:
 *   - `[value]`        nested root OrgNode (single root per our invariant)
 *   - `[collapsible]`  whether clicking a parent toggles collapse (default true)
 *   - `[(collapsedKeys)]` two-way collapsed-state map { id: true }
 *   - `[chartThemeId]` chart theme to apply on the container
 *   - `[branchGap]`     minimum clear gap between adjacent subtree contours
 *   - `[targetAspectRatio]` requested width/height communication format
 *   - `[direction]`    layout direction (TopDown/LeftRight)
 *
 * Imperative methods (call via `@ViewChild`): `exportImage()`, `runCompaction()`.
 */
@Component({
  selector: 'app-org-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #container
      class="org-chart-container"
      [attr.data-chart-theme]="chartThemeId()"
    >
      <div data-export-exclude="true" class="org-chart-grid" aria-hidden="true"></div>
      <svg #svg class="org-chart-svg"></svg>
      <div data-export-exclude="true" class="org-chart-pill org-chart-pill--left">
        <span>No data is shared — everything stays local in your browser.</span>
        <span>•</span>
        <a
          href="https://github.com/pondevelopment/harkje/"
          target="_blank"
          rel="noreferrer"
          >Source</a
        >
      </div>
      <div data-export-exclude="true" class="org-chart-pill org-chart-pill--right">
        <span class="org-chart-dot"></span>
        Adaptive Layout Engine v6
      </div>
    </div>
  `,
  styleUrls: ['./org-chart.component.scss'],
})
export class OrgChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** Nested root org node. */
  readonly value = input.required<OrgNode>();
  /** Whether nodes can be collapsed by clicking. */
  readonly collapsible = input<boolean>(true);
  /** Two-way collapsed-state map (PrimeNG-style: key present + true = collapsed). */
  readonly collapsedKeys = model<OrgChartNodeKeys>({});
  /** Chart theme id applied to the container. */
  readonly chartThemeId = input<ChartThemeId>('light');
  /** Layout direction. */
  readonly direction = input<LayoutDirection>(LayoutDirection.TopDown);
  /** Clear breadth gap between adjacent cards/subtree contours, in pixels. */
  readonly branchGap = input<number>(DEFAULT_BRANCH_GAP);
  /** Requested width/height format; selects a discrete fixed-gap layout. */
  readonly targetAspectRatio = input<number>(DEFAULT_TARGET_ASPECT_RATIO);

  @ViewChild('container', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('svg', { static: true })
  svgRef!: ElementRef<SVGSVGElement>;

  private dimensions = signal({ width: 800, height: 600 });
  private resizeObserver?: ResizeObserver;

  /** Layout bounds of the last render (used for export + auto-fit). */
  private layoutBounds: {
    minX: number;
    minY: number;
    treeWidth: number;
    treeHeight: number;
  } | null = null;

  /** D3 selections + transform preserved across re-renders. */
  private g?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private root?: d3.HierarchyNode<OrgNode>;
  private layoutResult?: LayoutResult;
  private nodesSel?: d3.Selection<SVGGElement, any, SVGGElement, unknown>;
  private linksSel?: d3.Selection<SVGPathElement, any, SVGGElement, unknown>;
  private transform = d3.zoomIdentity;
  private prevData?: OrgNode;
  private prevLayoutKey?: string;

  private zoomBehavior?: d3.ZoomBehavior<SVGSVGElement, unknown>;

  constructor(private readonly layout: OrgLayoutService) {
    // Re-render whenever any layout-affecting input changes.
    effect(() => {
      // Read the signals so the effect tracks them.
      this.value();
      this.collapsible();
      this.collapsedKeys();
      this.chartThemeId();
      this.direction();
      this.branchGap();
      this.targetAspectRatio();
      this.dimensions();
      untracked(() => this.render());
    });
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => {
      const el = this.containerRef.nativeElement;
      this.dimensions.set({ width: el.clientWidth, height: el.clientHeight });
    });
    this.resizeObserver.observe(this.containerRef.nativeElement);
  }

  ngOnChanges(): void {
    // Inputs are signals; effect handles re-render. NgOnChanges kept for
    // interface completeness but intentionally has no body work beyond effect.
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  /** Export a PNG of the tight chart bounds (warmup + restore DOM). */
  async exportImage(): Promise<void> {
    if (!this.containerRef?.nativeElement || !this.svgRef?.nativeElement) return;
    if (!this.layoutBounds) {
      alert('Chart is not ready to export yet. Please try again in a moment.');
      return;
    }
    const svgEl = this.svgRef.nativeElement;
    const gEl = svgEl.querySelector('g');
    if (!gEl) {
      alert('Chart is not ready to export yet. Please try again in a moment.');
      return;
    }

    const { minX, minY, treeWidth, treeHeight } = this.layoutBounds;
    const exportWidth = Math.max(1, Math.ceil(treeWidth));
    const exportHeight = Math.max(1, Math.ceil(treeHeight));

    const containerEl = this.containerRef.nativeElement;
    const prevContainerWidth = containerEl.style.width;
    const prevContainerHeight = containerEl.style.height;
    const prevContainerOverflow = containerEl.style.overflow;
    const prevContainerBg = containerEl.style.background;
    const prevContainerBgColor = containerEl.style.backgroundColor;
    const prevSvgWidth = svgEl.getAttribute('width');
    const prevSvgHeight = svgEl.getAttribute('height');
    const prevGTransform = gEl.getAttribute('transform');

    const excludedEls = Array.from(
      containerEl.querySelectorAll('[data-export-exclude="true"]'),
    ) as HTMLElement[];
    const prevExcludedDisplay = excludedEls.map((el) => el.style.display);

    try {
      excludedEls.forEach((el) => (el.style.display = 'none'));
      containerEl.style.width = `${exportWidth}px`;
      containerEl.style.height = `${exportHeight}px`;
      containerEl.style.overflow = 'hidden';
      containerEl.style.backgroundColor = 'transparent';
      svgEl.setAttribute('width', String(exportWidth));
      svgEl.setAttribute('height', String(exportHeight));
      gEl.setAttribute('transform', `translate(${-minX},${-minY})`);

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // Warmup run
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
        // Ignore warmup errors.
      }

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
      link.download = `org-chart-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
      alert('Failed to export image. Please try using a modern desktop browser (Chrome/Edge/Firefox).');
    } finally {
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

  /** Deprecated compatibility alias; every render is already compact. */
  runCompaction(): void {
    if (!this.root) return;
    this.layoutResult = this.layout.computeTidyLayout(
      this.root,
      this.direction(),
      this.branchGap(),
      this.targetAspectRatio(),
    );
    this.updateDrawing();
  }

  private collapsedSet(): Set<string> {
    const map = this.collapsedKeys();
    const set = new Set<string>();
    for (const [id, val] of Object.entries(map)) {
      if (val) set.add(id);
    }
    return set;
  }

  private updateDrawing(): void {
    const root = this.root;
    const nodesSel = this.nodesSel;
    const linksSel = this.linksSel;
    const result = this.layoutResult;
    if (!root || !nodesSel || !linksSel || !result) return;
    linksSel.attr('d', (d: any) =>
      this.layout.buildLinkPath(d, this.direction(), result.routes),
    );
    nodesSel.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    this.layoutBounds = {
      minX: result.frameBounds.minX,
      minY: result.frameBounds.minY,
      treeWidth: result.frameBounds.treeWidth,
      treeHeight: result.frameBounds.treeHeight,
    };
  }

  private render(): void {
    if (!this.svgRef?.nativeElement) return;
    const containerEl = this.containerRef?.nativeElement;
    const computed = containerEl ? window.getComputedStyle(containerEl) : null;
    const chartLinkStroke = (computed?.getPropertyValue('--chart-link') || '').trim() || '#cbd5e1';

    const data = this.value();
    const svg = d3.select(this.svgRef.nativeElement);
    svg.selectAll('*').remove();

    const { width, height } = this.dimensions();
    const root = d3.hierarchy<OrgNode>(data);
    const layoutKey = `${this.direction()}|${this.branchGap()}|${this.targetAspectRatio()}`;

    // Apply collapse state
    const collapsed = this.collapsedSet();
    root.descendants().forEach((d) => {
      if (collapsed.has(d.data.id)) {
        d.children = undefined;
      }
    });

    const result = this.layout.computeTidyLayout(
      root,
      this.direction(),
      this.branchGap(),
      this.targetAspectRatio(),
    );
    this.layoutResult = result;
    this.layoutBounds = {
      minX: result.frameBounds.minX,
      minY: result.frameBounds.minY,
      treeWidth: result.frameBounds.treeWidth,
      treeHeight: result.frameBounds.treeHeight,
    };

    const g = svg.append('g');
    this.g = g;
    this.root = root;

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        this.transform = event.transform;
      });
    this.zoomBehavior = zoom;
    svg.call(zoom);

    // Determine zoom strategy
    if (this.prevData !== data || this.prevLayoutKey !== layoutKey) {
      const padding = 80;
      const availableW = width - padding * 2;
      const availableH = height - padding * 2;
      const scale = Math.min(
        1.2,
        Math.min(
          availableW / result.frameBounds.treeWidth,
          availableH / result.frameBounds.treeHeight,
        ),
      );
      const layoutCenterX = result.frameBounds.minX + result.frameBounds.treeWidth / 2;
      const layoutCenterY = result.frameBounds.minY + result.frameBounds.treeHeight / 2;
      const transformX = width / 2 - layoutCenterX * scale;
      const transformY = height / 2 - layoutCenterY * scale;
      const newTransform = d3.zoomIdentity.translate(transformX, transformY).scale(scale);
      svg.call(zoom.transform, newTransform);
      this.transform = newTransform;
      this.prevData = data;
      this.prevLayoutKey = layoutKey;
    } else {
      svg.call(zoom.transform, this.transform);
    }

    // Draw links
    const linksSel = g
      .selectAll('.link')
      .data(root.links())
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', chartLinkStroke)
      .attr('stroke-width', 1.5)
      .attr('d', (d: any) =>
        this.layout.buildLinkPath(d, this.direction(), result.routes),
      );
    this.linksSel = linksSel as any;

    // Draw nodes
    const collapsedNow = collapsed;
    const node = g
      .selectAll('.node')
      .data(root.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', (d: any) => `translate(${d.x},${d.y})`)
      .on('click', (event: any, d: any) => {
        if (!this.collapsible()) return;
        // Collapse only if the node had children in the ORIGINAL data.
        const original = this.findOriginalNode(d.data.id);
        if (original?.children && original.children.length > 0) {
          event.stopPropagation();
          this.toggleCollapse(d.data.id);
        }
      });
    this.nodesSel = node as any;

    node
      .append('foreignObject')
      .attr('width', CARD_WIDTH)
      .attr('height', CARD_HEIGHT)
      .attr('x', -CARD_WIDTH / 2)
      .attr('y', 0)
      .style('overflow', 'visible')
      .append('xhtml:div')
      .attr('xmlns', 'http://www.w3.org/1999/xhtml')
      .style('width', '100%')
      .style('height', '100%')
      .style('font-family', 'sans-serif')
      .html((d: any) => this.cardHtml(d, collapsedNow));
  }

  private findOriginalNode(id: string): OrgNode | undefined {
    const data = this.value();
    const search = (n: OrgNode): OrgNode | undefined => {
      if (n.id === id) return n;
      if (n.children) {
        for (const c of n.children) {
          const found = search(c);
          if (found) return found;
        }
      }
      return undefined;
    };
    return search(data);
  }

  private toggleCollapse(id: string): void {
    const next = { ...this.collapsedKeys() };
    if (next[id]) delete next[id];
    else next[id] = true;
    this.collapsedKeys.set(next);
  }

  private cardHtml(d: any, collapsed: Set<string>): string {
    const data = this.value();
    const original = (() => {
      const search = (n: OrgNode): OrgNode | undefined => {
        if (n.id === d.data.id) return n;
        if (n.children) for (const c of n.children) {
          const f = search(c);
          if (f) return f;
        }
        return undefined;
      };
      return search(data);
    })();
    const hasChildren = !!(original?.children && original.children.length > 0);
    const isCollapsed = collapsed.has(d.data.id);
    const childCount = original?.children ? original.children.length : 0;

    // Compact inline styles — these reference CSS vars (--card-*) so they
    // respond to the chart theme applied on the container.
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
    const headerStyle = `display: flex; align-items: start; justify-content: space-between; gap: 4px;`;
    const textContainerStyle = `flex: 1; min-width: 0;`;
    const nameStyle = `color: var(--card-name); font-weight: var(--card-name-weight, 700); font-size: var(--card-name-size, 12px); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; margin-bottom: 2px;`;
    const titleStyle = `color: var(--card-title); font-weight: var(--card-title-weight, 600); font-size: var(--card-title-size, 10px); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;`;
    const footerStyle = `margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 4px;`;
    const deptStyle = `font-size: var(--card-dept-size, 9px); color: var(--card-dept); font-weight: var(--card-dept-weight, 500); text-transform: uppercase; letter-spacing: 0.025em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; display: block;`;
    const badgeStyle = `height: 14px; padding-left: 4px; padding-right: 4px; border-radius: 9999px; border-width: 1px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; ${
      isCollapsed
        ? 'background-color: var(--badge-bg-collapsed); color: var(--badge-fg-collapsed); border-color: var(--badge-border-collapsed);'
        : 'background-color: var(--badge-bg); color: var(--badge-fg); border-color: var(--badge-border);'
    }`;

    return `
    <div style="${cardStyle}">
      <div style="${headerStyle}">
         <div style="${textContainerStyle}">
            <span style="${nameStyle}" title="${d.data.name}">${d.data.name}</span>
            <span style="${titleStyle}" title="${d.data.title}">${d.data.title}</span>
         </div>
         ${hasChildren ? `<div style="${badgeStyle}"><span style="font-size: var(--badge-count-size, 9px); font-weight: 700; margin-right: 1px; line-height: 1;">${childCount}</span>${
           isCollapsed
             ? '<svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
             : '<svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
         }</div>` : ''}
      </div>
      <div style="${footerStyle}">
        <span style="${deptStyle}">${d.data.department || 'Org'}</span>
        ${d.data.details ? `<div style="position: relative;"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--card-icon, #cbd5e1); cursor: help; display: block;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></div>` : ''}
      </div>
      ${isCollapsed && hasChildren ? `<div style="position: absolute; bottom: -0.25rem; left: 50%; transform: translateX(-50%); width: 1.5rem; height: 0.25rem; background-color: var(--card-notch-bg, var(--card-bg)); border: 1px solid var(--card-notch-border, var(--card-border)); border-top: none; border-bottom-right-radius: 0.25rem; border-bottom-left-radius: 0.25rem; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);"></div>` : ''}
    </div>`;
  }
}
