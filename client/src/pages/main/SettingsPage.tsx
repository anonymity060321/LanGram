import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout as requestLogout } from '../../api/auth.api';
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  uploadCurrentUserAvatar,
} from '../../api/users.api';
import { AppLogo } from '../../components/AppLogo';
import { UserAvatar } from '../../components/UserAvatar';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useChatStore } from '../../stores/chat.store';
import {
  useSettingsStore,
  type LanguagePreference,
  type ThemePreference,
} from '../../stores/settings.store';

export function SettingsPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const config = useSettingsStore((state) => state.config);
  const load = useSettingsStore((state) => state.load);
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const clearSession = useAuthStore((state) => state.clearSession);
  const disconnect = useChatStore((state) => state.disconnect);
  const [serverUrl, setServerUrl] = useState('');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [language, setLanguage] = useState<LanguagePreference>('system');
  const [displayName, setDisplayName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);

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

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setStatusMessage(user?.statusMessage ?? '');
  }, [user?.displayName, user?.statusMessage]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    void getCurrentUserProfile()
      .then((profile) => {
        updateUser(profile);
        setDisplayName(profile.displayName);
        setStatusMessage(profile.statusMessage ?? '');
      })
      .catch(() => undefined);
  }, [updateUser, user?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await updateConfig({ serverUrl, theme, language });
    setSaved(true);
  }

  async function handleThemeChange(nextTheme: ThemePreference): Promise<void> {
    setTheme(nextTheme);
    await updateConfig({ theme: nextTheme });
    setSaved(false);
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setProfileError(null);
    setProfileSaved(false);
    try {
      const profile = await updateCurrentUserProfile({
        displayName,
        statusMessage,
      });
      updateUser(profile);
      setProfileSaved(true);
    } catch {
      setProfileError(t('settings.profileSaveFailed'));
    }
  }

  async function handleAvatarSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) {
      return;
    }

    setProfileError(null);
    setProfileSaved(false);
    setIsAvatarUploading(true);
    try {
      const profile = await uploadCurrentUserAvatar(file);
      updateUser(profile);
      setDisplayName(profile.displayName);
      setStatusMessage(profile.statusMessage ?? '');
      setProfileSaved(true);
    } catch {
      setProfileError(t('settings.avatarUploadFailed'));
    } finally {
      setIsAvatarUploading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    if (!window.confirm(t('auth.logoutConfirm'))) {
      return;
    }

    try {
      await requestLogout();
    } catch {
      // Keep logout usable when the server cannot be reached.
    } finally {
      disconnect();
      clearSession();
      navigate('/auth/login', { replace: true });
    }
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
              onChange={(event) => void handleThemeChange(event.target.value as ThemePreference)}
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
        <section className="profile-editor">
          <h2>{t('settings.profileTitle')}</h2>
          <div className="profile-editor-header">
            <UserAvatar
              userId={user?.id}
              displayName={user?.displayName}
              avatarUrl={user?.avatarUrl}
              size="lg"
            />
            <label className={`file-upload-button ${isAvatarUploading ? 'is-disabled' : ''}`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={isAvatarUploading}
                onChange={(event) => void handleAvatarSelected(event)}
              />
              <span>{isAvatarUploading ? t('settings.avatarUploading') : t('settings.avatarUpload')}</span>
            </label>
          </div>
          <form className="form-stack" onSubmit={(event) => void handleProfileSubmit(event)}>
            <label>
              <span>{t('settings.displayName')}</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              <span>{t('settings.statusMessage')}</span>
              <input
                value={statusMessage}
                maxLength={160}
                onChange={(event) => setStatusMessage(event.target.value)}
              />
            </label>
            <button type="submit" className="primary-button" disabled={!displayName.trim()}>
              {t('settings.saveProfile')}
            </button>
            {profileError ? <p className="form-error">{profileError}</p> : null}
            {profileSaved ? <p className="form-success">{t('settings.profileSaved')}</p> : null}
          </form>
        </section>
        <section className="profile-editor">
          <h2>{t('settings.accountTitle')}</h2>
          <button type="button" className="secondary-button danger-button" onClick={() => void handleLogout()}>
            {t('auth.logout')}
          </button>
        </section>
      </section>
    </main>
  );
}
