import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guestLogin } from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getDeviceIdentity } from '../../utils/device';
import { AuthShell } from './AuthShell';

const DISPLAY_NAME_MAX_LENGTH = 80;

export function GuestLoginPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      const device = await getDeviceIdentity();
      const result = await guestLogin({ displayName: displayName || undefined, device });
      setSession(result);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.submitFailed'));
    }
  }

  return (
    <AuthShell
      title={t('auth.guestTitle')}
      showGuestLink={false}
      loginLinkLabel={t('auth.toLoginPrompt')}
      registerLinkLabel={t('auth.toRegisterPrompt')}
    >
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>{t('auth.displayName')}</span>
          <input
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary-button">
          {t('auth.guestLogin')}
        </button>
      </form>
    </AuthShell>
  );
}
