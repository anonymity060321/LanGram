import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { logout as requestLogout } from '../../api/auth.api';
import {
  getDownloadDirectoryStatus,
  resetDownloadDirectory,
  setDownloadDirectory,
  type DownloadDirectoryStatus,
} from '../../api/downloadSettings.api';
import { listLocalFileRecords, type LocalFileRecord } from '../../api/localFiles.api';
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
import { useLocalCacheStore } from '../../stores/localCache.store';
import { updateCloseToTrayRuntime } from '../../utils/localConfig';
import {
  getNotificationRuntimeStatus,
  requestWebNotificationPermission,
  showTestNotification,
  type NotificationRuntimeStatus,
} from '../../utils/desktopNotification';

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
  const [notifications, setNotifications] = useState<NotificationSetting>('enabled');
  const [closeToTray, setCloseToTray] = useState<TrayCloseSetting>('enabled');
  const [displayName, setDisplayName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [notificationStatus, setNotificationStatus] = useState<NotificationRuntimeStatus | null>(null);
  const [notificationPermissionNotice, setNotificationPermissionNotice] = useState<string | null>(null);
  const [downloadDirectoryStatus, setDownloadDirectoryStatus] =
    useState<DownloadDirectoryStatus | null>(null);
  const [downloadDirectoryNotice, setDownloadDirectoryNotice] = useState<LocalCacheNotice | null>(
    null,
  );
  const [isDownloadDirectorySaving, setIsDownloadDirectorySaving] = useState(false);
  const [downloadRecords, setDownloadRecords] = useState<LocalFileRecord[]>([]);
  const [isDownloadRecordsLoading, setIsDownloadRecordsLoading] = useState(false);
  const [downloadRecordsError, setDownloadRecordsError] = useState<string | null>(null);
  const [localCacheNotice, setLocalCacheNotice] = useState<LocalCacheNotice | null>(null);
  const localCacheStatus = useLocalCacheStore((state) => state.status);
  const localCacheInitializationState = useLocalCacheStore((state) => state.initializationState);
  const isLocalCacheInitializing = useLocalCacheStore((state) => state.isInitializing);
  const isLocalCacheRefreshing = useLocalCacheStore((state) => state.isRefreshing);
  const isLocalCacheClearing = useLocalCacheStore((state) => state.isClearing);
  const refreshLocalCacheStatus = useLocalCacheStore((state) => state.refreshStatus);
  const clearLocalCache = useLocalCacheStore((state) => state.clearCache);

  const refreshDownloadRecords = useCallback(async (): Promise<void> => {
    setIsDownloadRecordsLoading(true);
    setDownloadRecordsError(null);

    try {
      const records = await listLocalFileRecords(20);
      setDownloadRecords(records);
    } catch {
      setDownloadRecordsError(t('settings.downloadRecordsLoadFailed'));
    } finally {
      setIsDownloadRecordsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshNotificationStatus();
  }, []);

  useEffect(() => {
    if (activeSection === 'about' || activeSection === 'storage') {
      void refreshLocalCacheStatus().catch(() => {
        setLocalCacheNotice({ kind: 'error', message: t('settings.localCacheReadFailed') });
      });
    }

    if (activeSection === 'storage') {
      void refreshDownloadDirectoryStatus().catch(() => {
        setDownloadDirectoryNotice({
          kind: 'error',
          message: t('settings.downloadDirectoryReadFailed'),
        });
      });
      void refreshDownloadRecords();
    }
  }, [activeSection, refreshDownloadRecords, refreshLocalCacheStatus, t]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setServerUrl(config.serverUrl);
    setTheme(config.theme);
    setLanguage(config.language);
    setNotifications(config.enableNotifications ? 'enabled' : 'disabled');
    setCloseToTray(config.closeToTray ? 'enabled' : 'disabled');
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

  async function handleNotificationsChange(nextNotifications: NotificationSetting): Promise<void> {
    setNotifications(nextNotifications);
    await updateConfig({ enableNotifications: nextNotifications === 'enabled' });
    setSaved(false);
  }

  async function handleCloseToTrayChange(nextCloseToTray: TrayCloseSetting): Promise<void> {
    const enabled = nextCloseToTray === 'enabled';
    setCloseToTray(nextCloseToTray);
    await updateConfig({ closeToTray: enabled });
    await updateCloseToTrayRuntime(enabled);
    setSaved(false);
  }

  async function refreshNotificationStatus(): Promise<void> {
    const status = await getNotificationRuntimeStatus();
    setNotificationStatus(status);
  }

  async function handleRequestNotificationPermission(): Promise<void> {
    setNotificationPermissionNotice(null);
    const status = await requestWebNotificationPermission();
    setNotificationStatus(status);
    if (status.permission === 'denied') {
      setNotificationPermissionNotice(t('settings.notificationPermissionDeniedHint'));
    }
  }

  async function handleTestNotification(): Promise<void> {
    setNotificationPermissionNotice(null);
    const result = await showTestNotification(
      t('settings.notificationTestTitle'),
      t('settings.notificationTestBody'),
    );
    setNotificationStatus({ runtime: result.runtime, permission: result.permission });
    if (result.reason === 'denied') {
      setNotificationPermissionNotice(t('settings.notificationPermissionDeniedHint'));
      return;
    }

    if (result.reason === 'default') {
      setNotificationPermissionNotice(t('settings.notificationPermissionDefaultHint'));
      return;
    }

    if (result.reason === 'unsupported') {
      setNotificationPermissionNotice(t('settings.notificationPermissionUnsupportedHint'));
    }
  }

  async function handleRefreshLocalCacheStatus(): Promise<void> {
    setLocalCacheNotice(null);
    try {
      await refreshLocalCacheStatus();
    } catch {
      setLocalCacheNotice({ kind: 'error', message: t('settings.localCacheReadFailed') });
    }
  }

  async function handleClearLocalCache(): Promise<void> {
    if (!window.confirm(t('settings.localCacheClearConfirm'))) {
      return;
    }

    setLocalCacheNotice(null);
    try {
      await clearLocalCache();
      setLocalCacheNotice({ kind: 'success', message: t('settings.localCacheCleared') });
      await refreshLocalCacheStatus().catch(() => {
        setLocalCacheNotice({ kind: 'error', message: t('settings.localCacheReadFailed') });
      });
    } catch {
      setLocalCacheNotice({ kind: 'error', message: t('settings.localCacheClearFailed') });
    }
  }

  async function refreshDownloadDirectoryStatus(): Promise<void> {
    const status = await getDownloadDirectoryStatus();
    setDownloadDirectoryStatus(status);
  }

  async function handleSelectDownloadDirectory(): Promise<void> {
    setDownloadDirectoryNotice(null);
    setIsDownloadDirectorySaving(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        defaultPath: downloadDirectoryStatus?.effectiveDir,
      });

      if (!selectedPath) {
        setDownloadDirectoryNotice({
          kind: 'success',
          message: t('settings.downloadDirectorySelectCanceled'),
        });
        return;
      }

      const nextPath = Array.isArray(selectedPath) ? selectedPath[0] : selectedPath;
      if (!nextPath) {
        return;
      }

      const status = await setDownloadDirectory(nextPath);
      setDownloadDirectoryStatus(status);
      await load();
      setDownloadDirectoryNotice({ kind: 'success', message: t('settings.downloadDirectorySaved') });
    } catch {
      setDownloadDirectoryNotice({ kind: 'error', message: t('settings.downloadDirectorySelectFailed') });
    } finally {
      setIsDownloadDirectorySaving(false);
    }
  }

  async function handleResetDownloadDirectory(): Promise<void> {
    setDownloadDirectoryNotice(null);
    setIsDownloadDirectorySaving(true);

    try {
      const status = await resetDownloadDirectory();
      setDownloadDirectoryStatus(status);
      await load();
      setDownloadDirectoryNotice({ kind: 'success', message: t('settings.downloadDirectoryReset') });
    } catch {
      setDownloadDirectoryNotice({ kind: 'error', message: t('settings.downloadDirectoryResetFailed') });
    } finally {
      setIsDownloadDirectorySaving(false);
    }
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
              <img src="/logo/logo.svg" alt="" aria-hidden="true" />
              <span className="settings-brand-name">{t('app.name')}</span>
            </span>
            <h1 className="settings-page-title">{t('settings.title')}</h1>
          </div>
          <Link to="/">{t('common.back')}</Link>
        </div>
        <div className="settings-shell">
          <nav className="settings-nav" aria-label={t('settings.sections')}>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                type="button"
                className={`settings-nav-item ${activeSection === section.id ? 'is-active' : ''}`}
                aria-current={activeSection === section.id ? 'page' : undefined}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
              >
                <SettingsNavIcon src={section.iconSrc} fallback={section.fallback} />
                <span>{t(section.labelKey)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-detail">
            {activeSection === 'general' ? (
              <section className="settings-section" aria-labelledby="settings-general-title">
                <h2 id="settings-general-title">{t('settings.generalTitle')}</h2>
                <form className="settings-section-stack" onSubmit={(event) => void handleSubmit(event)}>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.serverUrl')}</strong>
                      <span>{t('settings.serverUrlHint')}</span>
                    </div>
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
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.theme')}</strong>
                      <span>{t('settings.themeHint')}</span>
                    </div>
                    <SettingsSegmentedControl<ThemePreference>
                      value={theme}
                      options={[
                        { value: 'system', label: t('theme.system') },
                        { value: 'light', label: t('theme.light') },
                        { value: 'dark', label: t('theme.dark') },
                      ]}
                      ariaLabel={t('settings.theme')}
                      onChange={handleThemeChange}
                    />
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.language')}</strong>
                      <span>{t('settings.languageHint')}</span>
                    </div>
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
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.notifications')}</strong>
                      <span>{t('settings.notificationsHint')}</span>
                    </div>
                    <SettingsSelect<NotificationSetting>
                      value={notifications}
                      options={[
                        { value: 'enabled', label: t('common.enabled') },
                        { value: 'disabled', label: t('common.disabled') },
                      ]}
                      ariaLabel={t('settings.notifications')}
                      onChange={handleNotificationsChange}
                    />
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.notificationPermission')}</strong>
                      <span>
                        {notificationStatus
                          ? t(getNotificationPermissionLabelKey(notificationStatus.permission))
                          : t('settings.notificationPermissionUnsupported')}
                      </span>
                    </div>
                    <span className="settings-inline-save">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void handleRequestNotificationPermission()}
                      >
                        {t('settings.enableBrowserNotifications')}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void handleTestNotification()}
                      >
                        {t('settings.sendTestNotification')}
                      </button>
                    </span>
                  </div>
                  {notificationPermissionNotice ? <p className="form-error">{notificationPermissionNotice}</p> : null}
                  <div
                    className="settings-choice-card"
                    role="radiogroup"
                    aria-labelledby="settings-close-behavior-title"
                  >
                    <strong className="settings-choice-title" id="settings-close-behavior-title">
                      {t('settings.closeBehaviorTitle')}
                    </strong>
                    <p className="settings-choice-description">{t('settings.closeToTrayHint')}</p>
                    <div className="settings-radio-list">
                      <label
                        className={`settings-radio-option ${closeToTray === 'enabled' ? 'is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="closeBehavior"
                          value="enabled"
                          checked={closeToTray === 'enabled'}
                          onChange={() => void handleCloseToTrayChange('enabled')}
                        />
                        <span>{t('settings.closeToTrayOption')}</span>
                        <span className="settings-recommend-badge">{t('common.recommended')}</span>
                      </label>
                      <label
                        className={`settings-radio-option ${closeToTray === 'disabled' ? 'is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="closeBehavior"
                          value="disabled"
                          checked={closeToTray === 'disabled'}
                          onChange={() => void handleCloseToTrayChange('disabled')}
                        />
                        <span>{t('settings.closeAppOption')}</span>
                      </label>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.deviceId')}</strong>
                      <span>{t('settings.deviceIdHint')}</span>
                    </div>
                    <input value={config?.deviceId ?? ''} readOnly />
                  </div>
                  {saved ? <p className="form-success">{t('settings.saved')}</p> : null}
                </form>
              </section>
            ) : null}

            {activeSection === 'profile' ? (
              <section className="settings-section" aria-labelledby="settings-profile-title">
                <h2 id="settings-profile-title">{t('settings.profileTitle')}</h2>
                <div className="profile-editor-header">
                  <UserAvatar
                    userId={user?.id}
                    displayName={user?.displayName}
                    avatarUrl={user?.avatarUrl}
                    size="lg"
                  />
                  <label className={`avatar-upload-trigger ${isAvatarUploading ? 'is-disabled' : ''}`}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={isAvatarUploading}
                      onChange={(event) => void handleAvatarSelected(event)}
                    />
                    <span>{isAvatarUploading ? t('settings.avatarUploading') : t('settings.avatarChange')}</span>
                  </label>
                </div>
                <form className="settings-section-stack" onSubmit={(event) => void handleProfileSubmit(event)}>
                  <label className="settings-row">
                    <span className="settings-row-text">
                      <strong>{t('settings.displayName')}</strong>
                      <span>{t('settings.displayNameHint')}</span>
                    </span>
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-row-text">
                      <strong>{t('settings.statusMessage')}</strong>
                      <span>{t('settings.statusMessageHint')}</span>
                    </span>
                    <input
                      value={statusMessage}
                      maxLength={160}
                      onChange={(event) => setStatusMessage(event.target.value)}
                    />
                  </label>
                  <div className="settings-actions-row">
                    <button type="submit" className="primary-button" disabled={!displayName.trim()}>
                      {t('settings.saveProfile')}
                    </button>
                    {profileError ? <p className="form-error">{profileError}</p> : null}
                    {profileSaved ? <p className="form-success">{t('settings.profileSaved')}</p> : null}
                  </div>
                </form>
              </section>
            ) : null}

            {activeSection === 'account' ? (
              <section className="settings-section" aria-labelledby="settings-account-title">
                <h2 id="settings-account-title">{t('settings.accountTitle')}</h2>
                <div className="settings-section-stack">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.currentAccount')}</strong>
                      <span>{user?.email ?? t('settings.accountNoEmail')}</span>
                    </div>
                    <span className="settings-account-badge">{user?.accountType ?? '-'}</span>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('auth.logout')}</strong>
                      <span>{t('settings.logoutHint')}</span>
                    </div>
                    <button type="button" className="secondary-button danger-button" onClick={() => void handleLogout()}>
                      {t('auth.logout')}
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.accountSecurity')}</strong>
                      <span>{t('settings.accountSecurityHint')}</span>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === 'storage' ? (
              <section className="settings-section" aria-labelledby="settings-storage-title">
                <h2 id="settings-storage-title">{t('settings.storageTitle')}</h2>
                <div className="settings-section-stack">
                  <h3 className="settings-group-title">{t('settings.storageSaveLocation')}</h3>
                  <div className="settings-storage-card">
                    <div className="settings-storage-main">
                      <div className="settings-row-text">
                        <strong>{t('settings.receivedFilesSaveTo')}</strong>
                        <span
                          className="settings-storage-path"
                          title={downloadDirectoryStatus?.effectiveDir ?? undefined}
                        >
                          {downloadDirectoryStatus?.effectiveDir ?? '-'}
                        </span>
                      </div>
                      <span className="settings-account-badge">
                        {downloadDirectoryStatus?.isDefault
                          ? t('settings.downloadDirectoryDefault')
                          : t('settings.downloadDirectoryCustom')}
                      </span>
                    </div>
                    <div className="settings-storage-actions">
                      <button
                        type="button"
                        className="primary-button compact-button"
                        disabled={isDownloadDirectorySaving}
                        onClick={() => void handleSelectDownloadDirectory()}
                      >
                        {t('settings.changeStoragePath')}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        disabled={isDownloadDirectorySaving}
                        onClick={() => void handleResetDownloadDirectory()}
                      >
                        {t('settings.resetDownloadDirectory')}
                      </button>
                    </div>
                    {downloadDirectoryNotice ? (
                      <p
                        className={
                          downloadDirectoryNotice.kind === 'success' ? 'form-success' : 'form-error'
                        }
                      >
                        {downloadDirectoryNotice.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="settings-storage-card">
                    <div className="settings-storage-main">
                      <div className="settings-row-text">
                        <strong>{t('settings.messageCacheSaveTo')}</strong>
                        <span
                          className="settings-storage-path"
                          title={localCacheStatus?.dbPath ?? undefined}
                        >
                          {localCacheStatus?.dbPath ?? '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <h3 className="settings-group-title">{t('settings.downloadRecords')}</h3>
                  <div className="settings-storage-card settings-download-records-card">
                    <div className="settings-storage-main">
                      <div className="settings-row-text">
                        <strong>{t('settings.downloadRecords')}</strong>
                        <span>
                          {isDownloadRecordsLoading
                            ? t('chat.loading')
                            : downloadRecords.length === 0
                              ? t('settings.downloadRecordsEmptyHint')
                              : `${downloadRecords.length}`}
                        </span>
                      </div>
                    </div>
                    {downloadRecordsError ? (
                      <p className="form-error">{downloadRecordsError}</p>
                    ) : null}
                    {downloadRecords.length === 0 && !isDownloadRecordsLoading ? (
                      <div className="settings-download-records-empty">
                        <strong>{t('settings.downloadRecordsEmpty')}</strong>
                        <span>{t('settings.downloadRecordsEmptyHint')}</span>
                      </div>
                    ) : null}
                    {downloadRecords.length > 0 ? (
                      <ul className="settings-download-record-list">
                        {downloadRecords.map((record) => {
                          const fileName = getDownloadRecordFileName(record);
                          return (
                            <li className="settings-download-record-item" key={record.id}>
                              <div className="settings-download-record-main">
                                <strong title={fileName}>{fileName}</strong>
                                <span title={record.localPath}>{record.localPath}</span>
                              </div>
                              <div className="settings-download-record-meta">
                                <span>{formatFileSize(record.sizeBytes)}</span>
                                <span>{formatDownloadDate(record.downloadedAt ?? record.updatedAt)}</span>
                                <span
                                  className={`settings-download-record-status is-${getDownloadRecordStatusClass(
                                    record.status,
                                  )}`}
                                >
                                  {t(getDownloadRecordStatusLabelKey(record.status))}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === 'about' ? (
              <section className="settings-section" aria-labelledby="settings-about-title">
                <h2 id="settings-about-title">{t('settings.aboutTitle')}</h2>
                <div className="settings-section-stack">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('app.name')}</strong>
                      <span>{t('settings.aboutDescription')}</span>
                    </div>
                    <span className="settings-account-badge">v0.1.0</span>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <strong>{t('settings.localData')}</strong>
                      <span>{t('settings.localDataHint')}</span>
                    </div>
                  </div>
                  <div className="settings-local-cache-card">
                    <div className="settings-local-cache-header">
                      <div className="settings-row-text">
                        <strong>{t('settings.localCache')}</strong>
                        <span>
                          {t('settings.localCacheStatus')}:{' '}
                          {t(
                            getLocalCacheStatusLabelKey(
                              localCacheInitializationState,
                              localCacheStatus?.exists ?? false,
                            ),
                          )}
                        </span>
                      </div>
                      <div className="settings-local-cache-actions">
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          disabled={
                            isLocalCacheInitializing ||
                            isLocalCacheRefreshing ||
                            isLocalCacheClearing
                          }
                          onClick={() => void handleRefreshLocalCacheStatus()}
                        >
                          {t('settings.localCacheRefresh')}
                        </button>
                        <button
                          type="button"
                          className="secondary-button compact-button danger-button"
                          disabled={
                            isLocalCacheInitializing ||
                            isLocalCacheRefreshing ||
                            isLocalCacheClearing
                          }
                          onClick={() => void handleClearLocalCache()}
                        >
                          {t('settings.localCacheClear')}
                        </button>
                      </div>
                    </div>
                    <dl className="settings-local-cache-details">
                      <div>
                        <dt>{t('settings.localCacheSchemaVersion')}</dt>
                        <dd>{localCacheStatus?.schemaVersion ?? '-'}</dd>
                      </div>
                      <div>
                        <dt>{t('settings.localCacheDbPath')}</dt>
                        <dd
                          className="settings-local-cache-path"
                          title={localCacheStatus?.dbPath ?? undefined}
                        >
                          {localCacheStatus?.dbPath ?? '-'}
                        </dd>
                      </div>
                    </dl>
                    {localCacheInitializationState === 'failed' ? (
                      <p className="form-error">{t('settings.localCacheInitFailed')}</p>
                    ) : null}
                    {localCacheNotice ? (
                      <p
                        className={
                          localCacheNotice.kind === 'success' ? 'form-success' : 'form-error'
                        }
                      >
                        {localCacheNotice.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingsNavIcon({ src, fallback }: { src: string | null; fallback: string }): JSX.Element {
  if (!src) {
    return <span className="settings-nav-icon-fallback">{fallback}</span>;
  }

  return (
    <span className="settings-nav-icon">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
          event.currentTarget.parentElement?.setAttribute('data-icon-missing', 'true');
        }}
      />
      <span className="settings-nav-icon-fallback">{fallback}</span>
    </span>
  );
}

function SettingsSegmentedControl<TValue extends string>({
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
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, optionIndex: number): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (optionIndex + direction + options.length) % options.length;
    const nextValue = options[nextIndex]?.value;
    if (nextValue && nextValue !== value) {
      void onChange(nextValue);
    }
  }

  return (
    <div className="settings-segmented-control" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`settings-segmented-option ${option.value === value ? 'is-selected' : ''}`}
          key={option.value}
          onClick={() => {
            if (option.value !== value) {
              void onChange(option.value);
            }
          }}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
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

type SettingsSection = 'general' | 'profile' | 'account' | 'storage' | 'about';
type NotificationSetting = 'enabled' | 'disabled';
type TrayCloseSetting = 'enabled' | 'disabled';
type TranslationKey = Parameters<ReturnType<typeof useI18n>['t']>[0];
type LocalCacheNotice = {
  kind: 'success' | 'error';
  message: string;
};

function getDownloadRecordFileName(record: LocalFileRecord): string {
  return record.originalName.trim() || record.safeName.trim() || '-';
}

function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDownloadDate(value: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getDownloadRecordStatusLabelKey(status: string): TranslationKey {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === 'completed') {
    return 'settings.downloadRecordStatusCompleted';
  }

  if (normalizedStatus === 'failed') {
    return 'settings.downloadRecordStatusFailed';
  }

  if (normalizedStatus === 'missing') {
    return 'settings.downloadRecordStatusMissing';
  }

  return 'settings.downloadRecordStatusUnknown';
}

function getDownloadRecordStatusClass(status: string): string {
  const normalizedStatus = status.trim().toLowerCase();
  if (
    normalizedStatus === 'completed' ||
    normalizedStatus === 'failed' ||
    normalizedStatus === 'missing'
  ) {
    return normalizedStatus;
  }

  return 'unknown';
}

function getNotificationPermissionLabelKey(
  permission: NotificationRuntimeStatus['permission'],
): TranslationKey {
  if (permission === 'granted') {
    return 'settings.notificationPermissionGranted';
  }

  if (permission === 'denied') {
    return 'settings.notificationPermissionDenied';
  }

  if (permission === 'default') {
    return 'settings.notificationPermissionDefault';
  }

  return 'settings.notificationPermissionUnsupported';
}

function getLocalCacheStatusLabelKey(
  initializationState: 'idle' | 'initialized' | 'failed',
  exists: boolean,
): TranslationKey {
  if (initializationState === 'failed') {
    return 'settings.localCacheInitFailed';
  }

  return exists ? 'settings.localCacheInitialized' : 'settings.localCacheNotInitialized';
}

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  labelKey: TranslationKey;
  iconSrc: string | null;
  fallback: string;
}> = [
  {
    id: 'general',
    labelKey: 'settings.generalTitle',
    iconSrc: '/vector_icon/sliders-horizontal.svg',
    fallback: 'G',
  },
  {
    id: 'profile',
    labelKey: 'settings.profileTitle',
    iconSrc: '/vector_icon/id-card.svg',
    fallback: 'P',
  },
  {
    id: 'account',
    labelKey: 'settings.accountTitle',
    iconSrc: '/vector_icon/user-key.svg',
    fallback: 'A',
  },
  {
    id: 'storage',
    labelKey: 'settings.storage',
    iconSrc: '/vector_icon/hard-drive.svg',
    fallback: 'S',
  },
  {
    id: 'about',
    labelKey: 'settings.aboutTitle',
    iconSrc: '/vector_icon/info.svg',
    fallback: 'I',
  },
];
