import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import enUS from './en-US.json';
import zhCN from './zh-CN.json';
import { useSettingsStore, type LanguagePreference } from '../stores/settings.store';

type MessageKey = keyof typeof zhCN;
type Locale = 'zh-CN' | 'en-US';
type Messages = Record<MessageKey, string>;

const messages: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

interface I18nContextValue {
  locale: Locale;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-CN',
  t: (key) => messages['zh-CN'][key],
});

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const config = useSettingsStore((state) => state.config);
  const loadSettings = useSettingsStore((state) => state.load);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setLocale(resolveLocale(config?.language ?? 'system'));
  }, [config?.language]);

  const t = useCallback((key: MessageKey) => messages[locale][key], [locale]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

function resolveLocale(language: LanguagePreference): Locale {
  if (language === 'zh-CN' || language === 'en-US') {
    return language;
  }

  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}
