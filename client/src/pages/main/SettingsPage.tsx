import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLogo } from '../../components/AppLogo';
import { useI18n } from '../../i18n';
import {
  useSettingsStore,
  type LanguagePreference,
  type ThemePreference,
} from '../../stores/settings.store';

export function SettingsPage(): JSX.Element {
  const { t } = useI18n();
  const config = useSettingsStore((state) => state.config);
  const load = useSettingsStore((state) => state.load);
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [serverUrl, setServerUrl] = useState('');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [language, setLanguage] = useState<LanguagePreference>('system');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setServerUrl(config.serverUrl);
    setTheme(config.theme);
    setLanguage(config.language);
  }, [config]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await updateConfig({ serverUrl, theme, language });
    setSaved(true);
  }

  return (
    <main className="settings-page">
      <section className="settings-panel">
        <div className="settings-header">
          <div className="settings-title">
            <AppLogo label={t('app.name')} size="sm" />
            <h1>{t('settings.title')}</h1>
          </div>
          <Link to="/">{t('common.back')}</Link>
        </div>
        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>{t('settings.serverUrl')}</span>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
          </label>
          <label>
            <span>{t('settings.theme')}</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemePreference)}
            >
              <option value="system">{t('theme.system')}</option>
              <option value="light">{t('theme.light')}</option>
              <option value="dark">{t('theme.dark')}</option>
            </select>
          </label>
          <label>
            <span>{t('settings.language')}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguagePreference)}
            >
              <option value="system">{t('language.system')}</option>
              <option value="zh-CN">{t('language.zh-CN')}</option>
              <option value="en-US">{t('language.en-US')}</option>
            </select>
          </label>
          <label>
            <span>{t('settings.deviceId')}</span>
            <input value={config?.deviceId ?? ''} readOnly />
          </label>
          <button type="submit" className="primary-button">
            {t('settings.save')}
          </button>
          {saved ? <p className="form-success">{t('settings.saved')}</p> : null}
        </form>
      </section>
    </main>
  );
}
