import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Menu, X, Ratio, Download } from 'lucide-angular';
import { LayoutDirection, OrgChartNodeKeys, OrgNode } from './models/org.types';
import { ThemeService } from './core/theme.service';
import { INITIAL_DATA } from './constants/initial-data';
import { InputPanelComponent } from './components/input-panel/input-panel.component';
import { OrgChartComponent } from './components/org-chart/org-chart.component';

/**
 * App shell: sidebar (InputPanel) + main chart area (OrgChart), with toolbar
 * (theme selects, aspect ratio slider, download, compact) and a draggable
 * sidebar resize handle. State is held in signals; zoneless change detection.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.shell--sidebar-open]="isSidebarOpen()">
      <!-- Mobile sidebar toggle -->
      <button
        type="button"
        class="mobile-toggle"
        (click)="isSidebarOpen.set(!isSidebarOpen())"
        title="Toggle sidebar"
      >
        @if (isSidebarOpen()) {
          <lucide-icon [img]="X" [size]="20" />
        } @else {
          <lucide-icon [img]="Menu" [size]="20" />
        }
      </button>

      <!-- Sidebar -->
      <div class="sidebar" [class.sidebar--open]="isSidebarOpen()">
        <app-input-panel
          [currentData]="data()"
          (dataChange)="data.set($event)"
        />
        <div
          class="resize-handle"
          (pointerdown)="onResizeStart($event)"
          title="Drag to resize sidebar"
          role="separator"
          [attr.aria-orientation]="'vertical'"
        ></div>
        <button
          type="button"
          class="sidebar-toggle sidebar-toggle--collapse"
          (click)="onToggleClick()"
          (pointerdown)="onTogglePointerDown($event)"
          title="Collapse Sidebar"
        >
          <span class="grip"></span>
        </button>
      </div>

      @if (!isSidebarOpen()) {
        <button
          type="button"
          class="sidebar-toggle sidebar-toggle--expand"
          (click)="isSidebarOpen.set(true)"
          title="Expand Sidebar"
        >
          <span class="grip"></span>
        </button>
      }

      <div class="main">
        <div class="toolbar">
          <div class="tool tool--select">
            <label for="site-theme">Site theme</label>
            <select
              id="site-theme"
              [value]="themeService.siteThemeId()"
              (change)="themeService.setSiteThemeId($any($event.target).value)"
            >
              @for (t of themeService.siteThemes; track t.id) {
                <option [value]="t.id">{{ t.label }}</option>
              }
            </select>
          </div>

          <div class="tool tool--select">
            <label for="chart-theme">Chart theme</label>
            <select
              id="chart-theme"
              [value]="themeService.chartThemeId()"
              (change)="themeService.setChartThemeId($any($event.target).value)"
            >
              @for (t of themeService.chartThemes; track t.id) {
                <option [value]="t.id">{{ t.label }}</option>
              }
            </select>
          </div>

          <div class="tool tool--ratio">
            <div class="ratio-header">
              <lucide-icon [img]="Ratio" [size]="14" />
              <span>Aspect Ratio</span>
            </div>
            <div class="ratio-row">
              <input
                type="range"
                min="0.25"
                max="4"
                step="0.05"
                [value]="targetAspectRatioUi()"
                (input)="onAspectRatioInput($event)"
                (pointerup)="commitAspectRatio()"
                (pointercancel)="commitAspectRatio()"
                (blur)="commitAspectRatio()"
              />
              <span class="ratio-value">{{ targetAspectRatioUi().toFixed(2) }}</span>
            </div>
          </div>

          <button
            type="button"
            class="tool tool--btn"
            (click)="handleDownload()"
            title="Download image (PNG)"
          >
            <lucide-icon [img]="Download" [size]="18" />
            <span>Download image</span>
          </button>

          <button
            type="button"
            class="tool tool--btn"
            (click)="handleCompact()"
            title="Run an optional compaction pass to reduce whitespace"
          >
            <span>Compact layout</span>
          </button>
        </div>

        <div
          class="chart-view"
          [style.width.px]="isSidebarOpen() ? null : null"
        >
          <app-org-chart
            #chart
            [value]="data()"
            [collapsible]="true"
            [(collapsedKeys)]="collapsedKeys"
            [chartThemeId]="themeService.chartThemeId()"
            [direction]="LayoutDirection.TopDown"
            [targetAspectRatio]="targetAspectRatio()"
          />
        </div>
      </div>
    </div>
  `,
  imports: [LucideAngularModule, InputPanelComponent, OrgChartComponent],
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly themeService = inject(ThemeService);
  private readonly zone = inject(NgZone);

  @ViewChild('chart', { static: false })
  chartRef?: OrgChartComponent;

  // Icon data exposed to the template for [img] bindings.
  readonly X = X;
  readonly Menu = Menu;
  readonly Ratio = Ratio;
  readonly Download = Download;

  readonly LayoutDirection = LayoutDirection;

  readonly data = signal<OrgNode>(INITIAL_DATA);
  readonly isSidebarOpen = signal(true);
  readonly collapsedKeys = signal<OrgChartNodeKeys>({});

  private readonly DEFAULT_SIDEBAR_WIDTH =
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 384 : 320;
  private readonly MIN_SIDEBAR_WIDTH = 280;
  private readonly MAX_SIDEBAR_WIDTH = 1200;
  private readonly MIN_CHART_WIDTH = 320;

  readonly sidebarWidth = signal<number>(this.DEFAULT_SIDEBAR_WIDTH);

  readonly targetAspectRatio = signal<number>(1);
  readonly targetAspectRatioUi = signal<number>(1);
  private ratioCommitTimeout: number | null = null;

  private resizing = false;
  private suppressToggleClick = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private onResizeMove?: (e: PointerEvent) => void;
  private onResizeEnd?: (e: PointerEvent) => void;

  constructor() {
    effect(() => {
      this.themeService.siteThemeId();
      this.themeService.chartThemeId();
    });
  }

  ngOnInit(): void {
    this.themeService.init();
  }

  ngOnDestroy(): void {
    this.cleanupResizeListeners();
    if (this.ratioCommitTimeout !== null) {
      clearTimeout(this.ratioCommitTimeout);
    }
  }

  private clampSidebarWidth(width: number): number {
    const viewportMax =
      typeof window !== 'undefined'
        ? Math.max(this.MIN_SIDEBAR_WIDTH, window.innerWidth - this.MIN_CHART_WIDTH)
        : this.MAX_SIDEBAR_WIDTH;
    return Math.max(
      this.MIN_SIDEBAR_WIDTH,
      Math.min(width, Math.min(this.MAX_SIDEBAR_WIDTH, viewportMax)),
    );
  }

  onResizeStart(e: PointerEvent): void {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    this.cleanupResizeListeners();
    this.resizing = true;
    this.suppressToggleClick = false;
    this.resizeStartX = e.clientX;
    this.resizeStartWidth = this.sidebarWidth();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      if (!this.resizing) return;
      const dx = ev.clientX - this.resizeStartX;
      if (Math.abs(dx) > 3) this.suppressToggleClick = true;
      this.zone.run(() => {
        this.sidebarWidth.set(this.clampSidebarWidth(this.resizeStartWidth + dx));
      });
      ev.preventDefault();
    };
    const onEnd = (ev: PointerEvent) => {
      if (!this.resizing) return;
      this.resizing = false;
      this.cleanupResizeListeners();
      ev.preventDefault();
    };

    this.onResizeMove = onMove;
    this.onResizeEnd = onEnd;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd, { passive: false });
    window.addEventListener('pointercancel', onEnd, { passive: false });
  }

  onTogglePointerDown(e: PointerEvent): void {
    this.onResizeStart(e);
  }

  onToggleClick(): void {
    if (this.suppressToggleClick) {
      this.suppressToggleClick = false;
      return;
    }
    this.isSidebarOpen.set(false);
  }

  private cleanupResizeListeners(): void {
    if (this.onResizeMove) {
      window.removeEventListener('pointermove', this.onResizeMove);
      this.onResizeMove = undefined;
    }
    if (this.onResizeEnd) {
      window.removeEventListener('pointerup', this.onResizeEnd);
      window.removeEventListener('pointercancel', this.onResizeEnd);
      this.onResizeEnd = undefined;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  onAspectRatioInput(e: Event): void {
    const next = parseFloat((e.target as HTMLInputElement).value);
    this.targetAspectRatioUi.set(next);
    this.scheduleAspectRatioCommit(next);
  }

  private scheduleAspectRatioCommit(value: number): void {
    if (this.ratioCommitTimeout !== null) {
      clearTimeout(this.ratioCommitTimeout);
    }
    this.ratioCommitTimeout = window.setTimeout(() => {
      this.ratioCommitTimeout = null;
      this.targetAspectRatio.set(value);
    }, 120);
  }

  commitAspectRatio(): void {
    if (this.ratioCommitTimeout !== null) {
      clearTimeout(this.ratioCommitTimeout);
      this.ratioCommitTimeout = null;
    }
    this.targetAspectRatio.set(this.targetAspectRatioUi());
  }

  handleDownload(): void {
    this.chartRef?.exportImage();
  }

  handleCompact(): void {
    this.chartRef?.runCompaction();
  }
}
