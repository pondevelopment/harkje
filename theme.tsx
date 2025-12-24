import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * Chart-only theme.
 *
 * This deliberately does NOT modify the document root (no html[data-theme]).
 * The chart applies the theme by setting `data-chart-theme="..."` on the
 * chart container element.
 */

export type ChartThemeId = 'light' | 'dark' | 'highContrast';

export const CHART_THEMES: Array<{ id: ChartThemeId; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'highContrast', label: 'High Contrast' },
];

const STORAGE_KEY = 'harkje.chartTheme';

const isChartThemeId = (value: unknown): value is ChartThemeId => {
  return value === 'light' || value === 'dark' || value === 'highContrast';
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
