import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLogo } from '../../components/AppLogo';
import { useI18n } from '../../i18n';
import { useNetworkStore, type NetworkStatus } from '../../stores/network.store';
import { probeServerHealth } from '../../utils/serverHealth';

interface AuthShellProps {
  title: string;
  children: React.ReactNode;
  showLoginLink?: boolean;
  showRegisterLink?: boolean;
  showGuestLink?: boolean;
  loginLinkLabel?: string;
  registerLinkLabel?: string;
}

export function AuthShell({
  title,
  children,
  showLoginLink = true,
  showRegisterLink = true,
  showGuestLink = true,
  loginLinkLabel,
  registerLinkLabel,
}: AuthShellProps): JSX.Element {
  const { t } = useI18n();
  const networkStatus = useNetworkStore((state) => state.status);
  const setNetworkStatus = useNetworkStore((state) => state.setStatus);
  const [reconnectedNoticeVisible, setReconnectedNoticeVisible] = useState(false);
  const hasSeenOnlineRef = useRef(false);
  const previousNetworkStatusRef = useRef<NetworkStatus>(networkStatus);

  useEffect(() => {
    let isCancelled = false;
    let abortController: AbortController | null = null;

    async function checkServer(): Promise<void> {
      if (useNetworkStore.getState().status === 'disconnected') {
        setNetworkStatus('connecting');
      }

      abortController?.abort();
      abortController = new AbortController();
      const isReachable = await probeServerHealth(abortController.signal);

      if (isCancelled) {
        return;
      }

      setNetworkStatus(isReachable ? 'online' : 'reconnecting');
    }

    void checkServer();

    return () => {
      isCancelled = true;
      abortController?.abort();
    };
  }, [setNetworkStatus]);

  useEffect(() => {
    if (networkStatus === 'online') {
      return undefined;
    }

    let isCancelled = false;
    let abortController: AbortController | null = null;

    function checkServer(): void {
      abortController?.abort();
      abortController = new AbortController();
      void probeServerHealth(abortController.signal).then((isReachable) => {
        if (isCancelled) {
          return;
        }

        setNetworkStatus(isReachable ? 'online' : 'reconnecting');
      });
    }

    const timeoutId = window.setTimeout(checkServer, 300);
    const intervalId = window.setInterval(checkServer, 4000);

    return () => {
      isCancelled = true;
      abortController?.abort();
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [networkStatus, setNetworkStatus]);

  useEffect(() => {
    const previousStatus = previousNetworkStatusRef.current;
    previousNetworkStatusRef.current = networkStatus;

    if (networkStatus === 'online') {
      if (hasSeenOnlineRef.current && previousStatus !== 'online') {
        setReconnectedNoticeVisible(true);
      }
      hasSeenOnlineRef.current = true;
    }
  }, [networkStatus]);

  useEffect(() => {
    if (!reconnectedNoticeVisible) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setReconnectedNoticeVisible(false), 2000);
    return () => window.clearTimeout(timerId);
  }, [reconnectedNoticeVisible]);

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-mark">
          <AppLogo label={t('app.name')} />
        </div>
        <h1>{title}</h1>
        <AuthNetworkStatusBanner
          status={networkStatus}
          showReconnected={reconnectedNoticeVisible}
          t={t}
        />
        {children}
        <nav className="auth-links" aria-label="Auth navigation">
          {showLoginLink ? <Link to="/auth/login">{loginLinkLabel ?? t('auth.toLogin')}</Link> : null}
          {showRegisterLink ? (
            <Link to="/auth/register">{registerLinkLabel ?? t('auth.toRegister')}</Link>
          ) : null}
          {showGuestLink ? <Link to="/auth/guest">{t('auth.toGuest')}</Link> : null}
        </nav>
      </section>
    </main>
  );
}

function AuthNetworkStatusBanner({
  status,
  showReconnected,
  t,
}: {
  status: NetworkStatus;
  showReconnected: boolean;
  t: ReturnType<typeof useI18n>['t'];
}): JSX.Element | null {
  if (showReconnected) {
    return (
      <div className="auth-network-status is-online" role="status">
        {t('network.reconnected')}
      </div>
    );
  }

  if (status === 'online' || status === 'connecting') {
    return null;
  }

  const label = status === 'failed' ? t('network.reconnectFailed') : t('network.reconnecting');

  return (
    <div className={`auth-network-status is-${status}`} role="status">
      {label}
    </div>
  );
}
