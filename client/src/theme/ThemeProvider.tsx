import { useEffect } from 'react';
import { useSettingsStore, type ThemePreference } from '../stores/settings.store';

type AppliedTheme = 'light' | 'dark';

export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const config = useSettingsStore((state) => state.config);
  const loadSettings = useSettingsStore((state) => state.load);
  const theme = config?.theme ?? 'system';

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (theme !== 'system') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      setAppliedTheme(resolveTheme('system'));
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  return <>{children}</>;
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset.themePreference = theme;
  setAppliedTheme(resolveTheme(theme));
}

function setAppliedTheme(theme: AppliedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function resolveTheme(theme: ThemePreference): AppliedTheme {
  if (theme === 'dark' || theme === 'light') {
    return theme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
