import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guestLogin } from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getAuthErrorMessage } from '../../utils/authErrors';
import { getDeviceIdentity } from '../../utils/device';
import { AuthShell } from './AuthShell';

const DISPLAY_NAME_MAX_LENGTH = 32;

export function GuestLoginPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setError(t('auth.nicknameRequired'));
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await guestLogin({ displayName: trimmedDisplayName, device });
      setSession(result);
      navigate('/', { replace: true });
    } catch (error) {
      setError(getAuthErrorMessage(error, t, 'auth.submitFailed'));
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
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
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={isSubmitting || !displayName.trim()}>
          {isSubmitting ? t('auth.entering') : t('auth.guestLogin')}
        </button>
      </form>
    </AuthShell>
  );
}
