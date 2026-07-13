import { Injectable, signal, computed } from '@angular/core';
import { ChartThemeId, SiteThemeId } from '../models/org.types';

/**
 * Theme provider for both the site (UI) and the chart.
 *
 * Ported from the React `theme.tsx` (two context providers) to a single
 * service holding signals. Site theme is applied to `document.documentElement`
 * via `data-site-theme`; chart theme is held for the chart component to apply
 * on its container via `data-chart-theme`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly SITE_STORAGE_KEY = 'harkje.siteTheme';
  private readonly CHART_STORAGE_KEY = 'harkje.chartTheme';

  readonly siteThemes: ReadonlyArray<{ id: SiteThemeId; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  readonly chartThemes: ReadonlyArray<{ id: ChartThemeId; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'soft', label: 'Soft' },
    { id: 'warm', label: 'Warm' },
    { id: 'pencil', label: 'Pencil' },
    { id: 'classic', label: 'Classic' },
    { id: 'dark', label: 'Dark' },
    { id: 'highContrast', label: 'High Contrast' },
  ];

  private readonly _siteThemeId = signal<SiteThemeId>(this.getInitialSiteTheme());
  private readonly _chartThemeId = signal<ChartThemeId>(this.getInitialChartTheme());

  readonly siteThemeId = this._siteThemeId.asReadonly();
  readonly chartThemeId = this._chartThemeId.asReadonly();

  setSiteThemeId(id: SiteThemeId): void {
    this._siteThemeId.set(id);
    this.applySiteTheme(id);
    try {
      localStorage.setItem(this.SITE_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  setChartThemeId(id: ChartThemeId): void {
    this._chartThemeId.set(id);
    try {
      localStorage.setItem(this.CHART_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  /** Apply the current site theme to the document root. Call once at bootstrap. */
  init(): void {
    this.applySiteTheme(this._siteThemeId());
  }

  private applySiteTheme(id: SiteThemeId): void {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset['siteTheme'] = id;
  }

  private isSiteThemeId(v: unknown): v is SiteThemeId {
    return v === 'light' || v === 'dark';
  }

  private getInitialSiteTheme(): SiteThemeId {
    if (typeof window === 'undefined') return 'light';
    try {
      const saved = localStorage.getItem(this.SITE_STORAGE_KEY);
      if (this.isSiteThemeId(saved)) return saved;
    } catch {
      // ignore
    }
    return this.getSystemSiteTheme();
  }

  private getSystemSiteTheme(): SiteThemeId {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private isChartThemeId(v: unknown): v is ChartThemeId {
    return (
      v === 'light' ||
      v === 'soft' ||
      v === 'warm' ||
      v === 'pencil' ||
      v === 'classic' ||
      v === 'dark' ||
      v === 'highContrast'
    );
  }

  private getInitialChartTheme(): ChartThemeId {
    if (typeof window === 'undefined') return 'light';
    try {
      const saved = localStorage.getItem(this.CHART_STORAGE_KEY);
      if (this.isChartThemeId(saved)) return saved;
    } catch {
      // ignore
    }
    return this.getSystemChartTheme();
  }

  private getSystemChartTheme(): ChartThemeId {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
