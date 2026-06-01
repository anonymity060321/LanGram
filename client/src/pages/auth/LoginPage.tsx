import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  loginWithEmailCode,
  loginWithPassword,
  requestTextCaptcha,
  requestPasswordResetCode,
  resetPassword,
  sendEmailCode,
  type TextCaptchaResponse,
} from '../../api/auth.api';
import { useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth.store';
import { useNetworkStore } from '../../stores/network.store';
import { getDeviceIdentity } from '../../utils/device';
import { reportAuthNetworkError } from '../../utils/serverHealth';
import { AuthShell } from './AuthShell';

type LoginMode = 'password' | 'emailCode' | 'forgotPassword';

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_CODE_MAX_LENGTH = 6;
const CAPTCHA_ANSWER_MAX_LENGTH = 6;
const CAPTCHA_AUTO_REFRESH_MS = 30_000;
const CAPTCHA_AUTO_REFRESH_SECONDS = CAPTCHA_AUTO_REFRESH_MS / 1000;

export function LoginPage(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const networkStatus = useNetworkStore((state) => state.status);
  const [mode, setMode] = useState<LoginMode>('password');
  const [identifier, setIdentifier] = useState('');
  const [emailCodeEmail, setEmailCodeEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [captcha, setCaptcha] = useState<TextCaptchaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);
  const [captchaRefreshSeconds, setCaptchaRefreshSeconds] = useState(CAPTCHA_AUTO_REFRESH_SECONDS);
  const submitInFlightRef = useRef(false);
  const sendCodeInFlightRef = useRef(false);
  const captchaRefreshInFlightRef = useRef(false);
  const shouldRefreshCaptchaAfterReconnectRef = useRef(false);

  const refreshCaptcha = useCallback(async (): Promise<void> => {
    if (captchaRefreshInFlightRef.current) {
      return;
    }

    captchaRefreshInFlightRef.current = true;
    setCaptchaRefreshSeconds(CAPTCHA_AUTO_REFRESH_SECONDS);
    setIsLoadingCaptcha(true);
    setError(null);
    setNotice(null);

    try {
      const nextCaptcha = await requestTextCaptcha();
      setCaptcha(nextCaptcha);
      setCaptchaAnswer('');
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.submitFailed'));
    } finally {
      captchaRefreshInFlightRef.current = false;
      setIsLoadingCaptcha(false);
    }
  }, [t]);

  useEffect(() => {
    if (mode === 'password' && !captcha) {
      void refreshCaptcha();
    }
  }, [captcha, mode, refreshCaptcha]);

  useEffect(() => {
    if (mode !== 'password' || !captcha) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setCaptchaRefreshSeconds((currentSeconds) => {
        if (currentSeconds <= 1) {
          void refreshCaptcha();
          return CAPTCHA_AUTO_REFRESH_SECONDS;
        }

        return currentSeconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [captcha, mode, refreshCaptcha]);

  useEffect(() => {
    if (networkStatus === 'reconnecting' || networkStatus === 'failed') {
      shouldRefreshCaptchaAfterReconnectRef.current = true;
      return;
    }

    if (networkStatus !== 'online' || !shouldRefreshCaptchaAfterReconnectRef.current) {
      return;
    }

    shouldRefreshCaptchaAfterReconnectRef.current = false;
    if (mode === 'password') {
      void refreshCaptcha();
    }
  }, [mode, networkStatus, refreshCaptcha]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedIdentifier = identifier.trim();
    const trimmedCaptchaAnswer = captchaAnswer.trim();
    if (!captcha || !trimmedIdentifier || !password || !trimmedCaptchaAnswer || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await loginWithPassword({
        identifier: trimmedIdentifier,
        password,
        captchaId: captcha.captchaId,
        captchaAnswer: trimmedCaptchaAnswer,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setPassword('');
      setCaptchaAnswer('');
      await refreshCaptcha();
      setError(t('auth.passwordLoginFailed'));
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleEmailCodeSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedEmail = emailCodeEmail.trim();
    const trimmedCode = emailCode.trim();
    if (!trimmedEmail || !trimmedCode || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const device = await getDeviceIdentity();
      const result = await loginWithEmailCode({
        email: trimmedEmail,
        code: trimmedCode,
        device,
      });
      setSession(result);
      navigate('/', { replace: true });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.emailLoginFailed'));
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleSendCode(): Promise<void> {
    const trimmedEmail = emailCodeEmail.trim();
    if (!trimmedEmail || sendCodeInFlightRef.current) {
      return;
    }

    sendCodeInFlightRef.current = true;
    setError(null);
    setNotice(null);
    setIsSendingCode(true);

    try {
      await sendEmailCode({ email: trimmedEmail, purpose: 'LOGIN' });
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.submitFailed'));
    } finally {
      sendCodeInFlightRef.current = false;
      setIsSendingCode(false);
    }
  }

  async function handleSendPasswordResetCode(): Promise<void> {
    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail || sendCodeInFlightRef.current) {
      return;
    }

    sendCodeInFlightRef.current = true;
    setError(null);
    setNotice(null);
    setIsSendingCode(true);

    try {
      await requestPasswordResetCode({ email: trimmedEmail });
      setNotice(t('auth.passwordResetCodeSent'));
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setNotice(t('auth.passwordResetCodeSent'));
    } finally {
      sendCodeInFlightRef.current = false;
      setIsSendingCode(false);
    }
  }

  async function handlePasswordResetSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedEmail = resetEmail.trim();
    const trimmedCode = resetCode.trim();
    if (
      !trimmedEmail ||
      !trimmedCode ||
      !resetPasswordValue ||
      !resetPasswordConfirm ||
      submitInFlightRef.current
    ) {
      return;
    }

    setError(null);
    setNotice(null);

    if (resetPasswordValue !== resetPasswordConfirm) {
      setError(t('auth.passwordResetMismatch'));
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      await resetPassword({
        email: trimmedEmail,
        code: trimmedCode,
        newPassword: resetPasswordValue,
      });
      setResetCode('');
      setResetPasswordValue('');
      setResetPasswordConfirm('');
      setMode('password');
      setNotice(t('auth.passwordResetSuccess'));
    } catch (error) {
      if (reportAuthNetworkError(error)) {
        return;
      }
      setError(t('auth.passwordResetFailed'));
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  function switchMode(nextMode: LoginMode): void {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  function handleCaptchaAnswerChange(value: string): void {
    const nextValue = captcha?.captchaType === 'TEXT' ? value.trim().toUpperCase() : value.trim();
    setCaptchaAnswer(nextValue.slice(0, CAPTCHA_ANSWER_MAX_LENGTH));
  }

  const trimmedIdentifier = identifier.trim();
  const trimmedEmailCodeEmail = emailCodeEmail.trim();
  const trimmedEmailCode = emailCode.trim();
  const trimmedResetEmail = resetEmail.trim();
  const trimmedResetCode = resetCode.trim();

  return (
    <AuthShell
      title={mode === 'forgotPassword' ? t('auth.forgotPasswordTitle') : t('auth.loginTitle')}
      showLoginLink={false}
      registerLinkLabel={t('auth.toRegisterPrompt')}
    >
      {mode !== 'forgotPassword' ? (
        <div className="auth-tabs" role="tablist" aria-label={t('auth.loginTitle')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={mode === 'password' ? 'is-active' : undefined}
            onClick={() => switchMode('password')}
          >
            {t('auth.passwordLogin')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'emailCode'}
            className={mode === 'emailCode' ? 'is-active' : undefined}
            onClick={() => switchMode('emailCode')}
          >
            {t('auth.emailCodeLogin')}
          </button>
        </div>
      ) : null}

      {mode === 'password' ? (
        <form className="form-stack" onSubmit={(event) => void handlePasswordSubmit(event)}>
          <label>
            <span>{t('auth.identifier')}</span>
            <input
              value={identifier}
              autoComplete="username"
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={PASSWORD_MAX_LENGTH}
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
                {isLoadingCaptcha ? t('auth.refreshing') : t('auth.refreshCaptcha')}
              </button>
            </div>
            {captcha ? (
              <span className="form-hint">
                {formatCaptchaRefreshCountdown(t('auth.captchaRefreshCountdown'), captchaRefreshSeconds)}
              </span>
            ) : null}
            <input
              value={captchaAnswer}
              inputMode={captcha?.captchaType === 'TEXT' ? 'text' : 'numeric'}
              maxLength={CAPTCHA_ANSWER_MAX_LENGTH}
              onChange={(event) => handleCaptchaAnswerChange(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="auth-inline-link"
            onClick={() => switchMode('forgotPassword')}
          >
            {t('auth.forgotPassword')}
          </button>
          {notice ? <p className="form-success">{notice}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting || !captcha || !trimmedIdentifier || !password || !captchaAnswer}
          >
            {isSubmitting ? t('auth.signingIn') : t('auth.login')}
          </button>
        </form>
      ) : mode === 'emailCode' ? (
        <form className="form-stack" onSubmit={(event) => void handleEmailCodeSubmit(event)}>
          <label>
            <span>{t('auth.email')}</span>
            <input
              type="email"
              value={emailCodeEmail}
              autoComplete="email"
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => setEmailCodeEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.code')}</span>
            <div className="inline-control">
              <input
                value={emailCode}
                autoComplete="one-time-code"
                onChange={(event) => setEmailCode(event.target.value.trim().slice(0, EMAIL_CODE_MAX_LENGTH))}
                maxLength={EMAIL_CODE_MAX_LENGTH}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={isSendingCode || !trimmedEmailCodeEmail}
                onClick={() => void handleSendCode()}
              >
                {isSendingCode ? t('auth.sending') : t('auth.sendEmailCode')}
              </button>
            </div>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting || !trimmedEmailCodeEmail || !trimmedEmailCode}
          >
            {isSubmitting ? t('auth.signingIn') : t('auth.login')}
          </button>
        </form>
      ) : (
        <form className="form-stack" onSubmit={(event) => void handlePasswordResetSubmit(event)}>
          <label>
            <span>{t('auth.email')}</span>
            <input
              type="email"
              value={resetEmail}
              autoComplete="email"
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => setResetEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.code')}</span>
            <div className="inline-control">
              <input
                value={resetCode}
                autoComplete="one-time-code"
                onChange={(event) => setResetCode(event.target.value.trim().slice(0, EMAIL_CODE_MAX_LENGTH))}
                maxLength={EMAIL_CODE_MAX_LENGTH}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={isSendingCode || !trimmedResetEmail}
                onClick={() => void handleSendPasswordResetCode()}
              >
                {isSendingCode ? t('auth.sending') : t('auth.sendEmailCode')}
              </button>
            </div>
          </label>
          <label>
            <span>{t('auth.newPassword')}</span>
            <input
              type="password"
              value={resetPasswordValue}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              onChange={(event) => setResetPasswordValue(event.target.value)}
            />
          </label>
          <label>
            <span>{t('auth.confirmPassword')}</span>
            <input
              type="password"
              value={resetPasswordConfirm}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              onChange={(event) => setResetPasswordConfirm(event.target.value)}
            />
          </label>
          {notice ? <p className="form-success">{notice}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary-button"
            disabled={
              isSubmitting ||
              !trimmedResetEmail ||
              !trimmedResetCode ||
              !resetPasswordValue ||
              !resetPasswordConfirm
            }
          >
            {isSubmitting ? t('auth.resetting') : t('auth.resetPassword')}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => switchMode('password')}
          >
            {t('auth.toLogin')}
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

function formatCaptchaRefreshCountdown(template: string, seconds: number): string {
  return template.replace('{{seconds}}', String(seconds));
}
