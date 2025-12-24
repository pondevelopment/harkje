import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeId = 'light' | 'dark' | 'highContrast';

export const THEMES: Array<{ id: ThemeId; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'highContrast', label: 'High Contrast' },
];

const STORAGE_KEY = 'harkje.theme';

const isThemeId = (value: unknown): value is ThemeId => {
  return value === 'light' || value === 'dark' || value === 'highContrast';
};

const getSystemTheme = (): ThemeId => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getInitialTheme = (): ThemeId => {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeId(saved)) return saved;
  } catch {
    // ignore
  }
  return getSystemTheme();
};

export const applyTheme = (themeId: ThemeId) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = themeId;
};

type ThemeContextValue = {
  themeId: ThemeId;
  setThemeId: (next: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [themeId, setThemeId] = useState<ThemeId>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(themeId);
    try {
      window.localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      // ignore
    }
  }, [themeId]);

  const value = useMemo<ThemeContextValue>(() => ({ themeId, setThemeId }), [themeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
};
