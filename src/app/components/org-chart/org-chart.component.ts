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
  output,
  signal,
  untracked,
} from '@angular/core';
import * as d3 from 'd3';
import { toPng } from 'html-to-image';
import {
  ChartThemeId,
  LayoutDirection,
  LayoutResult,
  OrgChartNodeKeys,
  OrgNode,
} from '../../models/org.types';
import {
  AdaptiveOrgLayoutService,
  CARD_HEIGHT,
  CARD_WIDTH,
} from '../../core/adaptive-org-layout.service';
import { BUILD_SHA, BUILD_VERSION } from '../../../environments/build-info';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Org chart renderer backed by D3, using Harkje's custom layout engine.
 *
 * Public API mirrors PrimeNG's `p-organization-chart` where practical:
 *   - `[value]`        nested root OrgNode (single root per our invariant)
 *   - `[collapsible]`  whether clicking a parent toggles collapse (default true)
 *   - `[(collapsedKeys)]` two-way collapsed-state map { id: true }
 *   - `[chartThemeId]` chart theme to apply on the container
 *   - `[targetAspectRatio]` drives the row/grid/wrap layout decision
 *   - `[direction]`    layout direction (TopDown/LeftRight)
 *
 * Imperative methods (call via `@ViewChild`): `exportImage()` (PNG), `exportSvg()` (SVG),
 * `runCompaction()`.
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
      <div data-export-exclude="true" class="org-chart-pill org-chart-pill--right" [attr.data-version]="version">
        <span class="org-chart-dot"></span>
        Overlap-Free Engine v3 (Compact)
        <span class="org-chart-pill__sep" aria-hidden="true">•</span>
        <span class="org-chart-pill__version" [title]="shaTooltip">harkje v{{ version }}</span>
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
  /** Target aspect ratio for the layout decision. */
  readonly targetAspectRatio = input<number>(1);
  /** Reports completion of a render attempt for the exact input data object. */
  readonly renderSettled = output<{ data: OrgNode; error?: unknown }>();

  /** Build info displayed in the chart info pill (excluded from exports). */
  readonly version: string = BUILD_VERSION ?? 'unknown';
  readonly shaTooltip: string = BUILD_SHA ? `Build ${BUILD_SHA}` : 'Local development build';

  @ViewChild('container', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('svg', { static: true })
  svgRef!: ElementRef<SVGSVGElement>;

  private dimensions = signal({ width: 800, height: 600 });
  private resizeObserver?: ResizeObserver;

  /** True while an export is mutating the container (suppresses resize re-renders). */
  private isExporting = false;

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

  constructor(private readonly layout: AdaptiveOrgLayoutService) {
    // Re-render whenever any layout-affecting input changes.
    effect(() => {
      // Read the signals so the effect tracks them.
      const data = this.value();
      this.collapsible();
      this.collapsedKeys();
      this.chartThemeId();
      this.direction();
      this.targetAspectRatio();
      this.dimensions();
      untracked(() => {
        let error: unknown;
        try {
          this.render(data);
        } catch (renderError) {
          error = renderError;
          console.error('Failed to render organization chart', renderError);
        } finally {
          this.renderSettled.emit(error ? { data, error } : { data });
        }
      });
    });
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => {
      // Ignore container resizes while an export is mutating the container —
      // otherwise the export resize triggers a full re-render mid-serialization
      // which clobbers the export transform and clips the output.
      if (this.isExporting) return;
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
    const containerEl = this.containerRef.nativeElement;

    let restore:
      | ((() => void) & { exportWidth: number; exportHeight: number })
      | undefined;
    try {
      restore = await this.prepareChartForExport();

      // Warmup run
      try {
        await toPng(containerEl, {
          quality: 0.1,
          skipFonts: true,
          pixelRatio: 1,
          width: restore.exportWidth,
          height: restore.exportHeight,
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
        width: restore.exportWidth,
        height: restore.exportHeight,
      });

      const link = document.createElement('a');
      link.download = this.exportFilename('png');
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
      alert('Failed to export image. Please try using a modern desktop browser (Chrome/Edge/Firefox).');
    } finally {
      restore?.();
    }
  }

  /** Shared export filename: org-chart-YYYY-MM-DD.<ext> */
  private exportFilename(ext: 'png' | 'svg'): string {
    return `org-chart-${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  /**
   * Hide export-excluded overlays, size the container/SVG to the tight chart
   * bounds plus padding, and translate the chart group. Returns a restore
   * callback (also carries exportWidth/exportHeight).
   */
  private async prepareChartForExport(): Promise<
    (() => void) & { exportWidth: number; exportHeight: number }
  > {
    const svgEl = this.svgRef!.nativeElement as SVGSVGElement;
    const gEl = svgEl.querySelector('g')!;
    const containerEl = this.containerRef!.nativeElement;

    const padding = 40;
    const { minX, minY, treeWidth, treeHeight } = this.layoutBounds!;
    const exportWidth = Math.max(1, Math.ceil(treeWidth + padding * 2));
    const exportHeight = Math.max(1, Math.ceil(treeHeight + padding * 2));

    const prevContainerWidth = containerEl.style.width;
    const prevContainerHeight = containerEl.style.height;
    const prevContainerOverflow = containerEl.style.overflow;
    const prevSvgWidth = svgEl.getAttribute('width');
    const prevSvgHeight = svgEl.getAttribute('height');
    const prevGTransform = gEl.getAttribute('transform');

    const excludedEls = Array.from(
      containerEl.querySelectorAll('[data-export-exclude="true"]'),
    ) as HTMLElement[];
    const prevExcludedDisplay = excludedEls.map((el) => el.style.display);

    // Suppress resize-driven re-renders while the export mutates the container.
    this.isExporting = true;
    excludedEls.forEach((el) => (el.style.display = 'none'));
    containerEl.style.width = `${exportWidth}px`;
    containerEl.style.height = `${exportHeight}px`;
    containerEl.style.overflow = 'hidden';
    svgEl.setAttribute('width', String(exportWidth));
    svgEl.setAttribute('height', String(exportHeight));
    gEl.setAttribute('transform', `translate(${padding - minX},${padding - minY})`);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const restoreFn = () => {
      excludedEls.forEach((el, i) => (el.style.display = prevExcludedDisplay[i] ?? ''));
      containerEl.style.width = prevContainerWidth;
      containerEl.style.height = prevContainerHeight;
      containerEl.style.overflow = prevContainerOverflow;
      if (prevSvgWidth === null) svgEl.removeAttribute('width');
      else svgEl.setAttribute('width', prevSvgWidth);
      if (prevSvgHeight === null) svgEl.removeAttribute('height');
      else svgEl.setAttribute('height', prevSvgHeight);
      if (prevGTransform === null) gEl.removeAttribute('transform');
      else gEl.setAttribute('transform', prevGTransform);
      // React to the restored container size (and re-enable RO handling).
      this.isExporting = false;
      const el = this.containerRef?.nativeElement;
      if (el) this.dimensions.set({ width: el.clientWidth, height: el.clientHeight });
    };
    return Object.assign(restoreFn, { exportWidth, exportHeight });
  }

  /** Export an SVG of the tight chart bounds (native primitives, no DOM mutation). */
  async exportSvg(): Promise<void> {
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

    try {
      const { minX, minY, treeWidth, treeHeight } = this.layoutBounds;
      const padding = 40;
      const exportWidth = Math.max(1, Math.ceil(treeWidth + padding * 2));
      const exportHeight = Math.max(1, Math.ceil(treeHeight + padding * 2));

      // Clone the live SVG (detached) and frame the tight chart bounds.
      const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clonedSvg.removeAttribute('id');
      clonedSvg.removeAttribute('class');
      clonedSvg.removeAttribute('style');
      clonedSvg.setAttribute('width', String(exportWidth));
      clonedSvg.setAttribute('height', String(exportHeight));
      clonedSvg.setAttribute('viewBox', `0 0 ${exportWidth} ${exportHeight}`);
      clonedSvg
        .querySelector('g')
        ?.setAttribute(
          'transform',
          `translate(${padding - minX},${padding - minY})`,
        );

      // Replace foreignObject HTML cards with native SVG primitives so the
      // file renders in every viewer (browser tab, design tools, and <img>).
      const computed = window.getComputedStyle(this.containerRef.nativeElement);
      this.replaceExportCards(clonedSvg, svgEl, computed);

      const markup = new XMLSerializer().serializeToString(clonedSvg);
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = this.exportFilename('svg');
      link.href = objectUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      console.error('Failed to export SVG', err);
      alert('Failed to export SVG. Please try using a modern desktop browser (Chrome/Edge/Firefox).');
    }
  }

  /**
   * foreignObject HTML depends on viewer support (and taints canvases). Replace
   * detached export cards with native SVG elements while retaining the selected
   * chart theme and core person information.
   */
  private replaceExportCards(
    clonedSvg: SVGSVGElement,
    sourceSvg: SVGSVGElement,
    computed: CSSStyleDeclaration,
  ): void {
    const namespace = 'http://www.w3.org/2000/svg';
    const sourceNodes = Array.from(sourceSvg.querySelectorAll<SVGGElement>('g.node'));
    const clonedNodes = Array.from(clonedSvg.querySelectorAll<SVGGElement>('g.node'));
    const cardBg = this.exportColor(computed, '--card-bg', '#ffffff');
    const cardBorder = this.exportColor(computed, '--card-border', '#e2e8f0');
    const managerBorder = this.exportColor(
      computed,
      '--card-border-manager',
      cardBorder,
    );
    const nameColor = this.exportColor(computed, '--card-name', '#0f172a');
    const titleColor = this.exportColor(computed, '--card-title', '#4f46e5');
    const departmentColor = this.exportColor(computed, '--card-dept', '#64748b');

    clonedNodes.forEach((clonedNode, index) => {
      const sourceNode = sourceNodes[index] as
        | (SVGGElement & { __data__?: d3.HierarchyNode<OrgNode> })
        | undefined;
      const datum = sourceNode?.__data__;
      if (!datum) return;
      clonedNode.querySelector('foreignObject')?.remove();
      clonedNode.removeAttribute('class');

      const data = datum.data;
      const hasChildren = !!(data.children && data.children.length > 0);
      const rect = document.createElementNS(namespace, 'rect');
      rect.setAttribute('x', String(-CARD_WIDTH / 2));
      rect.setAttribute('y', '0');
      rect.setAttribute('width', String(CARD_WIDTH));
      rect.setAttribute('height', String(CARD_HEIGHT));
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', cardBg);
      rect.setAttribute('stroke', hasChildren ? managerBorder : cardBorder);
      rect.setAttribute('stroke-width', '1');
      clonedNode.appendChild(rect);

      const divider = document.createElementNS(namespace, 'line');
      divider.setAttribute('x1', '-78');
      divider.setAttribute('x2', '78');
      divider.setAttribute('y1', '48');
      divider.setAttribute('y2', '48');
      divider.setAttribute('stroke', cardBorder);
      divider.setAttribute('stroke-width', '0.75');
      clonedNode.appendChild(divider);

      clonedNode.appendChild(
        this.exportText(
          namespace,
          this.truncateExportText(data.name, 22),
          -78,
          18,
          nameColor,
          '12px',
          '700',
        ),
      );
      clonedNode.appendChild(
        this.exportText(
          namespace,
          this.truncateExportText(data.title, 28),
          -78,
          34,
          titleColor,
          '10px',
          '600',
        ),
      );
      clonedNode.appendChild(
        this.exportText(
          namespace,
          this.truncateExportText((data.department || 'General').toUpperCase(), 27),
          -78,
          64,
          departmentColor,
          '9px',
          '500',
        ),
      );

      if (hasChildren) {
        const count = data.children!.length;
        const badge = document.createElementNS(namespace, 'circle');
        badge.setAttribute('cx', '76');
        badge.setAttribute('cy', '14');
        badge.setAttribute('r', '8');
        badge.setAttribute('fill', 'none');
        badge.setAttribute('stroke', titleColor);
        badge.setAttribute('stroke-width', '1');
        clonedNode.appendChild(badge);
        const countText = this.exportText(
          namespace,
          String(count),
          76,
          17,
          titleColor,
          '8px',
          '700',
        );
        countText.setAttribute('text-anchor', 'middle');
        clonedNode.appendChild(countText);
      }
    });
  }

  private exportText(
    namespace: string,
    value: string,
    x: number,
    y: number,
    fill: string,
    fontSize: string,
    fontWeight: string,
  ): SVGTextElement {
    const text = document.createElementNS(namespace, 'text') as SVGTextElement;
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(y));
    text.setAttribute('fill', fill);
    text.setAttribute('font-family', 'Arial, sans-serif');
    text.setAttribute('font-size', fontSize);
    text.setAttribute('font-weight', fontWeight);
    text.textContent = value;
    return text;
  }

  private exportColor(
    computed: CSSStyleDeclaration,
    property: string,
    fallback: string,
  ): string {
    return computed.getPropertyValue(property).trim() || fallback;
  }

  private truncateExportText(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
  }

  /** Run an optional compaction pass to reduce whitespace (animated). */
  runCompaction(): void {
    this.render();
  }

  private collapsedSet(): Set<string> {
    const map = this.collapsedKeys();
    const set = new Set<string>();
    for (const [id, val] of Object.entries(map)) {
      if (val) set.add(id);
    }
    return set;
  }

  private render(data: OrgNode = this.value()): void {
    if (!this.svgRef?.nativeElement) return;
    const containerEl = this.containerRef?.nativeElement;
    const computed = containerEl ? window.getComputedStyle(containerEl) : null;
    const chartLinkStroke = (computed?.getPropertyValue('--chart-link') || '').trim() || '#cbd5e1';

    const svg = d3.select(this.svgRef.nativeElement);
    svg.selectAll('*').remove();

    const { width, height } = this.dimensions();
    const root = d3.hierarchy<OrgNode>(data);

    // Apply collapse state
    const collapsed = this.collapsedSet();
    root.descendants().forEach((d) => {
      if (collapsed.has(d.data.id)) {
        d.children = undefined;
      }
    });

    const layoutResult = this.layout.computeLayout(
      root,
      this.direction(),
      this.targetAspectRatio(),
    );
    this.layoutResult = layoutResult;
    const { bounds } = layoutResult;
    this.layoutBounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      treeWidth: bounds.treeWidth,
      treeHeight: bounds.treeHeight,
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
    svg.call(zoom);

    // Determine zoom strategy
    if (this.prevData !== data) {
      const padding = 80;
      const availableW = width - padding * 2;
      const availableH = height - padding * 2;
      const scale = Math.min(1.2, Math.min(availableW / bounds.treeWidth, availableH / bounds.treeHeight));
      const layoutCenterX = bounds.minX + bounds.treeWidth / 2;
      const layoutCenterY = bounds.minY + bounds.treeHeight / 2;
      const transformX = width / 2 - layoutCenterX * scale;
      const transformY = height / 2 - layoutCenterY * scale;
      const newTransform = d3.zoomIdentity.translate(transformX, transformY).scale(scale);
      svg.call(zoom.transform, newTransform);
      this.transform = newTransform;
      this.prevData = data;
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
      .attr('d', (d: any) => this.layout.buildLinkPath(d, layoutResult.routes));
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
