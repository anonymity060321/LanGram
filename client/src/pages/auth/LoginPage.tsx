import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, sendEmailCode } from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getDeviceIdentity } from '../../utils/device';
import { AuthShell } from './AuthShell';

export function LoginPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      const device = await getDeviceIdentity();
      const result = await login({
        email,
        password: password || undefined,
        code: code || undefined,
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
      await sendEmailCode({ email, purpose: 'LOGIN' });
    } catch {
      setError(t('auth.submitFailed'));
    }
  }

  return (
    <AuthShell title={t('auth.loginTitle')}>
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>{t('auth.email')}</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
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
          {t('auth.login')}
        </button>
      </form>
    </AuthShell>
  );
}
