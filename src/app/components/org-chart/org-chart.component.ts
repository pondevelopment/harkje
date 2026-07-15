import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import * as d3 from 'd3';
import {
  ChartThemeId,
  LayoutDirection,
  OrgChartNodeKeys,
  OrgNode,
} from '../../models/org.types';
import {
  AdaptiveOrgLayoutService,
  CARD_HEIGHT,
  CARD_WIDTH,
  LayoutResult,
} from '../../core/adaptive-org-layout.service';

/**
 * Org chart renderer backed by D3, using Harkje's custom layout engine.
 *
 * Public API mirrors PrimeNG's `p-organization-chart` where practical:
 *   - `[value]`        nested root OrgNode (single root per our invariant)
 *   - `[collapsible]`  whether clicking a parent toggles collapse (default true)
 *   - `[(collapsedKeys)]` two-way collapsed-state map { id: true }
 *   - `[chartThemeId]` chart theme to apply on the container
 *   - `[targetAspectRatio]` selects a fixed-gap row topology
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
        Adaptive Layout Engine v4
      </div>
    </div>
  `,
  styleUrls: ['./org-chart.component.scss'],
})
export class OrgChartComponent implements AfterViewInit, OnDestroy {
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
  private hierarchyData?: OrgNode;
  private hierarchyCollapsedKey?: string;

  constructor(private readonly layout: AdaptiveOrgLayoutService) {
    // Re-render whenever any layout-affecting input changes.
    effect(() => {
      // Read the signals so the effect tracks them.
      this.value();
      this.collapsible();
      this.collapsedKeys();
      this.chartThemeId();
      this.direction();
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

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  /** Export a PNG of the exact target-ratio frame (SVG → canvas). */
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

    const exportBounds = this.layoutResult?.frameBounds ?? this.layoutBounds;
    const { minX, minY, treeWidth, treeHeight } = exportBounds;
    const exportWidth = Math.max(1, Math.ceil(treeWidth));
    const exportHeight = Math.max(1, Math.ceil(treeHeight));

    try {
      const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clonedSvg.setAttribute('width', String(exportWidth));
      clonedSvg.setAttribute('height', String(exportHeight));
      clonedSvg.setAttribute('viewBox', `0 0 ${exportWidth} ${exportHeight}`);
      clonedSvg.querySelector('g')?.setAttribute(
        'transform',
        `translate(${-minX},${-minY})`,
      );

      const computed = window.getComputedStyle(this.containerRef.nativeElement);
      this.replaceExportCards(clonedSvg, svgEl, computed);

      const markup = new XMLSerializer().serializeToString(clonedSvg);
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Failed to rasterize chart SVG.'));
          image.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }

      const canvas = document.createElement('canvas');
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas export is unavailable.');
      context.clearRect(0, 0, exportWidth, exportHeight);
      context.drawImage(image, 0, 0, exportWidth, exportHeight);
      const dataUrl = canvas.toDataURL('image/png');

      const link = document.createElement('a');
      link.download = `org-chart-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export image', err);
      alert('Failed to export image. Please try using a modern desktop browser (Chrome/Edge/Firefox).');
    }
  }

  /**
   * Canvas security rules taint images containing SVG `<foreignObject>` HTML.
   * Replace detached export cards with native SVG elements while retaining the
   * selected chart theme and core person information.
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

  /** Compatibility alias: recompute the current optimal adaptive layout. */
  runCompaction(): void {
    if (!this.root) return;
    this.layoutResult = this.layout.computeAdaptiveLayout(
      this.root,
      this.direction(),
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
      this.layout.buildLinkPath(d, result.routes),
    );
    nodesSel.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    this.layoutBounds = {
      minX: result.bounds.minX,
      minY: result.bounds.minY,
      treeWidth: result.bounds.treeWidth,
      treeHeight: result.bounds.treeHeight,
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
    const layoutKey = `${this.direction()}|${this.targetAspectRatio()}`;

    const collapsed = this.collapsedSet();
    const collapsedKey = Array.from(collapsed).sort().join('\u0000');
    let root = this.root;
    if (
      !root ||
      this.hierarchyData !== data ||
      this.hierarchyCollapsedKey !== collapsedKey
    ) {
      root = d3.hierarchy<OrgNode>(data);
      root.descendants().forEach((d) => {
        if (collapsed.has(d.data.id)) d.children = undefined;
      });
      this.hierarchyData = data;
      this.hierarchyCollapsedKey = collapsedKey;
    }

    const result = this.layout.computeAdaptiveLayout(
      root,
      this.direction(),
      this.targetAspectRatio(),
    );
    this.layoutResult = result;
    this.layoutBounds = {
      minX: result.bounds.minX,
      minY: result.bounds.minY,
      treeWidth: result.bounds.treeWidth,
      treeHeight: result.bounds.treeHeight,
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
    if (this.prevData !== data || this.prevLayoutKey !== layoutKey) {
      const padding = 80;
      const availableW = width - padding * 2;
      const availableH = height - padding * 2;
      const scale = Math.max(
        0.1,
        Math.min(
          1.2,
          Math.min(
            availableW / result.bounds.treeWidth,
            availableH / result.bounds.treeHeight,
          ),
        ),
      );
      const layoutCenterX = result.bounds.minX + result.bounds.treeWidth / 2;
      const layoutCenterY = result.bounds.minY + result.bounds.treeHeight / 2;
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
        this.layout.buildLinkPath(d, result.routes),
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
