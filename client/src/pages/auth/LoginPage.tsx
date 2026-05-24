import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  loginWithEmailCode,
  loginWithPassword,
  requestTextCaptcha,
  sendEmailCode,
  type TextCaptchaResponse,
} from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { getDeviceIdentity } from '../../utils/device';
import { AuthShell } from './AuthShell';

type LoginMode = 'password' | 'emailCode';

export function LoginPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [mode, setMode] = useState<LoginMode>('password');
  const [identifier, setIdentifier] = useState('');
  const [emailCodeEmail, setEmailCodeEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [captcha, setCaptcha] = useState<TextCaptchaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);

  const refreshCaptcha = useCallback(async (): Promise<void> => {
    setIsLoadingCaptcha(true);
    setError(null);

    try {
      const nextCaptcha = await requestTextCaptcha();
      setCaptcha(nextCaptcha);
      setCaptchaAnswer('');
    } catch {
      setError(t('auth.submitFailed'));
    } finally {
      setIsLoadingCaptcha(false);
    }
  }, [t]);

  useEffect(() => {
    if (mode === 'password' && !captcha) {
      void refreshCaptcha();
    }
  }, [captcha, mode, refreshCaptcha]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!captcha) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await loginWithPassword({
        identifier,
        password,
        captchaId: captcha.captchaId,
        captchaAnswer,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch {
      setPassword('');
      setCaptchaAnswer('');
      await refreshCaptcha();
      setError(t('auth.passwordLoginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmailCodeSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await loginWithEmailCode({
        email: emailCodeEmail,
        code: emailCode,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch {
      setError(t('auth.emailLoginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendCode(): Promise<void> {
    if (!emailCodeEmail) {
      return;
    }

    setError(null);
    setIsSendingCode(true);

    try {
      await sendEmailCode({ email: emailCodeEmail, purpose: 'LOGIN' });
    } catch {
      setError(t('auth.submitFailed'));
    } finally {
      setIsSendingCode(false);
    }
  }

  return (
    <AuthShell title={t('auth.loginTitle')} showLoginLink={false}>
      <div className="auth-tabs" role="tablist" aria-label={t('auth.loginTitle')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'password'}
          className={mode === 'password' ? 'is-active' : undefined}
          onClick={() => {
            setMode('password');
            setError(null);
          }}
        >
          {t('auth.passwordLogin')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'emailCode'}
          className={mode === 'emailCode' ? 'is-active' : undefined}
          onClick={() => {
            setMode('emailCode');
            setError(null);
          }}
        >
          {t('auth.emailCodeLogin')}
        </button>
      </div>

      {mode === 'password' ? (
        <form className="form-stack" onSubmit={(event) => void handlePasswordSubmit(event)}>
          <label>
            <span>{t('auth.identifier')}</span>
            <input
              value={identifier}
              autoComplete="username"
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>{getCaptchaTitle(captcha, t)}</span>
            <div className="captcha-box">
              {captcha?.imageDataUrl ? (
                <img className="captcha-image" src={captcha.imageDataUrl} alt={captcha.prompt} />
              ) : (
                <strong>{captcha?.prompt ?? '...'}</strong>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={isLoadingCaptcha}
                onClick={() => void refreshCaptcha()}
              >
                {t('auth.refreshCaptcha')}
              </button>
            </div>
            <input
              value={captchaAnswer}
              inputMode={captcha?.captchaType === 'TEXT' ? 'text' : 'numeric'}
              onChange={(event) => setCaptchaAnswer(event.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting || !captcha || !identifier || !password || !captchaAnswer}
          >
            {t('auth.login')}
          </button>
        </form>
      ) : (
        <form className="form-stack" onSubmit={(event) => void handleEmailCodeSubmit(event)}>
          <label>
            <span>{t('auth.email')}</span>
            <input
              type="email"
              value={emailCodeEmail}
              autoComplete="email"
              onChange={(event) => setEmailCodeEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.code')}</span>
            <div className="inline-control">
              <input
                value={emailCode}
                autoComplete="one-time-code"
                onChange={(event) => setEmailCode(event.target.value)}
                maxLength={6}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={isSendingCode || !emailCodeEmail}
                onClick={() => void handleSendCode()}
              >
                {t('auth.sendEmailCode')}
              </button>
            </div>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting || !emailCodeEmail || !emailCode}
          >
            {t('auth.login')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function getCaptchaTitle(
  captcha: TextCaptchaResponse | null,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (captcha?.captchaType === 'ARITHMETIC') {
    return t('auth.arithmeticCaptcha');
  }

  return t('auth.textCaptcha');
}
