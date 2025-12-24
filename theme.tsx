import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Site (UI) theme.
 *
 * This affects the app UI (sidebar, toolbar) by setting `html[data-site-theme]`.
 * The org chart has its own separate chart theme.
 */

export type SiteThemeId = 'light' | 'dark';

export const SITE_THEMES: Array<{ id: SiteThemeId; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const SITE_STORAGE_KEY = 'harkje.siteTheme';

const isSiteThemeId = (value: unknown): value is SiteThemeId => {
  return value === 'light' || value === 'dark';
};

const getSystemSiteTheme = (): SiteThemeId => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getInitialSiteTheme = (): SiteThemeId => {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(SITE_STORAGE_KEY);
    if (isSiteThemeId(saved)) return saved;
  } catch {
    // ignore
  }
  return getSystemSiteTheme();
};

export const applySiteTheme = (themeId: SiteThemeId) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.siteTheme = themeId;
};

type SiteThemeContextValue = {
  siteThemeId: SiteThemeId;
  setSiteThemeId: (next: SiteThemeId) => void;
};

const SiteThemeContext = createContext<SiteThemeContextValue | null>(null);

export const SiteThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [siteThemeId, setSiteThemeIdState] = useState<SiteThemeId>(() => getInitialSiteTheme());

  useEffect(() => {
    applySiteTheme(siteThemeId);
    try {
      window.localStorage.setItem(SITE_STORAGE_KEY, siteThemeId);
    } catch {
      // ignore
    }
  }, [siteThemeId]);

  const value = useMemo<SiteThemeContextValue>(
    () => ({ siteThemeId, setSiteThemeId: setSiteThemeIdState }),
    [siteThemeId]
  );

  return <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>;
};

export const useSiteTheme = (): SiteThemeContextValue => {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) {
    throw new Error('useSiteTheme must be used within SiteThemeProvider');
  }
  return ctx;
};

/**
 * Chart-only theme.
 *
 * This deliberately does NOT modify the document root (no html[data-theme]).
 * The chart applies the theme by setting `data-chart-theme="..."` on the
 * chart container element.
 */

export type ChartThemeId = 'light' | 'soft' | 'warm' | 'classic' | 'dark' | 'highContrast';

export const CHART_THEMES: Array<{ id: ChartThemeId; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'soft', label: 'Soft' },
  { id: 'warm', label: 'Warm' },
  { id: 'classic', label: 'Classic' },
  { id: 'dark', label: 'Dark' },
  { id: 'highContrast', label: 'High Contrast' },
];

const STORAGE_KEY = 'harkje.chartTheme';

const isChartThemeId = (value: unknown): value is ChartThemeId => {
  return value === 'light' || value === 'soft' || value === 'warm' || value === 'classic' || value === 'dark' || value === 'highContrast';
};

const getSystemTheme = (): ChartThemeId => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getInitialChartTheme = (): ChartThemeId => {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isChartThemeId(saved)) return saved;
  } catch {
    // ignore
  }
  return getSystemTheme();
};

type ChartThemeContextValue = {
  chartThemeId: ChartThemeId;
  setChartThemeId: (next: ChartThemeId) => void;
};

const ChartThemeContext = createContext<ChartThemeContextValue | null>(null);

export const ChartThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [chartThemeId, setChartThemeIdState] = useState<ChartThemeId>(() => getInitialChartTheme());

  const setChartThemeId = (next: ChartThemeId) => {
    setChartThemeIdState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const value = useMemo<ChartThemeContextValue>(
    () => ({ chartThemeId, setChartThemeId }),
    [chartThemeId]
  );

  return <ChartThemeContext.Provider value={value}>{children}</ChartThemeContext.Provider>;
};

export const useChartTheme = (): ChartThemeContextValue => {
  const ctx = useContext(ChartThemeContext);
  if (!ctx) {
    throw new Error('useChartTheme must be used within ChartThemeProvider');
  }
  return ctx;
};
