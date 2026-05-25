import { ChangeEvent, FormEvent, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout as requestLogout } from '../../api/auth.api';
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  uploadCurrentUserAvatar,
} from '../../api/users.api';
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
    await updateConfig({ serverUrl });
    setSaved(true);
  }

  async function handleThemeChange(nextTheme: ThemePreference): Promise<void> {
    setTheme(nextTheme);
    await updateConfig({ theme: nextTheme });
    setSaved(false);
  }

  async function handleLanguageChange(nextLanguage: LanguagePreference): Promise<void> {
    setLanguage(nextLanguage);
    await updateConfig({ language: nextLanguage });
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
            <span className="settings-brand">
              <img src="/logo.svg" alt="" aria-hidden="true" />
              <span className="settings-brand-name">{t('app.name')}</span>
            </span>
            <h1 className="settings-page-title">{t('settings.title')}</h1>
          </div>
          <Link to="/">{t('common.back')}</Link>
        </div>
        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>{t('settings.serverUrl')}</span>
            <span className="settings-inline-save">
              <input
                value={serverUrl}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  setSaved(false);
                }}
              />
              <button type="submit" className="secondary-button compact-button">
                {t('settings.saveServerUrl')}
              </button>
            </span>
          </label>
          <label>
            <span>{t('settings.theme')}</span>
            <SettingsSelect<ThemePreference>
              value={theme}
              options={[
                { value: 'system', label: t('theme.system') },
                { value: 'light', label: t('theme.light') },
                { value: 'dark', label: t('theme.dark') },
              ]}
              ariaLabel={t('settings.theme')}
              onChange={handleThemeChange}
            />
          </label>
          <label>
            <span>{t('settings.language')}</span>
            <SettingsSelect<LanguagePreference>
              value={language}
              options={[
                { value: 'system', label: t('language.system') },
                { value: 'zh-CN', label: t('language.zh-CN') },
                { value: 'en-US', label: t('language.en-US') },
              ]}
              ariaLabel={t('settings.language')}
              onChange={handleLanguageChange}
            />
          </label>
          <label>
            <span>{t('settings.deviceId')}</span>
            <input value={config?.deviceId ?? ''} readOnly />
          </label>
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

function SettingsSelect<TValue extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  ariaLabel: string;
  onChange: (value: TValue) => Promise<void>;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  function handleSelect(nextValue: TValue): void {
    setIsOpen(false);
    if (nextValue !== value) {
      void onChange(nextValue);
    }
  }

  return (
    <div className="settings-select-control" ref={rootRef}>
      <button
        type="button"
        className="settings-select-button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
      >
        <span>{selectedOption.label}</span>
        <span className="settings-select-arrow" aria-hidden="true" />
      </button>
      <div className={`settings-select-menu ${isOpen ? 'is-open' : ''}`} role="listbox" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            type="button"
            className={`settings-select-option ${option.value === value ? 'is-selected' : ''}`}
            role="option"
            aria-selected={option.value === value}
            key={option.value}
            onClick={() => handleSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
