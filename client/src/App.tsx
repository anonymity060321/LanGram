import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSessionRevokedHandler } from './api/http';
import { AppRoutes } from './routes';
import { useI18n } from './i18n';
import { useAuthStore } from './stores/auth.store';
import { useChatStore } from './stores/chat.store';

export function App(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isSessionReplaced = useAuthStore((state) => state.isSessionReplaced);
  const notifySessionReplaced = useAuthStore((state) => state.notifySessionReplaced);
  const acknowledgeSessionReplaced = useAuthStore((state) => state.acknowledgeSessionReplaced);
  const clearSession = useAuthStore((state) => state.clearSession);
  const disconnect = useChatStore((state) => state.disconnect);

  useEffect(() => {
    function preventNativeContextMenu(event: MouseEvent): void {
      event.preventDefault();
    }

    document.addEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    };
  }, []);

  useEffect(() => {
    setSessionRevokedHandler(() => notifySessionReplaced());
    return () => setSessionRevokedHandler(null);
  }, [notifySessionReplaced]);

  function handleConfirmSessionReplaced(): void {
    acknowledgeSessionReplaced();
    disconnect();
    clearSession();
    navigate('/auth/login', { replace: true });
  }

  return (
    <>
      <AppRoutes />
      {isSessionReplaced ? (
        <div className="session-replaced-backdrop" role="presentation">
          <section
            className="session-replaced-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="session-replaced-title"
            aria-describedby="session-replaced-message"
          >
            <h2 id="session-replaced-title">{t('auth.sessionReplacedTitle')}</h2>
            <p id="session-replaced-message">{t('auth.sessionReplacedMessage')}</p>
            <div className="session-replaced-actions">
              <button type="button" className="primary-button" onClick={handleConfirmSessionReplaced}>
                {t('common.confirm')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
