import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { register, registerTemporary, sendEmailCode } from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getDeviceIdentity } from '../../utils/device';
import { AuthShell } from './AuthShell';

export function RegisterPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      const device = await getDeviceIdentity();
      const result = await register({
        email,
        password,
        code,
        displayName: displayName || undefined,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.submitFailed'));
    }
  }

  async function handleSendCode(): Promise<void> {
    if (!email) {
      return;
    }

    try {
      await sendEmailCode({ email, purpose: 'REGISTER' });
    } catch {
      setError(t('auth.submitFailed'));
    }
  }

  async function handleTemporaryRegister(): Promise<void> {
    if (!email || !password || !window.confirm(t('auth.temporaryRegisterConfirm'))) {
      return;
    }

    setError(null);
    try {
      const device = await getDeviceIdentity();
      const result = await registerTemporary({
        email,
        password,
        displayName: displayName || undefined,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.submitFailed'));
    }
  }

  return (
    <AuthShell title={t('auth.registerTitle')}>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>{t('auth.email')}</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          <span>{t('auth.displayName')}</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          <span>{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>{t('auth.code')}</span>
          <div className="inline-control">
            <input value={code} onChange={(event) => setCode(event.target.value)} maxLength={6} />
            <button type="button" className="secondary-button" onClick={() => void handleSendCode()}>
              {t('auth.sendCode')}
            </button>
          </div>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="primary-button">
          {t('auth.register')}
        </button>
        <div className="temporary-register-box">
          <p className="form-hint">{t('auth.temporaryRegisterHint')}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={!email || !password}
            onClick={() => void handleTemporaryRegister()}
          >
            {t('auth.temporaryRegister')}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
